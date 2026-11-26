import type { Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma.ts'
import { aNumero, aResumenComprobante } from './comprobantes/serializar.ts'

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'set', 'oct', 'nov', 'dic']
const ESTADOS_VALIDOS = ['EMITIDO', 'ACEPTADO'] as const

interface Punto {
  total: number
  cantidad: number
}

const claveMes = (fecha: Date) => `${MESES[fecha.getUTCMonth()]} ${fecha.getUTCFullYear()}`
const claveDia = (fecha: Date) => fecha.toISOString().slice(0, 10)
const claveHora = (fecha: Date) => `${String(fecha.getUTCHours()).padStart(2, '0')}:00`

function sumar(mapa: Map<string, Punto>, clave: string, total: Prisma.Decimal | number | null) {
  const punto = mapa.get(clave) ?? { total: 0, cantidad: 0 }
  punto.total += aNumero(total)
  punto.cantidad += 1
  mapa.set(clave, punto)
}

export async function resumenPanel() {
  const ahora = new Date()
  const anio = ahora.getUTCFullYear()
  const mes = ahora.getUTCMonth()
  const dia = ahora.getUTCDate()
  const hora = ahora.getUTCHours()

  const inicioMes = new Date(Date.UTC(anio, mes, 1))
  const inicioSiguiente = new Date(Date.UTC(anio, mes + 1, 1))
  const finHoy = new Date(Date.UTC(anio, mes, dia + 1))
  const inicioHistorico = new Date(Date.UTC(anio, mes - 11, 1))
  const inicioDiario = new Date(Date.UTC(anio, mes, dia - 29))
  const inicioHorario = new Date(Date.UTC(anio, mes, dia, hora - 23))

  const [delMes, pendientes, conComprobantes, historico, diario, horario, ultimos] = await Promise.all([
    prisma.comprobante.findMany({
      where: {
        fecha: { gte: inicioMes, lt: inicioSiguiente },
        estado: { in: [...ESTADOS_VALIDOS] },
      },
      select: { total: true, igv: true, tipo: true },
    }),
    prisma.comprobante.findMany({
      where: { estado: 'EMITIDO' },
      select: { total: true },
    }),
    prisma.comprobante.findMany({ distinct: ['clienteId'], select: { clienteId: true } }),
    prisma.comprobante.findMany({
      where: {
        fecha: { gte: inicioHistorico, lt: inicioSiguiente },
        estado: { in: [...ESTADOS_VALIDOS] },
      },
      select: { fecha: true, total: true },
    }),
    prisma.comprobante.findMany({
      where: {
        fecha: { gte: inicioDiario, lt: finHoy },
        estado: { in: [...ESTADOS_VALIDOS] },
      },
      select: { fecha: true, total: true },
    }),
    prisma.comprobante.findMany({
      where: {
        creadoEn: { gte: inicioHorario, lte: ahora },
        estado: { in: [...ESTADOS_VALIDOS] },
      },
      select: { creadoEn: true, total: true },
    }),
    prisma.comprobante.findMany({
      include: { cliente: true },
      orderBy: { creadoEn: 'desc' },
      take: 5,
    }),
  ])

  const acumuladoMeses = new Map<string, Punto>()
  for (let i = 11; i >= 0; i -= 1) {
    const fecha = new Date(Date.UTC(anio, mes - i, 1))
    acumuladoMeses.set(claveMes(fecha), { total: 0, cantidad: 0 })
  }
  for (const fila of historico) sumar(acumuladoMeses, claveMes(fila.fecha), fila.total)

  const acumuladoDias = new Map<string, Punto>()
  for (let i = 29; i >= 0; i -= 1) {
    const fecha = new Date(Date.UTC(anio, mes, dia - i))
    acumuladoDias.set(claveDia(fecha), { total: 0, cantidad: 0 })
  }
  for (const fila of diario) sumar(acumuladoDias, claveDia(fila.fecha), fila.total)

  const acumuladoHoras = new Map<string, Punto>()
  for (let i = 23; i >= 0; i -= 1) {
    const fecha = new Date(inicioHorario.getTime() + i * 60 * 60 * 1000)
    acumuladoHoras.set(claveHora(fecha), { total: 0, cantidad: 0 })
  }
  for (const fila of horario) sumar(acumuladoHoras, claveHora(fila.creadoEn), fila.total)

  const ventasMes = delMes.reduce((suma, fila) => suma + aNumero(fila.total), 0)
  const igvMes = delMes.reduce((suma, fila) => suma + aNumero(fila.igv), 0)
  const facturas = delMes.filter((fila) => fila.tipo === 'FACTURA')
  const boletas = delMes.filter((fila) => fila.tipo === 'BOLETA')
  const sumaPorTipo = (filas: typeof delMes) =>
    filas.reduce((suma, fila) => suma + aNumero(fila.total), 0)

  return {
    ventasMes,
    comprobantesMes: delMes.length,
    comprobantesPendientes: pendientes.length,
    clientesActivos: conComprobantes.length,
    ticketPromedio: delMes.length ? Math.round((ventasMes / delMes.length) * 100) / 100 : 0,
    igvMes,
    facturasMes: facturas.length,
    boletasMes: boletas.length,
    montoFacturasMes: sumaPorTipo(facturas),
    montoBoletasMes: sumaPorTipo(boletas),
    montoPendiente: pendientes.reduce((suma, fila) => suma + aNumero(fila.total), 0),
    ventasPorMes: [...acumuladoMeses.entries()].map(([etiqueta, punto]) => ({
      mes: etiqueta,
      ...punto,
    })),
    ventasPorDia: [...acumuladoDias.entries()].map(([fecha, punto]) => ({ fecha, ...punto })),
    ventasPorHora: [...acumuladoHoras.entries()].map(([etiqueta, punto]) => ({
      hora: etiqueta,
      ...punto,
    })),
    ultimos: ultimos.map(aResumenComprobante),
  }
}
