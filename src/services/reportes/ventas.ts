import type { EstadoComprobante, Prisma, TipoComprobante } from '@prisma/client'
import { prisma } from '../../lib/prisma.ts'
import { aNumero } from '../comprobantes/serializar.ts'
import type { HojaExcel } from './xlsx.ts'

export interface RangoVentas {
  desde: string
  hasta: string
}

/** Solo estas combinaciones cuentan como venta; borradores y rechazados no. */
const ESTADOS_VENTA: EstadoComprobante[] = ['EMITIDO', 'ACEPTADO']
const TIPOS_VENTA = ['FACTURA', 'BOLETA', 'NOTA_CREDITO', 'NOTA_DEBITO'] as const

type TipoVenta = (typeof TIPOS_VENTA)[number]
type DecimalComoNumero = Prisma.Decimal | number

export interface FilaVentas {
  id: string
  tipo: TipoComprobante
  estado: EstadoComprobante
  fecha: Date
  serie: string
  numero: number
  subtotal: DecimalComoNumero
  igv: DecimalComoNumero
  total: DecimalComoNumero
  moneda: string
  tipoCambio: DecimalComoNumero
  cliente: { razonSocial: string; numeroDocumento: string }
  documentoAfectado: string | null
  motivoNota: string | null
  items: {
    descripcion: string
    cantidad: DecimalComoNumero
    total: DecimalComoNumero
  }[]
}

export interface DetalleVentaReporte {
  id: string
  tipo: TipoVenta
  serie: string
  numero: number
  fecha: string
  cliente: string
  clienteDocumento: string
  moneda: string
  tipoCambio: number
  subtotal: number
  igv: number
  total: number
  totalPEN: number
  signo: 1 | -1
  estado: EstadoComprobante
  documentoAfectado: string | null
  motivoNota: string | null
}

export interface ReporteVentas {
  desde: string
  hasta: string
  generadoEn: string
  resumen: {
    comprobantes: number
    subtotal: number
    igv: number
    total: number
    totalPEN: number
    totalUSD: number
    ticketPromedio: number
    anulados: number
    facturas: number
    boletas: number
    notasCredito: number
    notasDebito: number
  }
  porDia: { fecha: string; comprobantes: number; totalPEN: number }[]
  porTipo: { tipo: TipoVenta; comprobantes: number; totalPEN: number }[]
  porProducto: { descripcion: string; cantidad: number; totalPEN: number }[]
  detalle: DetalleVentaReporte[]
}

const redondear = (valor: number) => Math.round((valor + Number.EPSILON) * 100) / 100
const signoDe = (tipo: TipoComprobante): 1 | -1 => (tipo === 'NOTA_CREDITO' ? -1 : 1)
const esTipoVenta = (tipo: TipoComprobante): tipo is TipoVenta =>
  (TIPOS_VENTA as readonly string[]).includes(tipo)

