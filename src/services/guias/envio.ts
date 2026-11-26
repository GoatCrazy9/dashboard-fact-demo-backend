import type { EstadoGuiaSunat } from '@prisma/client'
import { prisma } from '../../lib/prisma.ts'
import { errores } from '../../lib/http.ts'
import { archivarCdrGuia, archivarGuia } from '../almacenamiento/guias.ts'
import {
  ClienteGre,
  configuracionGre,
  prepararGuiaSunat,
  validarGuiaSunat,
  type ResultadoTicketGuia,
} from '../sunat/sunat-gre/cliente.ts'
import type { GuiaAEnviar } from '../sunat/sunat-direct/guias.ts'
import { serializarGuia } from './serializar.ts'

const mensajeDe = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const incluir = {
  cliente: true,
  comprobante: { select: { id: true, tipo: true, serie: true, numero: true } },
  items: { include: { producto: { select: { unidad: true } } } },
} as const

/**
 * Construye el DespatchAdvice desde la guía guardada. La empresa, el cliente y
 * los productos se leen aquí para que el XML siempre use los datos vigentes.
 */
async function aGuiaAEnviar(
  id: string,
  opciones: { reenvio?: boolean } = {},
): Promise<GuiaAEnviar> {
  const guia = await prisma.guiaRemision.findUnique({ where: { id }, include: incluir })
  if (!guia) throw errores.noEncontrado('La guía no existe.')
  if (guia.estado === 'ANULADA') throw errores.conflicto('La guía está anulada; no se puede enviar.')
  if (opciones.reenvio && !['ERROR_ENVIO', 'RECHAZADO'].includes(guia.estadoSunat ?? '')) {
    throw errores.conflicto(
      'Solo se puede reenviar una guía con error de envío o rechazada por SUNAT.',
    )
  }
  if (guia.pesoKg === null || Number(guia.pesoKg) <= 0) {
    throw errores.invalido('La guía necesita un peso bruto mayor a cero para enviarse a SUNAT.')
  }

  const empresa = await prisma.empresa.findFirst()
  if (!empresa) {
    throw errores.invalido('Falta registrar los datos de la empresa emisora (ejecuta el seed).')
  }

  return {
    id: guia.id,
    serie: guia.serie,
    numero: guia.numero,
    fechaEmision: guia.fechaEmision,
    fechaTraslado: guia.fechaTraslado,
    creadoEn: guia.creadoEn,
    motivo: guia.motivo,
    modalidad: guia.modalidad,
    pesoKg: Number(guia.pesoKg),
    direccionPartida: guia.direccionPartida,
    direccionLlegada: guia.direccionLlegada,
    ubigeoPartida: guia.ubigeoPartida,
    ubigeoLlegada: guia.ubigeoLlegada,
    placa: guia.placa ?? '',
    conductor: guia.conductor ?? '',
    conductorDocumento: guia.conductorDocumento ?? '',
    conductorLicencia: guia.conductorLicencia ?? '',
    transportistaRuc: guia.transportistaRuc,
    transportistaRazonSocial: guia.transportistaRazonSocial,
    transportistaRegistroMtc: guia.transportistaRegistroMtc,
    notas: guia.notas,
    comprobante: guia.comprobante,
    emisor: {
      ruc: empresa.ruc,
      razonSocial: empresa.razonSocial,
      direccion: empresa.direccion,
      ubigeo: empresa.ubigeo,
    },
    receptor: {
      tipoDocumento: guia.cliente.tipoDocumento,
      numeroDocumento: guia.cliente.numeroDocumento,
      razonSocial: guia.cliente.razonSocial,
      direccion: guia.cliente.direccion,
    },
    items: guia.items.map((item) => ({
      descripcion: item.descripcion,
      cantidad: Number(item.cantidad),
      unidad: item.producto?.unidad ?? 'NIU',
    })),
  }
}

async function recargar(id: string) {
  const fila = await prisma.guiaRemision.findUniqueOrThrow({ where: { id }, include: incluir })
  return serializarGuia(fila)
}

interface DatosGuardados {
  ticket: string | null
  estado: EstadoGuiaSunat
  codigo: string | null
  mensaje: string | null
  cdrKey?: string | null
  enviadoEn?: Date
}

async function guardar(id: string, datos: DatosGuardados) {
  const fila = await prisma.guiaRemision.update({
    where: { id },
    data: {
      estadoSunat: datos.estado,
      sunatCodigo: datos.codigo,
      sunatMensaje: datos.mensaje,
      sunatTicket: datos.ticket,
      ...(datos.enviadoEn && { enviadoEn: datos.enviadoEn }),
      ...(datos.cdrKey !== undefined && { archivoCdrKey: datos.cdrKey }),
    },
    include: incluir,
  })
  return serializarGuia(fila)
}

