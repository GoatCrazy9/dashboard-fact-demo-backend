import {
  env,
  objectStorageConfigurado,
  reniecConfigurado,
  sunatConfigurado,
  sunatDirectCertificadoConfigurado,
} from '../config/env.ts'
import { prisma } from '../lib/prisma.ts'
import { resumenesConEnvioReal } from './resumenes/envio.ts'
import { endpointSunatActual, proveedorActual } from './sunat/index.ts'

export async function obtenerConfiguracion() {
  const [empresa, series] = await Promise.all([
    prisma.empresa.findFirst(),
    prisma.serie.findMany({ orderBy: [{ tipo: 'asc' }, { serie: 'asc' }] }),
  ])

  return {
    empresa: {
      ruc: empresa?.ruc ?? '',
      razonSocial: empresa?.razonSocial ?? '',
      direccion: empresa?.direccion ?? '',
      ubigeo: empresa?.ubigeo ?? '',
      distrito: empresa?.distrito ?? '',
      provincia: empresa?.provincia ?? '',
      departamento: empresa?.departamento ?? '',
    },
    sunat: {
      proveedor: proveedorActual().nombre,
      modo: env.sunatModo,
      endpoint: endpointSunatActual(),
      configurado: sunatConfigurado,
      ruc: env.sunatDirectRuc,
      certificadoConfigurado: sunatDirectCertificadoConfigurado,
      credencialesSolConfiguradas: Boolean(env.sunatDirectUsuario && env.sunatDirectPassword),
      timeoutMs: env.sunatDirectTimeoutMs,
    },
    // Guías: solo API REST oficial; la plataforma GRE no tiene ambiente beta.
    gre: {
      modo: env.sunatGreModo,
      configurado: Boolean(env.sunatGreClientId && env.sunatGreClientSecret),
      tokenEndpoint: env.sunatGreTokenEndpoint,
      apiBase: env.sunatGreApiBase,
      timeoutMs: env.sunatGreTimeoutMs,
      intentos: env.sunatGreIntentos,
      intervaloMs: env.sunatGreIntervaloMs,
    },
    // RC/RA usan SOAP del emisor directo; comparten modo con facturas y boletas.
    resumenes: {
      envioReal: resumenesConEnvioReal(),
      modo: resumenesConEnvioReal() ? env.sunatModo : 'local',
    },
    integraciones: {
      reniec: reniecConfigurado,
      almacenamiento: objectStorageConfigurado,
    },
    series: series.map((serie) => ({
      tipo: serie.tipo,
      serie: serie.serie,
      siguiente: serie.siguiente,
    })),
  }
}
