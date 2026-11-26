import { apisperuConfigurado, env, sunatDirectConfigurado } from '../../config/env.ts'
import { errores } from '../../lib/http.ts'
import { prisma } from '../../lib/prisma.ts'
import { archivarResumen } from '../almacenamiento/cpe.ts'
import {
  cargarCertificado,
  consultarEstadoTicket,
  empaquetarXml,
  enviarSendSummary,
  firmarXmlXades,
  generarXmlResumen,
  interpretarCdr,
  leerXmlDelCdr,
  nombreArchivoResumen,
  configuracionDirecta,
  type ResumenParaEnviar,
} from '../sunat/sunat-direct/index.ts'
import type { RespuestaGetStatus } from '../sunat/sunat-direct/soap.ts'
import { serializarResumen } from './serializar.ts'

const MENSAJE_LOCAL =
  'Registro local: no se realizó ningún envío a SUNAT ni se usaron credenciales.'

/** Solo el emisor oficial directo puede enviar RC/RA; nunca un API de terceros. */
export function resumenesConEnvioReal(): boolean {
  const proveedor =
    env.sunatProveedor === 'auto'
      ? apisperuConfigurado
        ? 'apisperu'
        : 'direct'
      : env.sunatProveedor
  return proveedor === 'direct' && sunatDirectConfigurado
}

async function cargarResumen(id: string) {
  const resumen = await prisma.resumenSunat.findUnique({
    where: { id },
    include: {
      items: { include: { comprobante: { include: { cliente: true } } } },
    },
  })
  if (!resumen) throw errores.noEncontrado('El resumen no existe.')
  const empresa = await prisma.empresa.findFirst()
  if (!empresa) {
    throw errores.invalido('Falta registrar los datos de la empresa emisora (ejecuta el seed).')
  }
  return { resumen, empresa }
}

function aResumenParaEnviar(
  resumen: Awaited<ReturnType<typeof cargarResumen>>['resumen'],
  empresa: Awaited<ReturnType<typeof cargarResumen>>['empresa'],
): ResumenParaEnviar {
  return {
    tipo: resumen.tipo,
    numero: resumen.numero,
    fecha: resumen.fecha,
    emisor: { ruc: empresa.ruc, razonSocial: empresa.razonSocial },
    observacion: resumen.observacion,
    items: resumen.items.map((item) => ({
      tipoDocumento: item.tipoDocumento,
      serie: item.serie,
      numero: item.numero,
      clienteDocumento: item.clienteDocumento,
      tipoDocumentoCliente: item.comprobante.cliente.tipoDocumento,
      documentoAfectado: item.comprobante.documentoAfectado,
      fechaEmision: item.fechaEmision,
      subtotal: Number(item.subtotal),
      igv: Number(item.igv),
      total: Number(item.total),
      moneda: item.comprobante.moneda || 'PEN',
      motivoBaja: item.motivoBaja,
    })),
  }
}

async function actualizar(
  id: string,
  datos: {
    estado: 'GENERADO' | 'PENDIENTE' | 'ACEPTADO' | 'RECHAZADO'
    codigo: string
    mensaje: string
    ticket?: string | null
    claves?: Awaited<ReturnType<typeof archivarResumen>>
  },
) {
  await prisma.resumenSunat.update({
    where: { id },
    data: {
      estado: datos.estado,
      codigoRespuesta: datos.codigo,
      mensajeRespuesta: datos.mensaje,
      ...(datos.ticket !== undefined ? { sunatTicket: datos.ticket } : {}),
      ...(datos.claves && {
        archivoXmlKey: datos.claves.xmlKey,
        archivoZipKey: datos.claves.zipKey,
        archivoCdrKey: datos.claves.cdrKey,
      }),
    },
  })
}

async function archivar(id: string, cdrBase64: string | null = null) {
  try {
    const { resumen, empresa } = await cargarResumen(id)
    const datos = aResumenParaEnviar(resumen, empresa)
    const xmlFirmado = firmarXmlXades(
      generarXmlResumen(datos),
      cargarCertificado(configuracionDirecta().certificado),
    )
    const zip = await empaquetarXml(nombreArchivoResumen(datos, 'xml'), xmlFirmado)
    return await archivarResumen({
      ruc: empresa.ruc,
      fecha: resumen.fecha,
      prefijo: resumen.tipo === 'RESUMEN_DIARIO' ? 'RC' : 'RA',
      numero: resumen.numero,
      xmlFirmado,
      zip,
      cdrBase64,
    })
  } catch (error) {
    console.error('[archivo-resumen] No se pudo archivar el paquete:', error)
    return null
  }
}

