export const IGV_PORCENTAJE = 18

export interface EntradaLinea {
  precioUnitario: number
  cantidad: number
  afectoIgv: boolean
  /** Tasa propia de la línea; si falta se usa la tasa general del comprobante. */
  igvPorcentaje?: number
}

export interface LineaCalculada {
  valorUnitario: number
  precioUnitario: number
  igv: number
  total: number
  afectoIgv: boolean
}

export interface TotalesComprobante {
  lineas: LineaCalculada[]
  subtotal: number
  igv: number
  total: number
}

const centavos = (valor: number) => Math.round(valor * 100)
const soles = (valor: number) => Math.round(valor) / 100

/**
 * Precios de venta incluyen IGV (uso comercial en Perú). Se trabaja en centavos
 * para que el redondeo de cada línea sea el que termina en el comprobante.
 * `igvPorcentaje` de la línea prevalece sobre la tasa general del comprobante.
 */
export function calcularComprobante(
  entradas: EntradaLinea[],
  igvPorcentaje = IGV_PORCENTAJE,
): TotalesComprobante {
  let subtotalCentavos = 0
  let igvCentavos = 0
  let totalCentavos = 0

  const lineas = entradas.map((entrada) => {
    const tasa = entrada.igvPorcentaje ?? igvPorcentaje
    const factor = 1 + tasa / 100
    const totalLinea = Math.round(centavos(entrada.precioUnitario) * entrada.cantidad)
    const base = entrada.afectoIgv && factor > 0 ? Math.round(totalLinea / factor) : totalLinea
    const igv = entrada.afectoIgv && factor > 0 ? totalLinea - base : 0

    subtotalCentavos += base
    igvCentavos += igv
    totalCentavos += totalLinea

    return {
      valorUnitario: soles(base / entrada.cantidad),
      precioUnitario: entrada.precioUnitario,
      igv: soles(igv),
      total: soles(totalLinea),
      afectoIgv: entrada.afectoIgv,
    }
  })

  return {
    lineas,
    subtotal: soles(subtotalCentavos),
    igv: soles(igvCentavos),
    total: soles(totalCentavos),
  }
}
