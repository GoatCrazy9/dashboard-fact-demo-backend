/**
 * Texto del QR que SICAP incrusta en el PDF del comprobante. Se decodificó de
 * `10101222221-B001-00000431.PDF` y `10101222221-F001-00000084.PDF`: usa saltos
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
