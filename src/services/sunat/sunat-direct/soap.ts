import { DOMParser } from '@xmldom/xmldom'
import { errores } from '../../../lib/http.ts'
import { leerXmlDelCdr } from './zip.ts'

const SOAP = 'http://schemas.xmlsoap.org/soap/envelope/'
const WSSE =
  'http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd'
const WSU = 'http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd'
const SERVICIO = 'http://service.sunat.gob.pe'

const escapar = (valor: string): string =>
  valor
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')

/** Subconjunto estructural de un nodo DOM, para no depender de los tipos globales del DOM. */
interface NodoXml {
  readonly nodeType: number
  readonly localName?: string | null
  readonly textContent?: string | null
  readonly childNodes?: ArrayLike<NodoXml>
}

function buscarNodo(node: NodoXml, nombreLocal: string): NodoXml | null {
  if (node.nodeType === 1 && node.localName?.toLowerCase() === nombreLocal.toLowerCase()) return node
  for (const hijo of Array.from(node.childNodes ?? [])) {
    const encontrado = buscarNodo(hijo, nombreLocal)
    if (encontrado) return encontrado
  }
  return null
}

const texto = (elemento: NodoXml | null): string => elemento?.textContent?.trim() ?? ''

function leerFalta(documento: NodoXml): { codigo: string; mensaje: string } | null {
  const fault = buscarNodo(documento, 'Fault')
  if (!fault) return null
  const codigo = texto(buscarNodo(fault, 'faultcode')) || texto(buscarNodo(fault, 'code')) || 'FAULT'
  const base =
    texto(buscarNodo(fault, 'faultstring')) ||
    texto(buscarNodo(fault, 'reason')) ||
    texto(buscarNodo(fault, 'message')) ||
    'SUNAT devolvió un error SOAP.'
  // SUNAT suele poner el número de regla en faultstring y el detalle (nodo y
  // valor) en <detail>; sin eso el reenvío no dice qué corregir.
  const detalle = texto(buscarNodo(fault, 'detail'))
  const mensaje = detalle && !base.includes(detalle) ? `${base} — ${detalle}` : base
  return { codigo, mensaje }
}

export interface SolicitudSendBill {
  ruc: string
  usuario: string
  password: string
  nombreArchivo: string
  contenidoZip: Buffer
}