function codigoAceptado(codigo: string): boolean {
  return codigo === '0' || /^4\d{3}$/.test(codigo)
}

/**
 * Los faults Server.* son de infraestructura de SUNAT (por ejemplo Server.200
 * "Failed to establish a backside connection"): el ticket sigue vigente y se
 * reintenta. Los Client.* sí invalidan el ticket y permiten un envío nuevo.
 */
export function esFalloTransitorioSunat(codigo: string): boolean {
  return /(?:^|[.:])Server(?:\.|$)/i.test(codigo)
}

/** Interpreta la constancia devuelta por getStatus y actualiza el resumen. */
export async function registrarRespuestaTicket(id: string, respuesta: RespuestaGetStatus) {
  if (respuesta.falla) {
    const transitorio = esFalloTransitorioSunat(respuesta.falla.codigo)
    await actualizar(id, {
      estado: transitorio ? 'PENDIENTE' : 'RECHAZADO',
      codigo: respuesta.falla.codigo,
      mensaje: transitorio
        ? `SUNAT no pudo atender la consulta (${respuesta.falla.mensaje}). El ticket sigue vigente; usa "Actualizar estado" para reintentar.`
        : respuesta.falla.mensaje,
      ...(transitorio ? {} : { ticket: null }),
    })
    return serializarResumen(
      await prisma.resumenSunat.findUniqueOrThrow({ where: { id }, include: { items: true } }),
    )
  }

  if (respuesta.codigo === '98' || !respuesta.cdrBase64) {
    await actualizar(id, {
      estado: 'PENDIENTE',
      codigo: respuesta.codigo,
      mensaje: respuesta.mensaje ?? 'SUNAT aún está procesando el resumen.',
    })
    return serializarResumen(
      await prisma.resumenSunat.findUniqueOrThrow({ where: { id }, include: { items: true } }),
    )
  }

  const cdr = interpretarCdr(await leerXmlDelCdr(respuesta.cdrBase64))
  await actualizar(id, {
    estado: codigoAceptado(cdr.codigo) ? 'ACEPTADO' : 'RECHAZADO',
    codigo: cdr.codigo,
    mensaje: cdr.mensaje ?? respuesta.mensaje ?? 'Constancia recibida de SUNAT.',
    claves: await archivar(id, respuesta.cdrBase64),
  })
  return serializarResumen(
    await prisma.resumenSunat.findUniqueOrThrow({ where: { id }, include: { items: true } }),
  )
}

/** Un fallo de transporte no invalida el ticket: se conserva para reintentar. */
async function registrarTicketSinConstancia(id: string, ticket: string, detalle: string) {
  await actualizar(id, {
    estado: 'PENDIENTE',
    codigo: ticket,
    mensaje: `Enviado a SUNAT. Sin constancia aún (${detalle}). Usa "Actualizar estado" para consultar el ticket.`,
  })
  return serializarResumen(
    await prisma.resumenSunat.findUniqueOrThrow({ where: { id }, include: { items: true } }),
  )
}

