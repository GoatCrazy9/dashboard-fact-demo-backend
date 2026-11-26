import type { CpeAEnviar } from '../types.ts'
import type { RegimenIgv } from './catalogos.ts'

export const IGV_PORCENTAJE = 18

/** Los importes del comprobante viajan en soles; SUNAT los espera con dos decimales. */
export const aCentavos = (valor: number): number => Math.round(valor * 100)

export const formatoDinero = (centavos: number): string => (centavos / 100).toFixed(2)

export const formatoUnitario = (valor: number): string => (aCentavos(valor) / 100).toFixed(2)

export const formatoCantidad = (cantidad: number): string => String(Number(cantidad.toFixed(3)))

export interface LineaCalculadaDirecta {
  regimen: RegimenIgv
  baseCentavos: number
  igvCentavos: number
  totalCentavos: number
  referenciaCentavos: number
  gratuita: boolean
}

export interface TotalesCalculadosDirectos {
  lineas: LineaCalculadaDirecta[]
  gravadoCentavos: number
  exoneradoCentavos: number
  gratuitoCentavos: number
  igvCentavos: number
  totalCentavos: number
  lineExtensionCentavos: number
  todasGratuitas: boolean
}

/**
 * Recalcula cada línea en centavos a partir de lo que guardó el emisor.
 * Para las líneas onerosas la base es total - IGV: así se conserva el
 * redondeo por línea que ya aplica `calcularComprobante`.
 * Las líneas gratuitas usan el valor referencial (catálogo 16, código 02)
 * para informar la base y el IGV no cobrado, sin sumarlo al importe a pagar.
 */
export function calcularLineas(cpe: CpeAEnviar): LineaCalculadaDirecta[] {
  return cpe.lineas.map((linea) => {
    const totalCentavos = aCentavos(linea.total)
    const igvCentavos = aCentavos(linea.igv)
    const referenciaCentavos = aCentavos(linea.valorReferencial ?? linea.valorUnitario)
    const gratuita = linea.gratuito ?? (totalCentavos === 0 && aCentavos(linea.precioUnitario) === 0)

    if (gratuita) {
      return {
        regimen: 'GRATUITO',
        baseCentavos: Math.round(referenciaCentavos * linea.cantidad),
        igvCentavos: linea.afectoIgv
          ? Math.round((referenciaCentavos * linea.cantidad * IGV_PORCENTAJE) / 100)
          : 0,
        totalCentavos: 0,
        referenciaCentavos,
        gratuita: true,
      }
    }

    return {
      regimen: linea.afectoIgv ? 'GRAVADO' : 'EXONERADO',
      baseCentavos: linea.afectoIgv ? totalCentavos - igvCentavos : totalCentavos,
      igvCentavos: linea.afectoIgv ? igvCentavos : 0,
      totalCentavos,
      referenciaCentavos,
      gratuita: false,
    }
  })
}

export function calcularTotales(cpe: CpeAEnviar): TotalesCalculadosDirectos {
  const lineas = calcularLineas(cpe)
  const totales: TotalesCalculadosDirectos = {
    lineas,
    gravadoCentavos: 0,
    exoneradoCentavos: 0,
    gratuitoCentavos: 0,
    igvCentavos: 0,
    totalCentavos: aCentavos(cpe.total),
    lineExtensionCentavos: 0,
    todasGratuitas: lineas.length > 0 && lineas.every((linea) => linea.gratuita),
  }

  for (const linea of lineas) {
    if (linea.regimen === 'GRAVADO') totales.gravadoCentavos += linea.baseCentavos
    if (linea.regimen === 'EXONERADO') totales.exoneradoCentavos += linea.baseCentavos
    if (linea.gratuita) totales.gratuitoCentavos += linea.baseCentavos
    totales.igvCentavos += linea.igvCentavos
    totales.lineExtensionCentavos += linea.baseCentavos
  }

  return totales
}
