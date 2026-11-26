import { createHash } from 'node:crypto'
import { env } from '../../../config/env.ts'
import { errores } from '../../../lib/http.ts'
import { configuracionDirecta } from '../sunat-direct/cliente.ts'
import { cargarCertificado, type CertificadoFirma } from '../sunat-direct/firma.ts'
import {
  prepararPaqueteGuia,
  type GuiaAEnviar,
  type PaqueteGuia,
} from '../sunat-direct/guias.ts'
import { interpretarCdr } from '../sunat-direct/soap.ts'
import { leerXmlDelCdr } from '../sunat-direct/zip.ts'
import type { ArchivosEnvio } from '../types.ts'

/**
 * SUNAT no tiene beta para guías: la plataforma nueva GRE solo existe en
 * producción (API REST + OAuth). Este módulo no tiene modo local ni fallbacks.
 */
export interface ConfiguracionGre {
  ruc: string
  usuarioSol: string
  password: string
  clientId: string
  clientSecret: string
  tokenEndpoint: string
  apiBase: string
  timeoutMs: number
  intentos: number
  intervaloMs: number
}

const SCOPE = 'https://api-cpe.sunat.gob.pe'

function texto(valor: unknown): string {
  return typeof valor === 'string' ? valor.trim() : valor == null ? '' : String(valor).trim()
}

function objeto(valor: unknown): Record<string, unknown> {
  return valor && typeof valor === 'object' && !Array.isArray(valor)
    ? (valor as Record<string, unknown>)
    : {}
}

export function configuracionGre(): ConfiguracionGre {
  if (env.sunatProveedor !== 'direct') {
    throw errores.invalido(
      'Las guías requieren SUNAT_PROVEEDOR=direct; no se admite modo local ni proveedor externo.',
    )
  }
  if (env.sunatGreModo !== 'produccion') {
    throw errores.invalido(
      'SUNAT no ofrece beta para guías. Configura SUNAT_GRE_MODO=produccion y las credenciales API de GRE para emitir.',
    )
  }
  const directa = configuracionDirecta()
  const ruc = directa.ruc.trim()
  if (!ruc) throw errores.invalido('Falta SUNAT_RUC para emitir guías por la API REST de SUNAT.')
  if (!env.sunatGreClientId || !env.sunatGreClientSecret) {
    throw errores.invalido(
      'Faltan SUNAT_GRE_CLIENT_ID o SUNAT_GRE_CLIENT_SECRET de la API REST de GRE.',
    )
  }
  const usuario = directa.usuario.trim()
  return {
    ruc,
    usuarioSol: usuario.startsWith(ruc) ? usuario : `${ruc}${usuario}`,
    password: directa.password,
    clientId: env.sunatGreClientId.trim(),
    clientSecret: env.sunatGreClientSecret.trim(),
    tokenEndpoint: env.sunatGreTokenEndpoint,
    apiBase: env.sunatGreApiBase,
    timeoutMs: env.sunatGreTimeoutMs,
    intentos: Math.max(1, env.sunatGreIntentos),
    intervaloMs: Math.max(0, env.sunatGreIntervaloMs),
  }
}

let cacheCertificado: { clave: string; certificado: CertificadoFirma } | null = null

/** El certificado se valida antes de reservar el correlativo. */
export function certificadoGre(): CertificadoFirma {
  const opciones = configuracionDirecta().certificado
  const clave = JSON.stringify(opciones)
  if (cacheCertificado?.clave !== clave) {
    cacheCertificado = { clave, certificado: cargarCertificado(opciones) }
  }
  return cacheCertificado.certificado
}

export function validarGuiaSunat(): void {
  configuracionGre()
  certificadoGre()
}

export async function prepararGuiaSunat(
  guia: GuiaAEnviar,
): Promise<PaqueteGuia & { archivos: ArchivosEnvio }> {
  const paquete = await prepararPaqueteGuia(guia, certificadoGre())
  return {
    ...paquete,
    archivos: { xmlFirmado: paquete.xmlFirmado, zip: paquete.zip, cdrBase64: null },
  }
}

/** No se registran tokens ni mensajes que puedan contener credenciales. */
function detalleTransporte(error: unknown): string {
  const causa = error instanceof Error && 'cause' in error ? objeto(error.cause) : {}
  const codigo = texto(causa.code)
  const nombre = error instanceof Error ? error.name : 'Error'
  return codigo
    ? `No se pudo conectar con SUNAT GRE (${codigo}).`
    : `No se pudo conectar con SUNAT GRE (${nombre}).`
}