async function enviarDirecto(id: string) {
  const { resumen, empresa } = await cargarResumen(id)
  const datos = aResumenParaEnviar(resumen, empresa)
  const configuracion = configuracionDirecta()
  const certificado = cargarCertificado(configuracion.certificado)
  const xmlFirmado = firmarXmlXades(generarXmlResumen(datos), certificado)
  const zip = await empaquetarXml(nombreArchivoResumen(datos, 'xml'), xmlFirmado)

  const enviado = await enviarSendSummary({
    ruc: configuracion.ruc || empresa.ruc,
    usuario: configuracion.usuario,
    password: configuracion.password,
    nombreArchivo: nombreArchivoResumen(datos, 'zip'),
    contenidoZip: zip,
    endpoint: configuracion.endpoint,
    timeoutMs: configuracion.timeoutMs,
  })

  if (enviado.falla) {
    await actualizar(id, {
      estado: 'RECHAZADO',
      codigo: enviado.falla.codigo,
      mensaje: enviado.falla.mensaje,
    })
    return serializarResumen(
      await prisma.resumenSunat.findUniqueOrThrow({ where: { id }, include: { items: true } }),
    )
  }

  const ticket = enviado.ticket!
  await actualizar(id, {
    estado: 'PENDIENTE',
    codigo: ticket,
    mensaje: 'Enviado a SUNAT. Esperando constancia de recepción (CDR).',
    ticket,
    claves: await archivar(id),
  })

  // En beta el CDR suele estar listo en segundos. Si la consulta agota el timeout
  // o falla la red, el ticket SIGUE SIENDO VÁLIDO: se conserva PENDIENTE para que
  // se pueda reintentar con "Actualizar estado". Nunca se marca ERROR_ENVIO.
  try {
    const estado = await consultarEstadoTicket({
      ruc: configuracion.ruc || empresa.ruc,
      usuario: configuracion.usuario,
      password: configuracion.password,
      ticket,
      endpoint: configuracion.endpoint,
      timeoutMs: configuracion.timeoutMs,
    })
    return registrarRespuestaTicket(id, estado)
  } catch (error) {
    return registrarTicketSinConstancia(id, ticket, error instanceof Error ? error.message : String(error))
  }
}

/** Envía el resumen con SUNAT si hay credenciales; si no, deja el registro local. */
export async function enviarResumen(id: string) {
  try {
    if (resumenesConEnvioReal()) return await enviarDirecto(id)
    const { resumen } = await cargarResumen(id)
    await actualizar(id, {
      estado: 'ACEPTADO',
      codigo: resumen.tipo === 'COMUNICACION_BAJA' ? 'LOCAL-BAJA' : 'LOCAL-RESUMEN',
      mensaje: MENSAJE_LOCAL,
    })
  } catch (error) {
    const detalle = error instanceof Error ? error.message : String(error)
    await actualizar(id, {
      estado: 'RECHAZADO',
      codigo: 'ERROR_ENVIO',
      mensaje: detalle,
    }).catch(() => undefined)
  }
  return serializarResumen(
    await prisma.resumenSunat.findUniqueOrThrow({ where: { id }, include: { items: true } }),
  )
}

/**
 * Mientras exista ticket y no se haya archivado el CDR, la consulta del ticket
 * es accionable aunque el registro diga RECHAZADO por un error de transporte.
 */
export function debeConsultarTicket(
  resumen: { sunatTicket: string | null; archivoCdrKey: string | null },
): boolean {
  return Boolean(resumen.sunatTicket && !resumen.archivoCdrKey)
}

export async function consultarTicketResumen(id: string) {
  const { resumen, empresa } = await cargarResumen(id)
  if (!resumen.sunatTicket || !debeConsultarTicket(resumen) || !resumenesConEnvioReal()) {
    throw errores.invalido('Este registro no tiene un ticket de SUNAT pendiente.')
  }
  const configuracion = configuracionDirecta()
  try {
    const respuesta = await consultarEstadoTicket({
      ruc: configuracion.ruc || empresa.ruc,
      usuario: configuracion.usuario,
      password: configuracion.password,
      ticket: resumen.sunatTicket,
      endpoint: configuracion.endpoint,
      timeoutMs: configuracion.timeoutMs,
    })
    return registrarRespuestaTicket(id, respuesta)
  } catch (error) {
    return registrarTicketSinConstancia(
      id,
      resumen.sunatTicket,
      error instanceof Error ? error.message : String(error),
    )
  }
}

/** Reenvío real (nuevo ticket) o simulado, según la configuración del servidor. */
export async function reenviarResumen(id: string) {
  const actual = await prisma.resumenSunat.findUnique({ where: { id } })
  if (!actual) throw errores.noEncontrado('El resumen no existe.')

  if (debeConsultarTicket(actual)) {
    return consultarTicketResumen(id)
  }
  if (actual.estado === 'ACEPTADO' && resumenesConEnvioReal()) {
    throw errores.conflicto('El resumen ya fue aceptado por SUNAT; no se debe enviar dos veces.')
  }

  await prisma.resumenSunat.update({
    where: { id },
    data: { reenvios: actual.reenvios + 1 },
  })
  const resultado = await enviarResumen(id)
  if (resultado.estado === 'RECHAZADO' && resultado.codigoRespuesta === 'ERROR_ENVIO') {
    throw errores.sunat(resultado.mensajeRespuesta ?? 'No se pudo reenviar el resumen.')
  }
  return resultado
}
