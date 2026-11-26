import type { EstadoGuiaSunat, MotivoGuia, ModalidadGuia, Prisma } from '@prisma/client'

export interface FilaGuia {
  id: string
  serie: string
  numero: number
  fechaEmision: Date
  fechaTraslado: Date
  cliente: {
    id: string
    razonSocial: string
    numeroDocumento: string
    direccion: string | null
  }
  motivo: MotivoGuia
  modalidad: ModalidadGuia
  pesoKg: Prisma.Decimal | null
  direccionPartida: string
  direccionLlegada: string
  ubigeoPartida: string | null
  ubigeoLlegada: string | null
  placa: string | null
  conductor: string | null
  conductorDocumento: string | null
  conductorLicencia: string | null
  transportistaRuc: string | null
  transportistaRazonSocial: string | null
  transportistaRegistroMtc: string | null
  notas: string | null
  comprobante: { id: string; tipo: string; serie: string; numero: number } | null
  estado: string
  estadoSunat: EstadoGuiaSunat | null
  sunatCodigo: string | null
  sunatMensaje: string | null
  sunatTicket: string | null
  archivoCdrKey: string | null
  enviadoEn: Date | null
  motivoAnulacion: string | null
  anuladoEn: Date | null
  creadoEn: Date
  items?: {
    id: string
    productoId: string
    descripcion: string
    cantidad: Prisma.Decimal
  }[]
}

export function serializarGuia(fila: FilaGuia) {
  return {
    id: fila.id,
    serie: fila.serie,
    numero: fila.numero,
    fechaEmision: fila.fechaEmision.toISOString(),
    fechaTraslado: fila.fechaTraslado.toISOString(),
    clienteId: fila.cliente.id,
    cliente: fila.cliente.razonSocial,
    clienteDocumento: fila.cliente.numeroDocumento,
    clienteDireccion: fila.cliente.direccion,
    motivo: fila.motivo,
    modalidad: fila.modalidad,
    pesoKg: fila.pesoKg === null ? null : Number(fila.pesoKg),
    direccionPartida: fila.direccionPartida,
    direccionLlegada: fila.direccionLlegada,
    ubigeoPartida: fila.ubigeoPartida,
    ubigeoLlegada: fila.ubigeoLlegada,
    placa: fila.placa,
    conductor: fila.conductor,
    conductorDocumento: fila.conductorDocumento,
    conductorLicencia: fila.conductorLicencia,
    transportistaRuc: fila.transportistaRuc,
    transportistaRazonSocial: fila.transportistaRazonSocial,
    transportistaRegistroMtc: fila.transportistaRegistroMtc,
    notas: fila.notas,
    comprobante: fila.comprobante,
    estado: fila.estado,
    estadoSunat: fila.estadoSunat,
    sunatCodigo: fila.sunatCodigo,
    sunatMensaje: fila.sunatMensaje,
    sunatTicket: fila.sunatTicket,
    tieneCdr: Boolean(fila.archivoCdrKey),
    enviadoEn: fila.enviadoEn?.toISOString() ?? null,
    motivoAnulacion: fila.motivoAnulacion,
    anuladoEn: fila.anuladoEn?.toISOString() ?? null,
    creadoEn: fila.creadoEn.toISOString(),
    items: (fila.items ?? []).map((item) => ({
      id: item.id,
      productoId: item.productoId,
      descripcion: item.descripcion,
      cantidad: Number(item.cantidad),
    })),
  }
}
