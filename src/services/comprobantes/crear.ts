import { Prisma } from '@prisma/client'
import type { TipoComprobante } from '@prisma/client'
import { prisma } from '../../lib/prisma.ts'
import { errores } from '../../lib/http.ts'
import { prepararItems } from '../lineas.ts'
import { buscarDetraccion } from '../detracciones/catalogo.ts'
import { calcularDetraccion } from '../detracciones/calcular.ts'
import { enviarYRegistrar } from './envio.ts'

export interface EntradaCrearComprobante {
  tipo: 'FACTURA' | 'BOLETA' | 'NOTA_CREDITO' | 'NOTA_DEBITO'
  clienteId: string
  fecha: string
  serie?: string
  observacion?: string
  comprobanteAfectadoId?: string
  motivoNota?: string
  moneda?: string
  tipoCambio?: number
  detraccionCodigo?: string
  items: {
    productoId: string
    cantidad: number
    precioUnitario?: number
    igvPorcentaje?: number
  }[]
}

const SERIE_POR_DEFECTO: Record<EntradaCrearComprobante['tipo'], string> = {
  FACTURA: 'F001',
  BOLETA: 'B001',
  NOTA_CREDITO: 'NC01',
  NOTA_DEBITO: 'ND01',
}

const esNota = (tipo: EntradaCrearComprobante['tipo']) =>
  tipo === 'NOTA_CREDITO' || tipo === 'NOTA_DEBITO'

type Tx = Prisma.TransactionClient

/**
 * Reserva el correlativo con un incremento atómico: dos peticiones simultáneas
 * nunca obtienen el mismo número. Si la serie no existe todavía, se crea en 1.
 */
async function reservarNumero(tx: Tx, tipo: TipoComprobante, serie: string): Promise<number> {
  try {
    const actualizada = await tx.serie.update({
      where: { tipo_serie: { tipo, serie } },
      data: { siguiente: { increment: 1 } },
    })
    return actualizada.siguiente - 1
  } catch (error) {
    // Solo la serie inexistente se crea; otros fallos (BD caída) deben propagarse.
    const esInexistente =
      error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025'
    if (!esInexistente) throw error

    try {
      const creada = await tx.serie.create({ data: { tipo, serie, siguiente: 2 } })
      return creada.siguiente - 1
    } catch {
      // Otra petición creó la serie entre el update y el create: se reintenta el incremento.
      const actualizada = await tx.serie.update({
        where: { tipo_serie: { tipo, serie } },
        data: { siguiente: { increment: 1 } },
      })
      return actualizada.siguiente - 1
    }
  }
}

export async function crearComprobante(entrada: EntradaCrearComprobante) {
  const cliente = await prisma.cliente.findUnique({ where: { id: entrada.clienteId } })
  if (!cliente) throw errores.noEncontrado('El cliente indicado no existe.')

  if (entrada.tipo === 'FACTURA' && cliente.tipoDocumento !== 'RUC') {
    throw errores.invalido('La factura exige un cliente con RUC.')
  }

  let afectado: { id: string; clienteId: string; serie: string; numero: number; estado: string } | null = null
  if (esNota(entrada.tipo)) {
    if (!entrada.comprobanteAfectadoId) {
      throw errores.invalido('La nota necesita un comprobante afectado.')
    }
    if (!entrada.motivoNota?.trim()) {
      throw errores.invalido('La nota necesita un motivo.')
    }
    afectado = await prisma.comprobante.findUnique({
      where: { id: entrada.comprobanteAfectadoId },
      select: { id: true, clienteId: true, serie: true, numero: true, estado: true },
    })
    if (!afectado) throw errores.noEncontrado('El comprobante afectado no existe.')
    if (afectado.estado === 'ANULADO') {
      throw errores.conflicto('No se puede emitir una nota sobre un comprobante anulado.')
    }
    if (afectado.estado !== 'EMITIDO' && afectado.estado !== 'ACEPTADO') {
      throw errores.invalido('El comprobante afectado debe estar emitido o aceptado.')
    }
  }

  const ids = [...new Set(entrada.items.map((item) => item.productoId))]
  const productos = await prisma.producto.findMany({ where: { id: { in: ids } } })
  if (productos.length !== ids.length) {
    throw errores.invalido('Uno de los productos seleccionados ya no existe.')
  }

  const { items: lineasEntrada, totales } = prepararItems(productos, entrada.items)

  const serie = entrada.serie?.trim() || SERIE_POR_DEFECTO[entrada.tipo]
  const fecha = new Date(`${entrada.fecha}T00:00:00.000Z`)
  if (Number.isNaN(fecha.getTime())) throw errores.invalido('La fecha no es válida.')

  const moneda = entrada.moneda === 'USD' ? 'USD' : 'PEN'
  const tipoCambio =
    entrada.tipoCambio !== undefined && Number.isFinite(entrada.tipoCambio) && entrada.tipoCambio > 0
      ? entrada.tipoCambio
      : 1

  const detraccion = buscarDetraccion(entrada.detraccionCodigo ?? '000')
  if (!detraccion) {
    throw errores.invalido('El código de detracción indicado no existe en el catálogo.')
  }

  const creado = await prisma.$transaction(async (tx) => {
    const numero = await reservarNumero(tx, entrada.tipo, serie)
    return tx.comprobante.create({
      data: {
        tipo: entrada.tipo,
        serie,
        numero,
        fecha,
        clienteId: afectado?.clienteId ?? cliente.id,
        subtotal: totales.subtotal.toFixed(2),
        igv: totales.igv.toFixed(2),
        total: totales.total.toFixed(2),
        moneda,
        tipoCambio: tipoCambio.toFixed(4),
        observacion: entrada.observacion ?? null,
        documentoAfectado: afectado
          ? `${afectado.serie}-${String(afectado.numero).padStart(8, '0')}`
          : null,
        motivoNota: entrada.motivoNota?.trim() || null,
        detraccionCodigo: detraccion.codigo,
        detraccionTasa: detraccion.tasa.toFixed(2),
        detraccionMonto: calcularDetraccion(totales.total, detraccion.tasa).toFixed(2),
        items: {
          create: lineasEntrada.map((linea, indice) => {
            const calculada = totales.lineas[indice]!
            return {
              productoId: linea.producto!.id,
              descripcion: linea.descripcion,
              cantidad: linea.cantidad.toFixed(3),
              valorUnitario: calculada.valorUnitario.toFixed(4),
              precioUnitario: calculada.precioUnitario.toFixed(4),
              igv: calculada.igv.toFixed(2),
              total: calculada.total.toFixed(2),
              afectoIgv: calculada.afectoIgv,
            }
          }),
        },
      },
      include: { cliente: true, items: true },
    })
  })

  return enviarYRegistrar(creado.id)
}
