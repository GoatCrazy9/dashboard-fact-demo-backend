import type { MotivoGuia, ModalidadGuia } from '@prisma/client'
import { prisma } from '../../lib/prisma.ts'
import { errores } from '../../lib/http.ts'
import { aFecha, fechaValida } from '../../lib/fechas.ts'
import { reservarSecuencia } from '../documentos/secuencia.ts'
import { validarGuiaSunat } from '../sunat/sunat-gre/cliente.ts'
import { enviarYRegistrarGuia } from './envio.ts'
import { serializarGuia } from './serializar.ts'
import {
  conductorGuiaValido,
  datosTransportistaValidos,
  transportistaValido,
  ubigeoValido,
} from './validacion.ts'

export { serializarGuia } from './serializar.ts'

const SERIE_POR_DEFECTO = 'T001'

export interface EntradaItemGuia {
  productoId: string
  cantidad: number
}

export interface EntradaGuia {
  fechaEmision: string
  fechaTraslado: string
  clienteId: string
  motivo: MotivoGuia
  modalidad: ModalidadGuia
  pesoKg?: number | null
  direccionPartida: string
  direccionLlegada: string
  ubigeoPartida?: string | null
  ubigeoLlegada?: string | null
  placa?: string | null
  conductor?: string | null
  conductorDocumento?: string | null
  conductorLicencia?: string | null
  transportistaRuc?: string | null
  transportistaRazonSocial?: string | null
  transportistaRegistroMtc?: string | null
  notas?: string | null
  comprobanteId?: string | null
  serie?: string
  items: EntradaItemGuia[]
}

const incluir = {
  cliente: true,
  comprobante: { select: { id: true, tipo: true, serie: true, numero: true } },
} as const

async function recargar(id: string) {
  const fila = await prisma.guiaRemision.findUnique({
    where: { id },
    include: { ...incluir, items: true },
  })
  if (!fila) throw errores.noEncontrado('La guía no existe.')
  return serializarGuia(fila)
}

function textoRequerido(valor: string, campo: string) {
  if (valor.trim().length < 5) {
    throw errores.invalido(`${campo} debe tener al menos 5 caracteres.`)
  }
}

