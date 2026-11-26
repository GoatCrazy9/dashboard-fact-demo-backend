import type {
  EstadoDocumentoVenta,
  Prisma,
  TipoDocumentoVenta,
} from '@prisma/client'
import { prisma } from '../../lib/prisma.ts'
import { errores } from '../../lib/http.ts'
import { aFecha, fechaValida } from '../../lib/fechas.ts'
import { prepararItems, type EntradaItemProducto } from '../lineas.ts'
import { crearComprobante } from '../comprobantes/crear.ts'
import { reservarSecuencia } from './secuencia.ts'
import { transicionValida } from './estados.ts'

const SERIE_POR_DEFECTO: Record<TipoDocumentoVenta, string> = {
  COTIZACION: 'C001',
  PEDIDO: 'P001',
}

export interface EntradaDocumentoVenta {
  tipo: TipoDocumentoVenta
  clienteId: string
  fecha: string
  fechaVencimiento?: string | null
  fechaEntrega?: string | null
  serie?: string
  solicitadoPor?: string | null
  observacion?: string | null
  items: EntradaItemProducto[]
}

export interface EntradaConvertirDocumento {
  tipo: 'FACTURA' | 'BOLETA'
  fecha?: string
  observacion?: string | null
}

interface ItemFila {
  id: string
  productoId: string | null
  descripcion: string
  cantidad: Prisma.Decimal
  valorUnitario: Prisma.Decimal
  precioUnitario: Prisma.Decimal
  igv: Prisma.Decimal
  total: Prisma.Decimal
  afectoIgv: boolean
}

interface FilaDocumento {
  id: string
  tipo: TipoDocumentoVenta
  serie: string
  numero: number
  fecha: Date
  fechaVencimiento: Date | null
  fechaEntrega: Date | null
  clienteId: string
  cliente: {
    id: string
    razonSocial: string
    numeroDocumento: string
    tipoDocumento: string
    direccion: string | null
  }
  solicitadoPor: string | null
  subtotal: Prisma.Decimal
  igv: Prisma.Decimal
  total: Prisma.Decimal
  estado: EstadoDocumentoVenta
  observacion: string | null
  comprobante: { id: string; tipo: string; serie: string; numero: number } | null
  creadoEn: Date
  items?: ItemFila[]
}

export function serializarDocumento(fila: FilaDocumento) {
  return {
    id: fila.id,
    tipo: fila.tipo,
    serie: fila.serie,
    numero: fila.numero,
    fecha: fila.fecha.toISOString(),
    fechaVencimiento: fila.fechaVencimiento?.toISOString() ?? null,
    fechaEntrega: fila.fechaEntrega?.toISOString() ?? null,
    clienteId: fila.clienteId,
    cliente: fila.cliente.razonSocial,
    clienteDocumento: fila.cliente.numeroDocumento,
    clienteTipoDocumento: fila.cliente.tipoDocumento,
    clienteDireccion: fila.cliente.direccion,
    solicitadoPor: fila.solicitadoPor,
    subtotal: Number(fila.subtotal),
    igv: Number(fila.igv),
    total: Number(fila.total),
    estado: fila.estado,
    observacion: fila.observacion,
    comprobante: fila.comprobante,
    creadoEn: fila.creadoEn.toISOString(),
    items: (fila.items ?? []).map((item) => ({
      id: item.id,
      productoId: item.productoId,
      descripcion: item.descripcion,
      cantidad: Number(item.cantidad),
      valorUnitario: Number(item.valorUnitario),
      precioUnitario: Number(item.precioUnitario),
      igv: Number(item.igv),
      total: Number(item.total),
      afectoIgv: item.afectoIgv,
    })),
  }
}

const incluir = {
  cliente: true,
  comprobante: { select: { id: true, tipo: true, serie: true, numero: true } },
} as const

async function recargar(id: string) {
  const fila = await prisma.documentoVenta.findUnique({
    where: { id },
    include: { ...incluir, items: true },
  })
  if (!fila) throw errores.noEncontrado('El documento no existe.')
  return serializarDocumento(fila)
}

function validarFechaOpcional(valor: string | null | undefined, fecha: string, campo: string) {
  if (valor === null || valor === undefined || valor === '') return
  if (!fechaValida(valor)) throw errores.invalido(`${campo} debe ser una fecha válida AAAA-MM-DD.`)
  if (valor < fecha) throw errores.invalido(`${campo} no puede ser anterior a la emisión.`)
}

