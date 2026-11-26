import QRCode from 'qrcode'

/** Matriz de módulos: 1 = oscuro. La usa el generador de PDF para incrustar el QR. */
export function matrizQr(texto: string): { size: number; datos: Uint8Array } {
  const qr = QRCode.create(texto, { errorCorrectionLevel: 'M' })
  return { size: qr.modules.size, datos: qr.modules.data }
}

/** PNG listo para `<img>`, usado por la vista del comprobante. */
export function dataUrlQr(texto: string): Promise<string> {
  return QRCode.toDataURL(texto, {
    errorCorrectionLevel: 'M',
    margin: 2,
    width: 240,
    type: 'image/png',
  })
}
