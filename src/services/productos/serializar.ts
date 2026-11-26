import type { MovimientoStock, Producto } from '@prisma/client'

type MovimientoConRelaciones = MovimientoStock & {
  usuario?: { usuario: string; nombre: string } | null
  comprobante?: { serie: string; numero: number } | null
}

/** Forma que consume el frontend (`web/src/shared/types.ts`). */
export function aProducto(row: Producto) {
  return {
    id: row.id,
    codigo: row.codigo,
    descripcion: row.descripcion,
    unidad: row.unidad,
    precioUnitario: Number(row.precioUnitario),
    afectoIgv: row.afectoIgv,
    stock: row.stock,
  }
}

export function aMovimientoStock(row: MovimientoConRelaciones) {
  return {
    id: row.id,
    tipo: row.tipo,
    cantidad: row.cantidad,
    motivo: row.motivo,
    stockAnterior: row.stockAnterior,
    stockPosterior: row.stockPosterior,
    creadoEn: row.creadoEn.toISOString(),
    usuario: row.usuario?.nombre || row.usuario?.usuario || null,
    comprobante: row.comprobante
      ? `${row.comprobante.serie}-${String(row.comprobante.numero).padStart(8, '0')}`
      : null,
  }
}