async function archivar(guia: GuiaAEnviar, archivos: Parameters<typeof archivarGuia>[1]) {
  try {
    return await archivarGuia(guia, archivos)
  } catch (error) {
    // SUNAT ya respondió; un fallo del Object Storage no invalida el envío.
    console.error('[archivo-guia] No se pudo archivar el paquete:', error)
    return null
  }
}

async function archivarConstancia(guia: GuiaAEnviar, cdrBase64: string): Promise<string | null> {
  try {
    return await archivarCdrGuia(guia, cdrBase64)
  } catch (error) {
    // El CDR fue aceptado por SUNAT; el almacenamiento no puede deshacer eso.
    console.error('[archivo-guia] No se pudo archivar el CDR:', error)
    return null
  }
}

async function aplicarResultadoTicket(
  id: string,
  guia: GuiaAEnviar,
  resultado: ResultadoTicketGuia,
  ticket: string,
) {
  const cdrKey = resultado.cdrBase64 ? await archivarConstancia(guia, resultado.cdrBase64) : undefined
  return guardar(id, {
    ticket,
    estado: resultado.estado,
    codigo: resultado.codigo,
    mensaje: resultado.mensaje,
    cdrKey,
  })
}

/**
 * Envía la guía a la API REST de SUNAT y solo responde cuando hay ticket y se
 * ha consultado su estado. Un error antes del ticket se registra como
 * ERROR_ENVIO; un error al consultar conserva el ticket en PENDIENTE para que
 * se pueda recuperar sin reenviar. Nunca se transforma en emisión local.
 */
export async function enviarYRegistrarGuia(id: string, opciones: { reenvio?: boolean } = {}) {
  validarGuiaSunat()
  const guia = await aGuiaAEnviar(id, opciones)
  const cliente = new ClienteGre(configuracionGre())
  const paquete = await prepararGuiaSunat(guia)
  const enviadoEn = new Date()

  let ticket: string
  try {
    const enviado = await cliente.enviar(guia, paquete)
    ticket = enviado.ticket
  } catch (error) {
    await guardar(id, {
      ticket: null,
      estado: 'ERROR_ENVIO',
      codigo: null,
      mensaje: mensajeDe(error),
      enviadoEn,
    })
    throw error
  }

  const claves = await archivar(guia, paquete.archivos)
  await guardar(id, {
    ticket,
    estado: 'PENDIENTE',
    codigo: '98',
    mensaje: 'SUNAT recibió la guía. Esperando constancia CDR.',
    cdrKey: claves?.cdrKey ?? null,
    enviadoEn,
  })

  let resultado: ResultadoTicketGuia
  try {
    resultado = await cliente.esperarTicket(ticket)
  } catch (error) {
    await guardar(id, {
      ticket,
      estado: 'PENDIENTE',
      codigo: '98',
      mensaje: `SUNAT recibió la guía, pero no se pudo consultar el ticket: ${mensajeDe(error)}. Usa "Actualizar estado" para reintentar sin reenviar.`,
    })
    return recargar(id)
  }

  await aplicarResultadoTicket(id, guia, resultado, ticket)
  return recargar(id)
}

/** Consulta el ticket guardado sin generar un nuevo envío ni consumir serie. */
export async function consultarEstadoGuia(id: string) {
  const guiaGuardada = await prisma.guiaRemision.findUnique({
    where: { id },
    select: { estadoSunat: true, sunatTicket: true },
  })
  if (!guiaGuardada) throw errores.noEncontrado('La guía no existe.')
  if (!guiaGuardada.sunatTicket) {
    throw errores.invalido('Esta guía no tiene un ticket de SUNAT pendiente.')
  }
  if (guiaGuardada.estadoSunat === 'ACEPTADO') return recargar(id)

  validarGuiaSunat()
  const guia = await aGuiaAEnviar(id)
  const cliente = new ClienteGre(configuracionGre())
  try {
    const resultado = await cliente.consultar(guiaGuardada.sunatTicket)
    await aplicarResultadoTicket(id, guia, resultado, guiaGuardada.sunatTicket)
  } catch (error) {
    await guardar(id, {
      ticket: guiaGuardada.sunatTicket,
      estado: 'PENDIENTE',
      codigo: '98',
      mensaje: `No se pudo consultar el ticket en SUNAT: ${mensajeDe(error)}. El envío sigue registrado; usa "Actualizar estado" para reintentar.`,
    })
  }
  return recargar(id)
}
