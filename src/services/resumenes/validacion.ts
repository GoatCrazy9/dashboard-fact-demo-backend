import type {
  EstadoComprobante,
  TipoComprobante,
  TipoResumenSunat,
} from '@prisma/client'

export const SERIE_POR_TIPO: Record<TipoResumenSunat, string> = {
  RESUMEN_DIARIO: 'RC001',
  COMUNICACION_BAJA: 'RA001',
}

export const CLAVE_POR_TIPO: Record<TipoResumenSunat, string> = {
  RESUMEN_DIARIO: 'RESUMEN_DIARIO',
  COMUNICACION_BAJA: 'COMUNICACION_BAJA',
}

const esNota = (tipo: TipoComprobante) =>
  tipo === 'NOTA_CREDITO' || tipo === 'NOTA_DEBITO'

/** El resumen diario solo incluye boletas y notas que afectan a una boleta. */
export function esResumible(
  tipo: TipoComprobante,
  estado: EstadoComprobante,
  documentoAfectado?: string | null,
): boolean {
  if (estado !== 'EMITIDO' && estado !== 'ACEPTADO') return false
  if (tipo === 'BOLETA') return true
  return esNota(tipo) && Boolean(documentoAfectado?.startsWith('B'))
}

export const esBajable = (estado: EstadoComprobante): boolean => estado === 'ANULADO'
