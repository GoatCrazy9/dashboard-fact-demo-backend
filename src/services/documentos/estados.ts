import type { EstadoDocumentoVenta } from '@prisma/client'

/** CONVERTIDO es terminal: el documento ya tiene un comprobante asociado. */
export const TRANSICIONES: Record<EstadoDocumentoVenta, readonly EstadoDocumentoVenta[]> = {
  PENDIENTE: ['APROBADO', 'RECHAZADO'],
  APROBADO: ['PENDIENTE', 'RECHAZADO'],
  RECHAZADO: ['PENDIENTE'],
  CONVERTIDO: [],
}

export const transicionValida = (
  actual: EstadoDocumentoVenta,
  siguiente: EstadoDocumentoVenta,
): boolean => actual === siguiente || TRANSICIONES[actual].includes(siguiente)