function construirEnvelope(
  credenciales: { ruc: string; usuario: string; password: string },
  operacion: string,
  cuerpo: string,
): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<soapenv:Envelope xmlns:soapenv="${SOAP}" xmlns:ser="${SERVICIO}">`,
    '  <soapenv:Header>',
    `    <wsse:Security soapenv:mustUnderstand="1" xmlns:wsse="${WSSE}" xmlns:wsu="${WSU}">`,
    '      <wsse:UsernameToken wsu:Id="UsernameToken-1">',
    `        <wsse:Username>${escapar(credenciales.usuario || credenciales.ruc)}</wsse:Username>`,
    `        <wsse:Password Type="${WSSE}#PasswordText">${escapar(credenciales.password)}</wsse:Password>`,
    '      </wsse:UsernameToken>',
    '    </wsse:Security>',
    '  </soapenv:Header>',
    '  <soapenv:Body>',
    `    <ser:${operacion}>`,
    cuerpo,
    `    </ser:${operacion}>`,
    '  </soapenv:Body>',
    '</soapenv:Envelope>',
    '',
  ].join('\n')
}

/** SOAP + WS-Security UsernameToken (_password text_, tal como lo espera sendBill). */
export function construirSolicitudSendBill(solicitud: SolicitudSendBill): string {
  return construirEnvelope(
    solicitud,
    'sendBill',
    [
      `      <fileName>${escapar(solicitud.nombreArchivo)}</fileName>`,
      `      <contentFile>${solicitud.contenidoZip.toString('base64')}</contentFile>`,
    ].join('\n'),
  )
}

/** sendSummary recibe el ZIP y devuelve un ticket de atención asíncrono. */
export function construirSolicitudSendSummary(solicitud: SolicitudSendBill): string {
  return construirEnvelope(
    solicitud,
    'sendSummary',
    [
      `      <fileName>${escapar(solicitud.nombreArchivo)}</fileName>`,
      `      <contentFile>${solicitud.contenidoZip.toString('base64')}</contentFile>`,
    ].join('\n'),
  )
}

export function construirSolicitudGetStatus(
  solicitud: { ruc: string; usuario: string; password: string; ticket: string },
): string {
  return construirEnvelope(
    solicitud,
    'getStatus',
    `      <ticket>${escapar(solicitud.ticket)}</ticket>`,
  )
}

export interface RespuestaSendBill {
  cdrBase64: string | null
  falla: { codigo: string; mensaje: string } | null
}

export function parseRespuestaSendBill(xml: string): RespuestaSendBill {
  const documento = new DOMParser().parseFromString(xml, 'text/xml') as unknown as NodoXml
  const falla = leerFalta(documento)
  if (falla) return { cdrBase64: null, falla }

  const applicationResponse =
    buscarNodo(documento, 'applicationResponse') ??
    buscarNodo(documento, 'ApplicationResponse') ??
    buscarNodo(documento, 'return')
  const cdrBase64 = texto(applicationResponse)
  if (!cdrBase64) throw new Error('La respuesta de SUNAT no contiene el CDR (applicationResponse).')
  return { cdrBase64, falla: null }
}

export interface ResultadoCdr {
  estado: 'ACEPTADO' | 'RECHAZADO'
  codigo: string
  mensaje: string | null
}

/** Código 0 = comprobante aceptado; cualquier otro código es una observación o rechazo. */
export function interpretarCdr(xmlCdr: string): ResultadoCdr {
  const documento = new DOMParser().parseFromString(xmlCdr, 'text/xml') as unknown as NodoXml
  const codigo = texto(buscarNodo(documento, 'ResponseCode')) || 'SIN_CODIGO'
  return {
    estado: codigo === '0' ? 'ACEPTADO' : 'RECHAZADO',
    codigo,
    mensaje: texto(buscarNodo(documento, 'Description')) || null,
  }
}

export async function interpretarRespuesta(
  cdrBase64: string,
  decode: (contenido: string) => Promise<string> = leerXmlDelCdr,
): Promise<ResultadoCdr> {
  return interpretarCdr(await decode(cdrBase64))
}

export interface OpcionesEnvioSendBill extends SolicitudSendBill {
  endpoint: string
  timeoutMs?: number
  clienteFetch?: typeof fetch
}

export async function enviarSendBill(opciones: OpcionesEnvioSendBill): Promise<RespuestaSendBill> {
  const clienteFetch = opciones.clienteFetch ?? fetch
  const respuesta = await clienteFetch(opciones.endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset=utf-8',
      Accept: 'text/xml',
      SOAPAction: 'sendBill',
    },
    body: construirSolicitudSendBill(opciones),
    signal: AbortSignal.timeout(opciones.timeoutMs ?? 30_000),
  })
  const cuerpo = await respuesta.text()
  const parseada = parseRespuestaSendBill(cuerpo)

  if (parseada.falla) return parseada
  if (!respuesta.ok) {
    throw errores.sunat(`SUNAT respondió HTTP ${respuesta.status} al enviar el comprobante.`)
  }
  return parseada
}

/* --- Envío asíncrono de resumen diario y comunicación de baja --- */

export interface RespuestaSendSummary {
  ticket: string | null
  falla: { codigo: string; mensaje: string } | null
}

export function parseRespuestaSendSummary(xml: string): RespuestaSendSummary {
  const documento = new DOMParser().parseFromString(xml, 'text/xml') as unknown as NodoXml
  const falla = leerFalta(documento)
  if (falla) return { ticket: null, falla }
  const ticket = texto(buscarNodo(documento, 'ticket'))
  if (!ticket) throw new Error('La respuesta de SUNAT no contiene el ticket de atención.')
  return { ticket, falla: null }
}

export interface RespuestaGetStatus {
  /** 0 = CDR listo, 98 = en proceso, 99 = proceso con errores (hay CDR). */
  codigo: string
  mensaje: string | null
  cdrBase64: string | null
  falla: { codigo: string; mensaje: string } | null
}

export function parseRespuestaGetStatus(xml: string): RespuestaGetStatus {
  const documento = new DOMParser().parseFromString(xml, 'text/xml') as unknown as NodoXml
  const falla = leerFalta(documento)
  if (falla) return { codigo: 'FAULT', mensaje: falla.mensaje, cdrBase64: null, falla }
  const estado = buscarNodo(documento, 'status') ?? documento
  const codigo = texto(buscarNodo(estado, 'statusCode')) || 'SIN_CODIGO'
  const mensaje = texto(buscarNodo(estado, 'statusMessage')) || null
  const cdrBase64 =
    texto(buscarNodo(estado, 'content')) || texto(buscarNodo(estado, 'contentFile')) || null
  return { codigo, mensaje, cdrBase64, falla: null }
}

export interface OpcionesEnvioTicket {
  ruc: string
  usuario: string
  password: string
  endpoint: string
  timeoutMs?: number
  clienteFetch?: typeof fetch
}

async function invocarSoap(
  opciones: OpcionesEnvioTicket,
  soapAction: string,
  cuerpo: string,
): Promise<string> {
  const clienteFetch = opciones.clienteFetch ?? fetch
  const respuesta = await clienteFetch(opciones.endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset=utf-8',
      Accept: 'text/xml',
      SOAPAction: soapAction,
    },
    body: cuerpo,
    signal: AbortSignal.timeout(opciones.timeoutMs ?? 30_000),
  })
  const textoRespuesta = await respuesta.text()
  // SUNAT responde los faults con prefijo (soap-env:Fault, soap:Fault) y a
  // menudo con HTTP 500. Detectar solo '<Fault' los convertía en errores HTTP
  // genéricos y ocultaba el código real (por ejemplo Server.200).
  if (/<(?:[\w.-]+:)?Fault\b/.test(textoRespuesta)) return textoRespuesta
  if (!respuesta.ok) {
    throw errores.sunat(`SUNAT respondió HTTP ${respuesta.status} a ${soapAction}.`)
  }
  return textoRespuesta
}

export async function enviarSendSummary(
  opciones: OpcionesEnvioSendBill,
): Promise<RespuestaSendSummary> {
  const xml = construirSolicitudSendSummary(opciones)
  return parseRespuestaSendSummary(await invocarSoap(opciones, 'sendSummary', xml))
}

export async function consultarEstadoTicket(
  opciones: OpcionesEnvioTicket & { ticket: string },
): Promise<RespuestaGetStatus> {
  const xml = construirSolicitudGetStatus(opciones)
  return parseRespuestaGetStatus(await invocarSoap(opciones, 'getStatus', xml))
}
