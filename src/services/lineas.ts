import type { Producto } from '@prisma/client'
import {
  calcularComprobante,
  type EntradaLinea,
  type TotalesComprobante,
} from './comprobantes/calcular.ts'

export interface EntradaItemProducto {
  /** Presente cuando la línea viene del catálogo. */
  productoId?: string
  /** Presente cuando la línea se escribe a mano (sin producto en el catálogo). */
  descripcion?: string
  cantidad: number
  precioUnitario?: number
  igvPorcentaje?: number
}

export interface ItemPreparado {
  /** Null solo en líneas de texto libre de proformas y pedidos. */
  producto: Producto | null
  descripcion: string
  cantidad: number
  precioUnitario: number
  afectoIgv: boolean
  igvPorcentaje?: number
}

/**
 * Une cada línea con su precio y tasa de IGV, y calcula los importes con la
 * misma regla que usan los comprobantes. Lo comparten comprobantes, cotizaciones
 * y pedidos para que el redondeo no cambie entre documentos.
 *
 * Las líneas de texto libre no tienen producto: usan la descripción y el precio
 * que vienen en la entrada, y se guardan con `productoId` nulo.
 */
export function prepararItems(
  productos: Producto[],
  entradas: EntradaItemProducto[],
): { items: ItemPreparado[]; totales: TotalesComprobante } {
  const porId = new Map(productos.map((producto) => [producto.id, producto]))

  const items = entradas.map((entrada) => {
    const producto = entrada.productoId ? porId.get(entrada.productoId) ?? null : null
    const tieneTasaPropia = entrada.igvPorcentaje !== undefined
    return {
      producto,
      descripcion: producto?.descripcion ?? entrada.descripcion?.trim() ?? 'Sin descripción',
      cantidad: entrada.cantidad,
      precioUnitario: entrada.precioUnitario ?? (producto ? Number(producto.precioUnitario) : 0),
      afectoIgv: tieneTasaPropia ? entrada.igvPorcentaje! > 0 : producto?.afectoIgv ?? true,
      igvPorcentaje: entrada.igvPorcentaje,
    }
  })

  const entradasCalculo: EntradaLinea[] = items.map((item) => ({
    precioUnitario: item.precioUnitario,
    cantidad: item.cantidad,
    afectoIgv: item.afectoIgv,
    igvPorcentaje: item.igvPorcentaje,
  }))

  return { items, totales: calcularComprobante(entradasCalculo) }
}