function servicioError(respuesta: Response, cuerpo: string): Error {
  const datos = objeto(leeJson(cuerpo))
  const codigo = texto(datos.cod) || String(respuesta.status)
  const mensaje = texto(datos.msg) || texto(datos.message)
  const erroresDetalle = Array.isArray(datos.errors)
    ? datos.errors
        .map((entrada) => {
          const item = objeto(entrada)
          const codigoItem = texto(item.codError) || texto(item.cod)
          const detalle = texto(item.desError) || texto(item.msg)
          return [codigoItem, detalle].filter(Boolean).join(' - ')
        })
        .filter(Boolean)
        .join('; ')
    : ''
  const detalle = [mensaje, erroresDetalle].filter(Boolean).join(' — ')
  return errores.sunat(`SUNAT GRE ${codigo}: ${detalle || `HTTP ${respuesta.status}`}`)
}

function leeJson(cuerpo: string): unknown {
  if (!cuerpo) return {}
  try {
    return JSON.parse(cuerpo) as unknown
  } catch {
    return {}
  }
}

async function leerRespuesta(respuesta: Response): Promise<Record<string, unknown>> {
  const cuerpo = await respuesta.text()
  if (!respuesta.ok) throw servicioError(respuesta, cuerpo)
  const datos = objeto(leeJson(cuerpo))
  if (Object.keys(datos).length === 0) {
    throw errores.sunat(`SUNAT GRE devolvió una respuesta vacía (HTTP ${respuesta.status}).`)
  }
  return datos
}

export interface ResultadoTicketGuia {
  estado: 'ACEPTADO' | 'RECHAZADO' | 'PENDIENTE'
  codigo: string
  mensaje: string | null
  cdrBase64: string | null
}

interface TokenCache {
  valor: string
  expiraEn: number
  clientId: string
}

let cacheToken: TokenCache | null = null

/** Permite reiniciar el token en pruebas o al cambiar de credenciales. */
export function reiniciarCacheGre(): void {
  cacheToken = null
  cacheCertificado = null
}

export interface DependenciasGre {
  clienteFetch?: typeof fetch
  esperar?: (milisegundos: number) => Promise<void>
}

export class ClienteGre {
  private readonly clienteFetch: typeof fetch
  private readonly esperar: (milisegundos: number) => Promise<void>

  constructor(
    private readonly config: ConfiguracionGre = configuracionGre(),
    dependencias: DependenciasGre = {},
  ) {
    this.clienteFetch = dependencias.clienteFetch ?? fetch
    this.esperar =
      dependencias.esperar ??
      ((milisegundos) => new Promise((resolver) => setTimeout(resolver, milisegundos)))
  }

  private async ejecutar(url: string, init: RequestInit): Promise<Response> {
    try {
      return await this.clienteFetch(url, {
        ...init,
        signal: AbortSignal.timeout(this.config.timeoutMs),
      })
    } catch (error) {
      throw errores.sunat(detalleTransporte(error))
    }
  }