/** Cálculo puro para que se pueda probar sin base de datos. */
export function calcularReporteVentas(filas: FilaVentas[], desde = '', hasta = ''): ReporteVentas {
  const resumen: ReporteVentas['resumen'] = {
    comprobantes: 0,
    subtotal: 0,
    igv: 0,
    total: 0,
    totalPEN: 0,
    totalUSD: 0,
    ticketPromedio: 0,
    anulados: 0,
    facturas: 0,
    boletas: 0,
    notasCredito: 0,
    notasDebito: 0,
  }
  const porDia = new Map<string, { comprobantes: number; totalPEN: number }>()
  const porTipo = new Map<TipoVenta, { comprobantes: number; totalPEN: number }>()
  const porProducto = new Map<string, { cantidad: number; totalPEN: number }>()
  const detalle: DetalleVentaReporte[] = []

  for (const fila of filas) {
    if (fila.estado === 'ANULADO') {
      resumen.anulados += 1
      continue
    }
    if (!ESTADOS_VENTA.includes(fila.estado) || !esTipoVenta(fila.tipo)) continue

    const signo = signoDe(fila.tipo)
    const tipoCambio = aNumero(fila.tipoCambio) || 1
    const esUSD = fila.moneda === 'USD'
    const subtotal = aNumero(fila.subtotal)
    const igv = aNumero(fila.igv)
    const total = aNumero(fila.total)
    const totalPEN = total * tipoCambio * signo
    const fecha = fila.fecha.toISOString().slice(0, 10)

    resumen.comprobantes += 1
    resumen.subtotal += subtotal * signo
    resumen.igv += igv * signo
    resumen.total += total * signo
    resumen.totalPEN += totalPEN
    if (esUSD) resumen.totalUSD += total * signo

    if (fila.tipo === 'FACTURA') resumen.facturas += 1
    if (fila.tipo === 'BOLETA') resumen.boletas += 1
    if (fila.tipo === 'NOTA_CREDITO') resumen.notasCredito += 1
    if (fila.tipo === 'NOTA_DEBITO') resumen.notasDebito += 1

    const dia = porDia.get(fecha) ?? { comprobantes: 0, totalPEN: 0 }
    dia.comprobantes += 1
    dia.totalPEN += totalPEN
    porDia.set(fecha, dia)

    const tipo = porTipo.get(fila.tipo) ?? { comprobantes: 0, totalPEN: 0 }
    tipo.comprobantes += 1
    tipo.totalPEN += totalPEN
    porTipo.set(fila.tipo, tipo)

    for (const item of fila.items) {
      const descripcion = item.descripcion.trim() || 'Producto sin descripción'
      const producto = porProducto.get(descripcion) ?? { cantidad: 0, totalPEN: 0 }
      producto.cantidad += aNumero(item.cantidad) * signo
      producto.totalPEN += aNumero(item.total) * tipoCambio * signo
      porProducto.set(descripcion, producto)
    }

    detalle.push({
      id: fila.id,
      tipo: fila.tipo,
      serie: fila.serie,
      numero: fila.numero,
      fecha,
      cliente: fila.cliente.razonSocial,
      clienteDocumento: fila.cliente.numeroDocumento,
      moneda: fila.moneda,
      tipoCambio,
      subtotal,
      igv,
      total,
      totalPEN,
      signo,
      estado: fila.estado,
      documentoAfectado: fila.documentoAfectado,
      motivoNota: fila.motivoNota,
    })
  }

  detalle.sort((a, b) =>
    a.fecha.localeCompare(b.fecha) ||
    a.serie.localeCompare(b.serie, 'es', { numeric: true }) ||
    a.numero - b.numero,
  )

  for (const clave of Object.keys(resumen) as (keyof typeof resumen)[]) {
    if (clave !== 'comprobantes' && clave !== 'anulados' && clave !== 'facturas' &&
        clave !== 'boletas' && clave !== 'notasCredito' && clave !== 'notasDebito') {
      resumen[clave] = redondear(resumen[clave])
    }
  }
  resumen.ticketPromedio = resumen.comprobantes
    ? redondear(resumen.totalPEN / resumen.comprobantes)
    : 0

  return {
    desde,
    hasta,
    generadoEn: new Date().toISOString(),
    resumen,
    porDia: [...porDia.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([fecha, dato]) => ({ fecha, ...dato, totalPEN: redondear(dato.totalPEN) })),
    porTipo: TIPOS_VENTA.map((tipo) => ({
      tipo,
      ...(porTipo.get(tipo) ?? { comprobantes: 0, totalPEN: 0 }),
    })).map((dato) => ({ ...dato, totalPEN: redondear(dato.totalPEN) })),
    porProducto: [...porProducto.entries()]
      .sort(([a], [b]) => a.localeCompare(b, 'es'))
      .map(([descripcion, dato]) => ({
        descripcion,
        cantidad: redondear(dato.cantidad),
        totalPEN: redondear(dato.totalPEN),
      })),
    detalle: detalle.map((fila) => ({ ...fila, totalPEN: redondear(fila.totalPEN) })),
  }
}

