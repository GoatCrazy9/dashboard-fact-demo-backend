import JSZip from 'jszip'
import type { CpeAEnviar } from '../types.ts'
import { codigoTipoComprobante } from './catalogos.ts'

/** RUC-Tipo-Serie-Numero, según el nombre exigido por SUNAT para el XML y el ZIP. */
export function nombreArchivoCpe(cpe: CpeAEnviar, extension: 'xml' | 'zip'): string {
  return `${cpe.emisor.ruc}-${codigoTipoComprobante(cpe.tipo)}-${cpe.serie}-${cpe.numero}.${extension}`
}

export async function empaquetarXml(nombreXml: string, xml: string): Promise<Buffer> {
  const zip = new JSZip()
  zip.file(nombreXml, xml)
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
}

/** El CDR que devuelve SUNAT también es un ZIP con un único XML. */
export async function leerXmlDelCdr(cdrBase64: string): Promise<string> {
  const zip = await JSZip.loadAsync(Buffer.from(cdrBase64, 'base64'))
  const archivo = Object.values(zip.files).find((entrada) => !entrada.dir && /\.xml$/i.test(entrada.name))
  if (!archivo) throw new Error('El CDR recibido de SUNAT no contiene un XML de respuesta.')
  return archivo.async('string')
}