  private async token(forzar = false): Promise<string> {
    const ahora = Date.now()
    if (
      !forzar &&
      cacheToken?.clientId === this.config.clientId &&
      cacheToken.expiraEn > ahora
    ) {
      return cacheToken.valor
    }

    const url = `${this.config.tokenEndpoint.replace(/\/$/, '')}/clientessol/${encodeURIComponent(this.config.clientId)}/oauth2/token/`
    const cuerpo = new URLSearchParams({
      grant_type: 'password',
      scope: SCOPE,
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      username: this.config.usuarioSol,
      password: this.config.password,
    })
    const respuesta = await this.ejecutar(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: cuerpo.toString(),
    })
    const datos = await leerRespuesta(respuesta)
    const valor = texto(datos.access_token)
    if (!valor) throw errores.sunat('SUNAT GRE no devolvió un token de acceso.')
    const segundos = Number(datos.expires_in ?? 3600)
    const vigenciaMs = Number.isFinite(segundos) && segundos > 0 ? segundos * 1000 : 3_600_000
    const margenMs = Math.min(60_000, vigenciaMs / 4)
    cacheToken = {
      valor,
      expiraEn: ahora + Math.max(30_000, vigenciaMs - margenMs),
      clientId: this.config.clientId,
    }
    return valor
  }

  private async conToken(
    url: string,
    init: Omit<RequestInit, 'headers'> & { headers?: Record<string, string> },
  ): Promise<Record<string, unknown>> {
    const headers: Record<string, string> = {
      ...(init.headers ?? {}),
      Authorization: `Bearer ${await this.token()}`,
    }
    let respuesta = await this.ejecutar(url, { ...init, headers })
    if (respuesta.status === 401) {
      const reintento = { ...headers, Authorization: `Bearer ${await this.token(true)}` }
      respuesta = await this.ejecutar(url, { ...init, headers: reintento })
    }
    return leerRespuesta(respuesta)
  }

  /** Envía el ZIP y devuelve el ticket; SUNAT no entrega el CDR en esta llamada. */
  async enviar(guia: GuiaAEnviar, paquete: PaqueteGuia): Promise<{
    ticket: string
    fechaRecepcion: string | null
  }> {
    if (guia.emisor.ruc !== this.config.ruc) {
      throw errores.invalido(
        'El RUC de la empresa registrada no coincide con SUNAT_RUC; no se puede enviar la guía.',
      )
    }
    const nombre = paquete.nombreZip.replace(/\.zip$/i, '')
    const url = `${this.config.apiBase.replace(/\/$/, '')}/contribuyente/gem/comprobantes/${encodeURIComponent(nombre)}`
    const hashZip = createHash('sha256').update(paquete.zip).digest('hex')
    const datos = await this.conToken(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        archivo: {
          nomArchivo: paquete.nombreZip,
          arcGreZip: paquete.zip.toString('base64'),
          hashZip,
        },
      }),
    })
    const ticket = texto(datos.numTicket)
    if (!ticket) throw errores.sunat('SUNAT GRE no devolvió el número de ticket del envío.')
    return { ticket, fechaRecepcion: texto(datos.fecRecepcion) || null }
  }

  /** Consulta el ticket. Un 98 no es aceptación: sigue sin constancia CDR. */
  async consultar(ticket: string): Promise<ResultadoTicketGuia> {
    const url = `${this.config.apiBase.replace(/\/$/, '')}/contribuyente/gem/comprobantes/envios/${encodeURIComponent(ticket)}`
    const datos = await this.conToken(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    })
    const codigo = texto(datos.codRespuesta)
    if (codigo === '98') {
      return {
        estado: 'PENDIENTE',
        codigo: '98',
        mensaje: 'SUNAT recibió la guía; la constancia CDR aún está en proceso.',
        cdrBase64: null,
      }
    }
    if (codigo !== '0' && codigo !== '99') {
      throw errores.sunat(
        `SUNAT GRE devolvió un código de ticket desconocido (${codigo || 'vacío'}).`,
      )
    }
    const arcCdr = texto(datos.arcCdr)
    if (arcCdr) {
      const cdr = interpretarCdr(await leerXmlDelCdr(arcCdr))
      return {
        estado: cdr.estado,
        codigo: cdr.codigo,
        mensaje: cdr.mensaje,
        cdrBase64: arcCdr,
      }
    }
    if (codigo === '0') {
      throw errores.sunat('SUNAT GRE indicó envío correcto pero no entregó la constancia CDR.')
    }
    const error = objeto(datos.error)
    return {
      estado: 'RECHAZADO',
      codigo: texto(error.numError) || '99',
      mensaje: texto(error.desError) || 'SUNAT rechazó la guía sin generar constancia CDR.',
      cdrBase64: null,
    }
  }

  /** Consulta hasta que haya CDR o hasta el número de intentos configurado. */
  async esperarTicket(
    ticket: string,
    opciones: { intentos?: number; intervaloMs?: number } = {},
  ): Promise<ResultadoTicketGuia> {
    const intentos = Math.max(1, opciones.intentos ?? this.config.intentos)
    const intervaloMs = Math.max(0, opciones.intervaloMs ?? this.config.intervaloMs)
    for (let intento = 0; intento < intentos; intento += 1) {
      const resultado = await this.consultar(ticket)
      if (resultado.estado !== 'PENDIENTE') return resultado
      if (intento < intentos - 1) await this.esperar(intervaloMs)
    }
    return {
      estado: 'PENDIENTE',
      codigo: '98',
      mensaje: `SUNAT recibió la guía y sigue procesándola (ticket ${ticket}); la constancia CDR aún no está lista.`,
      cdrBase64: null,
    }
  }
}