export async function reporteVentas(filtros: RangoVentas): Promise<ReporteVentas> {
  const desde = new Date(`${filtros.desde}T00:00:00.000Z`)
  const hasta = new Date(`${filtros.hasta}T00:00:00.000Z`)
  const siguiente = new Date(hasta.getTime() + 86_400_000)

  const filas = await prisma.comprobante.findMany({
    where: { fecha: { gte: desde, lt: siguiente } },
    include: { cliente: true, items: true },
    orderBy: [{ fecha: 'asc' }, { serie: 'asc' }, { numero: 'asc' }],
  })

  return calcularReporteVentas(filas, filtros.desde, filtros.hasta)
}

export const ETIQUETAS_TIPO: Record<TipoVenta, string> = {
  FACTURA: 'Factura',
  BOLETA: 'Boleta',
  NOTA_CREDITO: 'Nota de crédito',
  NOTA_DEBITO: 'Nota de débito',
}

/** Planillas del libro Excel: una por sección visible en pantalla. */
export function aHojasExcel(reporte: ReporteVentas): HojaExcel[] {
  const { resumen } = reporte
  return [
    {
      nombre: 'Resumen',
      columnas: ['Indicador', 'Valor'],
      anchos: [28, 24],
      filas: [
        ['Desde', reporte.desde],
        ['Hasta', reporte.hasta],
        ['Generado', reporte.generadoEn],
        ['Comprobantes considerados', resumen.comprobantes],
        ['Anulados excluidos', resumen.anulados],
        ['Subtotal neto', resumen.subtotal],
        ['IGV neto', resumen.igv],
        ['Total neto', resumen.total],
        ['Ventas netas (PEN)', resumen.totalPEN],
        ['Ventas netas (USD)', resumen.totalUSD],
        ['Ticket promedio (PEN)', resumen.ticketPromedio],
        ['Facturas', resumen.facturas],
        ['Boletas', resumen.boletas],
        ['Notas de crédito', resumen.notasCredito],
        ['Notas de débito', resumen.notasDebito],
      ],
    },
    {
      nombre: 'Detalle',
      columnas: [
        'Fecha', 'Comprobante', 'Tipo', 'Cliente', 'Documento', 'Moneda', 'Tipo cambio',
        'Subtotal', 'IGV', 'Total', 'Total PEN', 'Estado', 'Doc. afectado', 'Motivo',
      ],
      anchos: [12, 20, 18, 34, 16, 10, 12, 14, 12, 14, 14, 14, 20, 40],
      filas: reporte.detalle.map((fila) => [
        fila.fecha,
        `${fila.serie}-${String(fila.numero).padStart(8, '0')}`,
        ETIQUETAS_TIPO[fila.tipo],
        fila.cliente,
        fila.clienteDocumento,
        fila.moneda,
        fila.tipoCambio,
        fila.subtotal,
        fila.igv,
        fila.total,
        fila.totalPEN,
        fila.estado,
        fila.documentoAfectado ?? '',
        fila.motivoNota ?? '',
      ]),
    },
    {
      nombre: 'Por día',
      columnas: ['Fecha', 'Comprobantes', 'Total PEN'],
      anchos: [16, 18, 18],
      filas: reporte.porDia.map((fila) => [fila.fecha, fila.comprobantes, fila.totalPEN]),
    },
    {
      nombre: 'Por tipo',
      columnas: ['Tipo', 'Comprobantes', 'Total PEN'],
      anchos: [24, 18, 18],
      filas: reporte.porTipo.map((fila) => [
        ETIQUETAS_TIPO[fila.tipo], fila.comprobantes, fila.totalPEN,
      ]),
    },
    {
      nombre: 'Por producto',
      columnas: ['Producto', 'Cantidad', 'Total PEN'],
      anchos: [42, 16, 18],
      filas: reporte.porProducto.map((fila) => [
        fila.descripcion, fila.cantidad, fila.totalPEN,
      ]),
    },
  ]
}
