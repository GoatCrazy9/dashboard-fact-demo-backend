import { env } from '../../../config/env.ts'
import { HttpError, errores } from '../../../lib/http.ts'
import type { CpeAEnviar, ProveedorSunat, ResultadoEnvio } from '../types.ts'
import { cargarCertificado, firmarXmlXades, type CertificadoFirma, type OpcionesCertificado } from './firma.ts'
import { enviarSendBill, interpretarCdr } from './soap.ts'
import { generarXmlCpe } from './xml.ts'
import { empaquetarXml, leerXmlDelCdr, nombreArchivoCpe } from './zip.ts'

export interface ConfiguracionDirecta {
  ruc: string
  usuario: string
  password: string
  endpoint: string
  timeoutMs: number
  certificado: OpcionesCertificado
}

export function endpointDirecto(modo: string = env.sunatModo): string {
  return modo === 'produccion' ? env.sunatDirectEndpointProduccion : env.sunatDirectEndpointBeta
}

export function configuracionDirecta(): ConfiguracionDirecta {
  if (!env.sunatDirectUsuario || !env.sunatDirectPassword) {
    throw errores.invalido('Faltan SUNAT_SOL_USUARIO o SUNAT_SOL_PASSWORD para el proveedor directo.')
  }
  return {
    ruc: env.sunatDirectRuc,
    usuario: env.sunatDirectUsuario,
    password: env.sunatDirectPassword,
    endpoint: endpointDirecto(),
    timeoutMs: env.sunatDirectTimeoutMs,
    certificado: {
      pfxPath: env.sunatDirectPfxPath || undefined,
      pfxBase64: env.sunatDirectPfxBase64 || undefined,
      pfxPassword: env.sunatDirectPfxPassword || undefined,
      certPath: env.sunatDirectCertPath || undefined,
      certPem: env.sunatDirectCertPem || undefined,
      certBase64: env.sunatDirectCertBase64 || undefined,
      keyPath: env.sunatDirectKeyPath || undefined,
      keyPem: env.sunatDirectKeyPem || undefined,
      keyBase64: env.sunatDirectKeyBase64 || undefined,
    },
  }
}

let cacheCertificado: { clave: string; certificado: CertificadoFirma } | null = null

function certificadoDe(opciones: OpcionesCertificado): CertificadoFirma {
  const clave = JSON.stringify(opciones)
  if (cacheCertificado?.clave === clave) return cacheCertificado.certificado
  const certificado = cargarCertificado(opciones)
  cacheCertificado = { clave, certificado }
  return certificado
}

export interface PaqueteDirecto {
  nombreXml: string
  nombreZip: string
  xml: string
  xmlFirmado: string
  zip: Buffer
}

/** Genera el XML, lo firma y lo empaqueta sin salir a la red (útil para pruebas locales). */
export async function prepararPaquete(
  cpe: CpeAEnviar,
  certificado?: CertificadoFirma,
): Promise<PaqueteDirecto> {
  const firmante = certificado ?? certificadoDe(configuracionDirecta().certificado)
  const xml = generarXmlCpe(cpe)
  const xmlFirmado = firmarXmlXades(xml, firmante)
  const nombreXml = nombreArchivoCpe(cpe, 'xml')
  return {
    nombreXml,
    nombreZip: nombreArchivoCpe(cpe, 'zip'),
    xml,
    xmlFirmado,
    zip: await empaquetarXml(nombreXml, xmlFirmado),
  }
}

export const proveedorDirecto: ProveedorSunat = {
  nombre: 'sunat-direct',

  async enviar(cpe: CpeAEnviar): Promise<ResultadoEnvio> {
    const configuracion = configuracionDirecta()
    const { xmlFirmado, zip } = await prepararPaquete(cpe, certificadoDe(configuracion.certificado))
    const archivos = { xmlFirmado, zip, cdrBase64: null as string | null }

    try {
      const respuesta = await enviarSendBill({
        ruc: configuracion.ruc || cpe.emisor.ruc,
        usuario: configuracion.usuario,
        password: configuracion.password,
        nombreArchivo: nombreArchivoCpe(cpe, 'zip'),
        contenidoZip: zip,
        endpoint: configuracion.endpoint,
        timeoutMs: configuracion.timeoutMs,
      })

      if (respuesta.falla) {
        return {
          estado: 'RECHAZADO',
          codigo: respuesta.falla.codigo,
          mensaje: respuesta.falla.mensaje,
          uuid: null,
          archivos,
        }
      }

      archivos.cdrBase64 = respuesta.cdrBase64 ?? null
      const cdr = await interpretarCdr(await leerXmlDelCdr(respuesta.cdrBase64 ?? ''))
      return { estado: cdr.estado, codigo: cdr.codigo, mensaje: cdr.mensaje, uuid: null, archivos }
    } catch (error) {
      if (error instanceof HttpError) throw error
      const detalle = error instanceof Error ? error.message : String(error)
      throw errores.sunat(`No se pudo procesar la respuesta de SUNAT: ${detalle}`)
    }
  },
}