export async function crearDocumentoVenta(entrada: EntradaDocumentoVenta) {
  if (!fechaValida(entrada.fecha)) {
    throw errores.invalido('La fecha de emisión no es válida.')
  }
  validarFechaOpcional(entrada.fechaVencimiento, entrada.fecha, 'La fecha de vencimiento')
  validarFechaOpcional(entrada.fechaEntrega, entrada.fecha, 'La fecha de entrega')

  const cliente = await prisma.cliente.findUnique({ where: { id: entrada.clienteId } })
  if (!cliente) throw errores.noEncontrado('El cliente indicado no existe.')

  for (const item of entrada.items) {
    if (!item.productoId && !item.descripcion?.trim()) {
      throw errores.invalido('Escribe el texto de la línea o elige un producto del catálogo.')
    }
  }

  const ids = [
    ...new Set(entrada.items.flatMap((item) => (item.productoId ? [item.productoId] : []))),
  ]
  const productos = await prisma.producto.findMany({ where: { id: { in: ids } } })
  if (productos.length !== ids.length) {
    throw errores.invalido('Uno de los productos seleccionados ya no existe.')
  }

  const { items, totales } = prepararItems(productos, entrada.items)
  const serie = entrada.serie?.trim() || SERIE_POR_DEFECTO[entrada.tipo]

  const creado = await prisma.$transaction(async (tx) => {
    const numero = await reservarSecuencia(tx, entrada.tipo)
    return tx.documentoVenta.create({
      data: {
        tipo: entrada.tipo,
        serie,
        numero,
        fecha: aFecha(entrada.fecha),
        fechaVencimiento: entrada.fechaVencimiento
          ? aFecha(entrada.fechaVencimiento)
          : null,
        fechaEntrega: entrada.fechaEntrega ? aFecha(entrada.fechaEntrega) : null,
        clienteId: cliente.id,
        solicitadoPor: entrada.solicitadoPor?.trim() || null,
        subtotal: totales.subtotal.toFixed(2),
        igv: totales.igv.toFixed(2),
        total: totales.total.toFixed(2),
        observacion: entrada.observacion?.trim() || null,
        items: {
          create: items.map((item, indice) => {
            const calculada = totales.lineas[indice]!
            return {
              productoId: item.producto?.id ?? null,
              descripcion: item.descripcion,
              cantidad: item.cantidad.toFixed(3),
              valorUnitario: calculada.valorUnitario.toFixed(4),
              precioUnitario: calculada.precioUnitario.toFixed(4),
              igv: calculada.igv.toFixed(2),
              total: calculada.total.toFixed(2),
              afectoIgv: calculada.afectoIgv,
            }
          }),
        },
      },
      include: { ...incluir, items: true },
    })
  })

  return serializarDocumento(creado)
}

export async function listarDocumentosVenta(tipo?: TipoDocumentoVenta) {
  const filas = await prisma.documentoVenta.findMany({
    where: tipo ? { tipo } : undefined,
    include: incluir,
    orderBy: [{ fecha: 'desc' }, { creadoEn: 'desc' }],
    take: 300,
  })
  return filas.map(serializarDocumento)
}

export async function obtenerDocumentoVenta(id: string) {
  return recargar(id)
}

export async function cambiarEstadoDocumento(
  id: string,
  estado: EstadoDocumentoVenta,
) {
  const actual = await prisma.documentoVenta.findUnique({
    where: { id },
    select: { estado: true },
  })
  if (!actual) throw errores.noEncontrado('El documento no existe.')
  if (!transicionValida(actual.estado, estado)) {
    throw errores.conflicto(
      `No se puede pasar de ${actual.estado} a ${estado}.`,
    )
  }

  await prisma.documentoVenta.update({ where: { id }, data: { estado } })
  return recargar(id)
}

export async function convertirDocumentoVenta(
  id: string,
  datos: EntradaConvertirDocumento,
) {
  const documento = await prisma.documentoVenta.findUnique({
    where: { id },
    include: { items: true, cliente: true },
  })
  if (!documento) throw errores.noEncontrado('El documento no existe.')
  if (documento.estado !== 'APROBADO') {
    throw errores.conflicto('Primero aprueba el documento para convertirlo.')
  }
  if (documento.comprobanteId) {
    throw errores.conflicto('Este documento ya fue convertido.')
  }
  if (documento.items.some((item) => !item.productoId)) {
    throw errores.conflicto(
      'Este documento tiene líneas escritas a mano sin producto de catálogo; no se puede convertir a comprobante.',
    )
  }

  const fecha = datos.fecha ?? documento.fecha.toISOString().slice(0, 10)
  if (!fechaValida(fecha)) throw errores.invalido('La fecha de emisión no es válida.')

  const itemsConvertibles = documento.items.filter(
    (item): item is typeof item & { productoId: string } => Boolean(item.productoId),
  )

  const comprobante = await crearComprobante({
    tipo: datos.tipo,
    clienteId: documento.clienteId,
    fecha,
    observacion: datos.observacion ?? documento.observacion ?? undefined,
    items: itemsConvertibles.map((item) => ({
      productoId: item.productoId,
      cantidad: Number(item.cantidad),
      precioUnitario: Number(item.precioUnitario),
      igvPorcentaje: item.afectoIgv ? undefined : 0,
    })),
  })

  const actualizado = await prisma.documentoVenta.updateMany({
    where: { id, estado: 'APROBADO', comprobanteId: null },
    data: { estado: 'CONVERTIDO', comprobanteId: comprobante.id },
  })
  if (actualizado.count === 0) {
    throw errores.conflicto('El documento ya no estaba aprobado; revisa el comprobante creado.')
  }

  return { documento: await recargar(id), comprobante }
}
