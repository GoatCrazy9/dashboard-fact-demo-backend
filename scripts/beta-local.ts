/**
 * Beta local: genera el XML firmado y el ZIP con firmabeta.pfx SIN enviar nada a SUNAT.
 *
 * Uso:
 *   npx tsx scripts/beta-local.ts
 *
 * La contraseña se toma solo de BETA_PFX_PASSWORD o BETA_PFX_PASSWORD_FILE.
 * Nunca se lee la clave del certificado de producción.
 *
 * Opcional: BETA_PFX_PATH y BETA_LOCAL_OUT.
 */
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'

import {
  cargarCertificado,
  prepararPaquete,
} from '../src/services/sunat/sunat-direct/index.ts'
import type { CpeAEnviar } from '../src/services/sunat/types.ts'

const rutaPfx =
  process.env.BETA_PFX_PATH ??
  'C:\\Users\\mauri\\Desktop\\SICAP\\MUEBLEJO\\CPE\\FIRMABETA\\firmabeta.pfx'
const archivoClave = process.env.BETA_PFX_PASSWORD_FILE
const password =
  process.env.BETA_PFX_PASSWORD ??
  (archivoClave ? readFileSync(archivoClave, 'utf8').trim() : '')
const salida =
  process.env.BETA_LOCAL_OUT ??
  'C:\\Users\\mauri\\AppData\\Local\\Temp\\opencode\\beta-local'

const cpe: CpeAEnviar = {
  id: 'beta-local-1',
  tipo: 'FACTURA',
  serie: 'F001',
  numero: 7,
  fecha: new Date('2026-11-25T00:00:00.000Z'),
  moneda: 'PEN',
  emisor: {
    ruc: '20123456789',
    razonSocial: 'Mueblería José S.A.C.',
    direccion: 'Av. Los Muebles 123, Lima',
    ubigeo: '150101',
  },
  receptor: {
    tipoDocumento: 'RUC',
    numeroDocumento: '20600123456',
    razonSocial: 'Cliente de prueba S.A.C.',
    direccion: null,
  },
  lineas: [
    {
      descripcion: 'Mesa de prueba <roble> "Jardín"',
      cantidad: 1,
      unidad: 'NIU',
      valorUnitario: 100,
      precioUnitario: 118,
      igv: 18,
      total: 118,
      afectoIgv: true,
    },
  ],
  subtotal: 100,
  igv: 18,
  total: 118,
  observacion: 'PRUEBA BETA LOCAL · DATOS FICTICIOS · NO ENVÍADA A SUNAT',
}

const sha256 = (contenido: Buffer | string) =>
  createHash('sha256').update(contenido).digest('hex')

async function main() {
  if (!password) {
    throw new Error('Define BETA_PFX_PASSWORD o BETA_PFX_PASSWORD_FILE antes de ejecutar.')
  }

  const origenClave = archivoClave ? basename(archivoClave) : 'BETA_PFX_PASSWORD'
  const certificado = cargarCertificado({ pfxPath: rutaPfx, pfxPassword: password })
  const paquete = await prepararPaquete(cpe, certificado)

  mkdirSync(salida, { recursive: true })
  const rutaXml = join(salida, paquete.nombreXml)
  const rutaZip = join(salida, paquete.nombreZip)

  writeFileSync(rutaXml, paquete.xmlFirmado, 'utf8')
  writeFileSync(rutaZip, paquete.zip)

  console.log('CERTIFICADO:', basename(rutaPfx))
  console.log('CLAVE_DESDE:', origenClave)
  console.log('SALIDA:', salida)
  console.log('XML:', paquete.nombreXml, Buffer.byteLength(paquete.xmlFirmado), 'bytes')
  console.log('ZIP:', paquete.nombreZip, paquete.zip.length, 'bytes')
  console.log('SHA256_XML:', sha256(paquete.xmlFirmado))
  console.log('SHA256_ZIP:', sha256(paquete.zip))
  console.log('TIENE_FIRMA:', paquete.xmlFirmado.includes('<ds:Signature'))
  console.log('RED:', 'ninguna; prepararPaquete no llama a SUNAT')
}

main().catch((error) => {
  const mensaje = error instanceof Error ? error.message : String(error)
  console.error('No se pudo generar el paquete beta local:', mensaje)
  console.error(
    'Si el PFX tiene contraseña, define BETA_PFX_PASSWORD antes de ejecutar el script.',
  )
  process.exit(1)
})
