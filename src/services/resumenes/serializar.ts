import type { Prisma } from '@prisma/client'

type FilaResumen = Prisma.ResumenSunatGetPayload<{ include: { items: true } }>

export const numeroResumen = (serie: string, numero: number): string =>
  `${serie}-${String(numero).padStart(3, '0')}`

export function serializarResumen(fila: FilaResumen) {
  return {
    id: fila.id,
    tipo: fila.tipo,
    serie: fila.serie,
    numero: fila.numero,
    numeroCompleto: numeroResumen(fila.serie, fila.numero),
    fecha: fila.fecha.toISOString(),
    estado: fila.estado,
    codigoRespuesta: fila.codigoRespuesta,
    mensajeRespuesta: fila.mensajeRespuesta,
    observacion: fila.observacion,
    sunatTicket: fila.sunatTicket,
    archivoXmlKey: fila.archivoXmlKey,
    archivoZipKey: fila.archivoZipKey,
    archivoCdrKey: fila.archivoCdrKey,
    reenvios: fila.reenvios,
    creadoEn: fila.creadoEn.toISOString(),
    actualizadoEn: fila.actualizadoEn.toISOString(),
    items: [...fila.items]
      .sort((a, b) => a.serie.localeCompare(b.serie) || a.numero - b.numero)
      .map((item) => ({
        id: item.id,
        comprobanteId: item.comprobanteId,
        tipoDocumento: item.tipoDocumento,
        serie: item.serie,
        numero: item.numero,
        numeroCompleto: numeroResumen(item.serie, item.numero),
        clienteDocumento: item.clienteDocumento,
        fechaEmision: item.fechaEmision.toISOString(),
        subtotal: Number(item.subtotal),
        igv: Number(item.igv),
        total: Number(item.total),
        motivoBaja: item.motivoBaja,
      })),
  }
}