export async function crearGuia(entrada: EntradaGuia) {
  // Sin la configuración real de GRE no se reserva correlativo ni se guarda la guía.
  validarGuiaSunat()
  if (!fechaValida(entrada.fechaEmision) || !fechaValida(entrada.fechaTraslado)) {
    throw errores.invalido('Las fechas de emisión y traslado deben ser válidas.')
  }
  if (entrada.fechaTraslado < entrada.fechaEmision) {
    throw errores.invalido('La fecha de traslado no puede ser anterior a la emisión.')
  }
  if (!ubigeoValido(entrada.ubigeoPartida) || !ubigeoValido(entrada.ubigeoLlegada)) {
    throw errores.invalido('El ubigeo debe tener 6 dígitos.')
  }
  if (!transportistaValido(entrada.modalidad, entrada.placa, entrada.conductor)) {
    throw errores.invalido('El traslado público exige placa y conductor.')
  }
  if (
    !conductorGuiaValido(
      entrada.modalidad,
      entrada.conductorDocumento,
      entrada.conductorLicencia,
    )
  ) {
    throw errores.invalido('El traslado público exige documento y licencia del conductor.')
  }
  if (
    !datosTransportistaValidos(
      entrada.transportistaRuc,
      entrada.transportistaRazonSocial,
      entrada.transportistaRegistroMtc,
    )
  ) {
    throw errores.invalido('Si indicas transportista, falta su razón social o registro MTC.')
  }
  const pesoKg = entrada.pesoKg
  if (!pesoKg || pesoKg <= 0) {
    throw errores.invalido('El peso bruto es obligatorio para el envío a SUNAT.')
  }
  textoRequerido(entrada.direccionPartida, 'La dirección de partida')
  textoRequerido(entrada.direccionLlegada, 'La dirección de llegada')

  const cliente = await prisma.cliente.findUnique({ where: { id: entrada.clienteId } })
  if (!cliente) throw errores.noEncontrado('El cliente indicado no existe.')

  if (entrada.comprobanteId) {
    const comprobante = await prisma.comprobante.findUnique({
      where: { id: entrada.comprobanteId },
      select: { estado: true },
    })
    if (!comprobante) throw errores.noEncontrado('El comprobante asociado no existe.')
    if (comprobante.estado === 'ANULADO') {
      throw errores.conflicto('No se puede asociar un comprobante anulado.')
    }
  }

  const ids = [...new Set(entrada.items.map((item) => item.productoId))]
  const productos = await prisma.producto.findMany({ where: { id: { in: ids } } })
  if (productos.length !== ids.length) {
    throw errores.invalido('Uno de los productos seleccionados ya no existe.')
  }

  const creada = await prisma.$transaction(async (tx) => {
    const numero = await reservarSecuencia(tx, 'GUIA')
    return tx.guiaRemision.create({
      data: {
        serie: entrada.serie?.trim() || SERIE_POR_DEFECTO,
        numero,
        fechaEmision: aFecha(entrada.fechaEmision),
        fechaTraslado: aFecha(entrada.fechaTraslado),
        clienteId: cliente.id,
        motivo: entrada.motivo,
        modalidad: entrada.modalidad,
        pesoKg: pesoKg.toFixed(3),
        direccionPartida: entrada.direccionPartida.trim(),
        direccionLlegada: entrada.direccionLlegada.trim(),
        ubigeoPartida: entrada.ubigeoPartida?.trim() || null,
        ubigeoLlegada: entrada.ubigeoLlegada?.trim() || null,
        placa: entrada.placa?.trim() || null,
        conductor: entrada.conductor?.trim() || null,
        conductorDocumento: entrada.conductorDocumento?.trim() || null,
        conductorLicencia: entrada.conductorLicencia?.trim() || null,
        transportistaRuc: entrada.transportistaRuc?.trim() || null,
        transportistaRazonSocial: entrada.transportistaRazonSocial?.trim() || null,
        transportistaRegistroMtc: entrada.transportistaRegistroMtc?.trim() || null,
        estadoSunat: 'PENDIENTE',
        notas: entrada.notas?.trim() || null,
        comprobanteId: entrada.comprobanteId || null,
        items: {
          create: entrada.items.map((item) => {
            const producto = productos.find((p) => p.id === item.productoId)!
            return {
              productoId: producto.id,
              descripcion: producto.descripcion,
              cantidad: item.cantidad.toFixed(3),
            }
          }),
        },
      },
      include: { ...incluir, items: true },
    })
  })

  // Se guarda primero para tener correlativo e id, pero la respuesta solo se
  // devuelve cuando la API REST de SUNAT ha entregado ticket y estado del CDR.
  return enviarYRegistrarGuia(creada.id)
}

export async function listarGuias() {
  const filas = await prisma.guiaRemision.findMany({
    include: incluir,
    orderBy: [{ fechaEmision: 'desc' }, { creadoEn: 'desc' }],
    take: 300,
  })
  return filas.map(serializarGuia)
}

export async function obtenerGuia(id: string) {
  return recargar(id)
}

export async function anularGuia(id: string, motivo: string) {
  const guia = await prisma.guiaRemision.findUnique({
    where: { id },
    select: { estado: true, estadoSunat: true },
  })
  if (!guia) throw errores.noEncontrado('La guía no existe.')
  if (guia.estado === 'ANULADA') throw errores.conflicto('La guía ya está anulada.')
  if (guia.estadoSunat === 'ACEPTADO') {
    throw errores.conflicto(
      'La guía fue aceptada por SUNAT; requiere comunicación de baja antes de anularla.',
    )
  }

  await prisma.guiaRemision.update({
    where: { id },
    data: {
      estado: 'ANULADA',
      motivoAnulacion: motivo.trim(),
      anuladoEn: new Date(),
    },
  })
  return recargar(id)
}
