import type { Prisma, TipoMovimientoStock } from '@prisma/client'
import { prisma } from '../../lib/prisma.ts'
import { errores } from '../../lib/http.ts'
import { aMovimientoStock, aProducto } from './serializar.ts'

export interface ItemVentaParaStock {
  productoId: string | null
  cantidad: Prisma.Decimal | number
}

/**
 * El stock del catálogo se cuenta en unidades enteras. Una línea fraccionaria
 * descuenta al menos una unidad para no perder movimientos en el historial.
 */
export function unidadesDescontables(cantidad: Prisma.Decimal | number): number {
  const numero = Number(cantidad)
  return Math.max(1, Math.round(Number.isFinite(numero) ? numero : 0))
}

/** Agrupa las líneas de un comprobante por producto para un único movimiento por producto. */
export function unidadesPorProducto(items: ItemVentaParaStock[]): Map<string, number> {
  const agrupado = new Map<string, number>()
  for (const item of items) {
    if (!item.productoId) continue
    const cantidad = unidadesDescontables(item.cantidad)
    agrupado.set(item.productoId, (agrupado.get(item.productoId) ?? 0) + cantidad)
  }
  return agrupado
}

export async function ajustarStock(entrada: {
  productoId: string
  tipo: Extract<TipoMovimientoStock, 'ENTRADA' | 'SALIDA'>
  cantidad: number
  motivo?: string | null
  usuarioId: string
}) {
  return prisma.$transaction(async (tx) => {
    const producto = await tx.producto.findUnique({ where: { id: entrada.productoId } })
    if (!producto) throw errores.noEncontrado('El producto no existe.')

    if (entrada.tipo === 'SALIDA' && producto.stock < entrada.cantidad) {
      throw errores.conflicto(
        `Stock insuficiente: hay ${producto.stock} ${producto.unidad} disponibles.`,
      )
    }

    const stockPosterior =
      entrada.tipo === 'ENTRADA'
        ? producto.stock + entrada.cantidad
        : producto.stock - entrada.cantidad

    const cambio = await tx.producto.updateMany({
      where: { id: producto.id, stock: producto.stock },
      data: { stock: stockPosterior },
    })
    if (cambio.count !== 1) {
      throw errores.conflicto('El stock cambió mientras se registraba el ajuste. Reintenta.')
    }

    const [actualizado, movimiento] = await Promise.all([
      tx.producto.findUniqueOrThrow({ where: { id: producto.id } }),
      tx.movimientoStock.create({
        data: {
          productoId: producto.id,
          tipo: entrada.tipo,
          cantidad: entrada.cantidad,
          motivo: entrada.motivo?.trim() || null,
          stockAnterior: producto.stock,
          stockPosterior,
          usuarioId: entrada.usuarioId,
        },
      }),
    ])

    return { producto: aProducto(actualizado), movimiento: aMovimientoStock(movimiento) }
  })
}

/**
 * Descuenta el stock de una venta ya aceptada. Es idempotente por comprobante
 * y producto: un reenvío no vuelve a descontar las mismas unidades.
 */
export async function registrarSalidaPorVenta(
  comprobanteId: string,
  referencia: string,
  items: ItemVentaParaStock[],
) {
  const unidades = unidadesPorProducto(items)
  if (unidades.size === 0) return

  await prisma.$transaction(async (tx) => {
    for (const [productoId, cantidad] of unidades) {
      const yaRegistrado = await tx.movimientoStock.findUnique({
        where: { comprobanteId_productoId: { comprobanteId, productoId } },
        select: { id: true },
      })
      if (yaRegistrado) continue

      const actualizado = await tx.producto.update({
        where: { id: productoId },
        data: { stock: { decrement: cantidad } },
      })

      await tx.movimientoStock.create({
        data: {
          productoId,
          tipo: 'VENTA',
          cantidad,
          motivo: `Venta ${referencia}`,
          stockAnterior: actualizado.stock + cantidad,
          stockPosterior: actualizado.stock,
          comprobanteId,
        },
      })
    }
  })
}

export async function listarMovimientos(productoId: string) {
  const producto = await prisma.producto.findUnique({
    where: { id: productoId },
    select: { id: true },
  })
  if (!producto) throw errores.noEncontrado('El producto no existe.')

  const filas = await prisma.movimientoStock.findMany({
    where: { productoId },
    include: {
      usuario: { select: { usuario: true, nombre: true } },
      comprobante: { select: { serie: true, numero: true } },
    },
    orderBy: { creadoEn: 'desc' },
    take: 50,
  })
  return filas.map(aMovimientoStock)
}
