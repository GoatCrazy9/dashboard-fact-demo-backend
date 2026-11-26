import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { env, objectStorageConfigurado } from '../../config/env.ts'
import type { ArchivosEnvio, CpeAEnviar } from '../sunat/types.ts'

export type TipoArchivoCpe = 'xml' | 'zip' | 'cdr'

export interface ClavesArchivoCpe {
  xmlKey: string
  zipKey: string
  cdrKey: string | null
}

/** Base de llaves compartida por comprobantes, resúmenes y guías de remisión. */
export interface DatosArchivoPaquete {
  base: string
  xmlFirmado: string
  zip: Buffer
  cdrBase64?: string | null
}

export function clavesArchivoPaquete(datos: Pick<DatosArchivoPaquete, 'base' | 'cdrBase64'>): ClavesArchivoCpe {
  return {
    xmlKey: `${datos.base}.xml`,
    zipKey: `${datos.base}.zip`,
    cdrKey: datos.cdrBase64 ? `${datos.base}-cdr.xml` : null,
  }
}

/** Archiva XML firmado, ZIP y CDR con llaves deterministas. */
export async function archivarPaquete(datos: DatosArchivoPaquete): Promise<ClavesArchivoCpe | null> {
  if (!objectStorageConfigurado) return null

  const claves = clavesArchivoPaquete(datos)
  const objetos = [
    {
      key: claves.xmlKey,
      body: Buffer.from(datos.xmlFirmado, 'utf8'),
      contentType: 'application/xml',
    },
    { key: claves.zipKey, body: datos.zip, contentType: 'application/zip' },
  ]

  if (claves.cdrKey && datos.cdrBase64) {
    objetos.push({
      key: claves.cdrKey,
      body: Buffer.from(datos.cdrBase64, 'base64'),
      contentType: 'application/xml',
    })
  }

  await Promise.all(
    objetos.map((objeto) =>
      s3().send(
        new PutObjectCommand({
          Bucket: env.objectBucket,
          Key: objeto.key,
          Body: objeto.body,
          ContentType: objeto.contentType,
        }),
      ),
    ),
  )

  return claves
}

let cliente: S3Client | null = null

/** Cliente S3 de Neon: path-style y SigV4, como exige su endpoint. */
function s3(): S3Client {
  if (!cliente) {
    cliente = new S3Client({
      endpoint: env.objectEndpoint,
      region: env.objectRegion,
      forcePathStyle: true,
      credentials: {
        accessKeyId: env.objectAccessKeyId,
        secretAccessKey: env.objectSecretAccessKey,
      },
    })
  }
  return cliente
}

/** Archiva solo el CDR cuando la respuesta del ticket llega después del envío. */
export async function archivarCdr(base: string, cdrBase64: string): Promise<string | null> {
  if (!objectStorageConfigurado || !cdrBase64) return null
  const clave = `${base}-cdr.xml`
  await s3().send(
    new PutObjectCommand({
      Bucket: env.objectBucket,
      Key: clave,
      Body: Buffer.from(cdrBase64, 'base64'),
      ContentType: 'application/xml',
    }),
  )
  return clave
}

function claveBase(cpe: CpeAEnviar): string {
  const [anio, mes] = cpe.fecha.toISOString().slice(0, 10).split('-')
  const numero = String(cpe.numero).padStart(8, '0')
  return `cpe/${cpe.emisor.ruc}/${anio}/${mes}/${cpe.serie}-${numero}`
}

/** Llaves deterministas: el mismo comprobante siempre cae en el mismo objeto. */
export function clavesArchivoCpe(cpe: CpeAEnviar, conCdr: boolean): ClavesArchivoCpe {
  return clavesArchivoPaquete({ base: claveBase(cpe), cdrBase64: conCdr ? 'cdr' : null })
}

/**
 * Archiva el XML firmado, el ZIP enviado y el CDR en Object Storage.
 * Devuelve null si el almacenamiento no está configurado: la emisión no depende de él.
 */
export async function archivarCpe(
  cpe: CpeAEnviar,
  archivos: ArchivosEnvio,
): Promise<ClavesArchivoCpe | null> {
  return archivarPaquete({ base: claveBase(cpe), ...archivos })
}

export async function descargarArchivoCpe(key: string): Promise<Buffer> {
  const respuesta = await s3().send(
    new GetObjectCommand({ Bucket: env.objectBucket, Key: key }),
  )
  const bytes = await respuesta.Body?.transformToByteArray()
  if (!bytes) throw new Error('Object Storage devolvió un archivo vacío.')
  return Buffer.from(bytes)
}

/* --- XML firmado, ZIP y CDR de resúmenes y bajas --- */

export interface DatosArchivoResumen {
  ruc: string
  fecha: Date
  prefijo: 'RC' | 'RA'
  numero: number
  xmlFirmado: string
  zip: Buffer
  cdrBase64?: string | null
}

export interface ClavesArchivoResumen {
  xmlKey: string
  zipKey: string
  cdrKey: string | null
}

export function clavesArchivoResumen(datos: DatosArchivoResumen): ClavesArchivoResumen {
  const [anio, mes] = datos.fecha.toISOString().slice(0, 10).split('-')
  const base = `resumen/${datos.ruc}/${anio}/${mes}/${datos.prefijo}-${datos.fecha.toISOString().slice(0, 10)}-${datos.numero}`
  return clavesArchivoPaquete({ base, cdrBase64: datos.cdrBase64 })
}

/** Igual que `archivarCpe`, pero con llaves propias para RC/RA. */
export async function archivarResumen(
  datos: DatosArchivoResumen,
): Promise<ClavesArchivoResumen | null> {
  const [anio, mes] = datos.fecha.toISOString().slice(0, 10).split('-')
  const base = `resumen/${datos.ruc}/${anio}/${mes}/${datos.prefijo}-${datos.fecha.toISOString().slice(0, 10)}-${datos.numero}`
  return archivarPaquete({
    base,
    xmlFirmado: datos.xmlFirmado,
    zip: datos.zip,
    cdrBase64: datos.cdrBase64,
  })
}
