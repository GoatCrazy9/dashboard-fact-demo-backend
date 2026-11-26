import type { CpeAEnviar, ProveedorSunat } from './types.ts'
import { generarXmlCpe } from './sunat-direct/xml.ts'
import { empaquetarXml, nombreArchivoCpe } from './sunat-direct/zip.ts'

const escapar = (valor: string): string =>
  valor
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')

/**
 * CDR simulado. No es un CDR de SUNAT: solo permite demostrar la descarga
 * del paquete XML/ZIP/CDR sin contactar al proveedor oficial ni usar certificado.
 */
function generarCdrLocal(cpe: CpeAEnviar): string {
  const numero = `${cpe.serie}-${String(cpe.numero).padStart(8, '0')}`
  const fecha = cpe.fecha.toISOString().slice(0, 10)

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<DemoCdr xmlns="urn:demo:facturacion:cdr">',
    `  <NumeroComprobante>${escapar(numero)}</NumeroComprobante>`,
    `  <FechaEmision>${fecha}</FechaEmision>`,
    `  <RucEmisor>${escapar(cpe.emisor.ruc)}</RucEmisor>`,
    '  <CodigoRespuesta>0</CodigoRespuesta>',
    '  <MensajeRespuesta>DEMO LOCAL: comprobante aceptado sin envio a SUNAT.</MensajeRespuesta>',
    '  <Observacion>Este CDR es generado por el simulador local y no tiene validez tributaria.</Observacion>',
    '</DemoCdr>',
  ].join('\n')
}

/**
 * Proveedor de desarrollo sin red. Genera los mismos artefactos que el emisor
 * directo (XML, ZIP y CDR simulado) para que el demo pueda descargarlos.
 */
export const proveedorLocal: ProveedorSunat = {
  nombre: 'local',

  async enviar(cpe) {
    const xmlGenerado = generarXmlCpe(cpe)
    const xmlFirmado = xmlGenerado.replace(
      /^(<\?xml[^>]*\?>)/,
      '$1\n<!-- DEMO LOCAL: sin firma digital ni envio a SUNAT -->',
    )
    const zip = await empaquetarXml(nombreArchivoCpe(cpe, 'xml'), xmlFirmado)
    const cdrBase64 = Buffer.from(generarCdrLocal(cpe), 'utf8').toString('base64')

    return {
      estado: 'ACEPTADO' as const,
      codigo: 'LOCAL',
      mensaje: 'Modo de prueba local: no se envió a SUNAT. XML/ZIP/CDR generados para demostración.',
      uuid: null,
      archivos: { xmlFirmado, zip, cdrBase64 },
    }
  },
}
