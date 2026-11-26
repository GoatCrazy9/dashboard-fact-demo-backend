import type { GuiaAEnviar } from '../sunat/sunat-direct/guias.ts'
import type { ArchivosEnvio } from '../sunat/types.ts'
import { archivarCdr, archivarPaquete, clavesArchivoPaquete, type ClavesArchivoCpe } from './cpe.ts'

/** Las guías tienen su propio prefijo para no mezclarse con facturas y boletas. */
export function claveBaseGuia(guia: GuiaAEnviar): string {
  const [anio, mes] = guia.fechaEmision.toISOString().slice(0, 10).split('-')
  const numero = String(guia.numero).padStart(8, '0')
  return `guia/${guia.emisor.ruc}/${anio}/${mes}/T-${guia.serie}-${numero}`
}

export function clavesArchivoGuia(guia: GuiaAEnviar, conCdr: boolean): ClavesArchivoCpe {
  return clavesArchivoPaquete({ base: claveBaseGuia(guia), cdrBase64: conCdr ? 'cdr' : null })
}

/** Igual que `archivarCpe`, pero con llaves de guía de remisión. */
export async function archivarGuia(
  guia: GuiaAEnviar,
  archivos: ArchivosEnvio,
): Promise<ClavesArchivoCpe | null> {
  return archivarPaquete({ base: claveBaseGuia(guia), ...archivos })
}

/** Guarda el CDR del ticket sin volver a subir el XML y el ZIP. */
export async function archivarCdrGuia(
  guia: GuiaAEnviar,
  cdrBase64: string,
): Promise<string | null> {
  return archivarCdr(claveBaseGuia(guia), cdrBase64)
}
