import { prisma } from '../../lib/prisma.ts'
import { aResumenComprobante } from './serializar.ts'

export async function listarComprobantes() {
  const filas = await prisma.comprobante.findMany({
    include: { cliente: true },
    orderBy: [{ fecha: 'desc' }, { creadoEn: 'desc' }],
    take: 300,
  })
  return filas.map(aResumenComprobante)
}

export async function obtenerComprobante(id: string) {
  const fila = await prisma.comprobante.findUnique({
    where: { id },
    include: { cliente: true, items: true },
  })
  if (!fila) return null

  return {
    ...aResumenComprobante(fila),
    observacion: fila.observacion,
    items: fila.items.map((item) => ({
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
