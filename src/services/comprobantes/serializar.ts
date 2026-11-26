import type { Prisma } from '@prisma/client'

export const aNumero = (valor: Prisma.Decimal | number | null | undefined): number =>
  valor == null ? 0 : Number(valor)

type ComprobanteConRelaciones = Prisma.ComprobanteGetPayload<{
  include: { cliente: true }
}>

/** Forma que consume el frontend (`web/src/shared/types.ts`). */
export function aResumenComprobante(row: ComprobanteConRelaciones) {
  return {
    id: row.id,
    clienteId: row.clienteId,
    tipo: row.tipo,
    serie: row.serie,
    numero: row.numero,
    fecha: row.fecha.toISOString(),
    cliente: row.cliente.razonSocial,
    clienteDocumento: row.cliente.numeroDocumento,
    clienteDireccion: row.cliente.direccion,
    clienteTelefono: row.cliente.telefono,
    creadoEn: row.creadoEn.toISOString(),
    subtotal: aNumero(row.subtotal),
    igv: aNumero(row.igv),
    total: aNumero(row.total),
    moneda: row.moneda,
    tipoCambio: aNumero(row.tipoCambio),
    estado: row.estado,
    sunatCodigo: row.sunatCodigo,
    sunatMensaje: row.sunatMensaje,
    sunatTicket: row.sunatTicket,
    archivos: {
      xml: Boolean(row.archivoXmlKey),
      zip: Boolean(row.archivoZipKey),
      cdr: Boolean(row.archivoCdrKey),
    },
    documentoAfectado: row.documentoAfectado,
    motivoNota: row.motivoNota,
    motivoAnulacion: row.motivoAnulacion,
    anuladoEn: row.anuladoEn?.toISOString() ?? null,
    detraccionCodigo: row.detraccionCodigo,
    detraccionTasa: aNumero(row.detraccionTasa),
    detraccionMonto: aNumero(row.detraccionMonto),
  }
}
