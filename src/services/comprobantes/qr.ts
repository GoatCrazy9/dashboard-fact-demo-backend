/**
 * Texto del QR que DEMO incrusta en el PDF del comprobante. Se decodificó de
 * `20000000001-B001-00000431.PDF` y `20000000001-F001-00000084.PDF`: usa saltos
 * `CR` y la etiqueta «Factura No.» también en boletas; se conserva tal cual.
 */
export interface DatosQrComprobante {
  razonSocial: string
  direccion: string
  ruc: string
  numero: number
}

export function textoQrComprobante(datos: DatosQrComprobante): string {
  return [
    datos.razonSocial,
    datos.direccion,
    '  ',
    `RUC: ${datos.ruc}`,
    'LIMA',
    '  ',
    `Factura No. ${String(datos.numero).padStart(8, '0')}`,
  ].join('\r')
}
