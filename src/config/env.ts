import 'dotenv/config'

const modo = process.env.SUNAT_MODO
const sunatModo = modo === 'produccion' || modo === 'local' ? modo : 'beta'

const proveedor = process.env.SUNAT_PROVEEDOR?.trim().toLowerCase()
const sunatProveedor = proveedor === 'local' || proveedor === 'apisperu' || proveedor === 'direct' ? proveedor : 'auto'

// SUNAT no ofrece beta para guías: su plataforma nueva GRE solo existe en
// producción. Se habilita de forma explícita con SUNAT_GRE_MODO=produccion.
const greModo = process.env.SUNAT_GRE_MODO?.trim().toLowerCase() === 'produccion' ? 'produccion' : 'desactivado'

// Certificado: se admite .pfx (ruta o base64) o PEM (certificado + clave por separado).
const certificadoPfxPath = process.env.SUNAT_CERTIFICATE_PFX_PATH ?? ''
const certificadoPfxBase64 = process.env.SUNAT_CERTIFICATE_PFX_BASE64 ?? ''
const certificadoPemPath = process.env.SUNAT_CERTIFICATE_PEM_PATH ?? ''
const certificadoPem = process.env.SUNAT_CERTIFICATE_PEM ?? ''
const certificadoPemBase64 = process.env.SUNAT_CERTIFICATE_PEM_BASE64 ?? ''
const clavePrivadaPath = process.env.SUNAT_PRIVATE_KEY_PEM_PATH ?? ''
const clavePrivadaPem = process.env.SUNAT_PRIVATE_KEY_PEM ?? ''
const clavePrivadaBase64 = process.env.SUNAT_PRIVATE_KEY_PEM_BASE64 ?? ''

export const apisperuConfigurado = Boolean(
  process.env.APISPERU_CLIENT_ID && process.env.APISPERU_CLIENT_SECRET && process.env.APISPERU_RUC,
)

export const sunatDirectCertificadoConfigurado = Boolean(
  (certificadoPfxPath || certificadoPfxBase64) ||
  ((certificadoPemPath || certificadoPem || certificadoPemBase64) &&
    (clavePrivadaPath || clavePrivadaPem || clavePrivadaBase64)),
)

export const sunatDirectConfigurado = Boolean(
  process.env.SUNAT_SOL_USUARIO && process.env.SUNAT_SOL_PASSWORD && sunatDirectCertificadoConfigurado,
)

export const env = {
  port: Number(process.env.PORT ?? 3001),
  databaseUrl: process.env.DATABASE_URL ?? '',
  sunatModo,
  sunatProveedor,
  apisperuBaseUrl: process.env.APISPERU_BASE_URL ?? 'https://api.apisperu.pro',
  apisperuClientId: process.env.APISPERU_CLIENT_ID ?? '',
  apisperuClientSecret: process.env.APISPERU_CLIENT_SECRET ?? '',
  apisperuRuc: process.env.APISPERU_RUC ?? '',
  sunatDirectRuc: process.env.SUNAT_RUC ?? '',
  sunatDirectUsuario: process.env.SUNAT_SOL_USUARIO ?? '',
  sunatDirectPassword: process.env.SUNAT_SOL_PASSWORD ?? '',
  sunatDirectPfxPath: certificadoPfxPath,
  sunatDirectPfxBase64: certificadoPfxBase64,
  sunatDirectPfxPassword: process.env.SUNAT_CERTIFICATE_PFX_PASSWORD ?? '',
  sunatDirectCertPath: certificadoPemPath,
  sunatDirectCertPem: certificadoPem,
  sunatDirectCertBase64: certificadoPemBase64,
  sunatDirectKeyPath: clavePrivadaPath,
  sunatDirectKeyPem: clavePrivadaPem,
  sunatDirectKeyBase64: clavePrivadaBase64,
  sunatDirectEndpointBeta:
    process.env.SUNAT_ENDPOINT_BETA ?? 'https://e-beta.sunat.gob.pe/ol-ti-itcpfegem-beta/billService',
  sunatGreModo: greModo,
  sunatGreClientId: process.env.SUNAT_GRE_CLIENT_ID ?? '',
  sunatGreClientSecret: process.env.SUNAT_GRE_CLIENT_SECRET ?? '',
  sunatGreTokenEndpoint:
    process.env.SUNAT_GRE_TOKEN_ENDPOINT ?? 'https://api-seguridad.sunat.gob.pe/v1',
  sunatGreApiBase: process.env.SUNAT_GRE_API_BASE ?? 'https://api-cpe.sunat.gob.pe/v1',
  sunatGreTimeoutMs: Number(process.env.SUNAT_GRE_TIMEOUT_MS ?? 30_000),
  sunatGreIntentos: Number(process.env.SUNAT_GRE_INTENTOS ?? 20),
  sunatGreIntervaloMs: Number(process.env.SUNAT_GRE_INTERVALO_MS ?? 3_000),
  sunatDirectEndpointProduccion:
    process.env.SUNAT_ENDPOINT_PRODUCCION ?? 'https://e-factura.sunat.gob.pe/ol-ti-itcpfegem/billService',
  sunatDirectTimeoutMs: Number(process.env.SUNAT_TIMEOUT_MS ?? 30_000),
  reniecUrl: process.env.URL_RENIEC ?? '',
  reniecToken: process.env.TOKEN_CONSULTA_RENIEC ?? '',
  reniecTimeoutMs: Number(process.env.TIMEOUT_RENIEC_MS ?? 30_000),
  authJwtSecret: process.env.AUTH_JWT_SECRET ?? '',
  authPasswordPepper: process.env.AUTH_PASSWORD_PEPPER ?? '',
  authTtlSegundos: Number(process.env.AUTH_TTL_SECONDS ?? 28_800),
  authMaxIntentos: Number(process.env.AUTH_MAX_INTENTOS ?? 5),
  authBloqueoMinutos: Number(process.env.AUTH_BLOQUEO_MINUTOS ?? 5),
  authVentanaMinutos: Number(process.env.AUTH_VENTANA_MINUTOS ?? 15),
  objectBucket: process.env.NEON_OBJECT_BUCKET ?? '',
  objectEndpoint: process.env.AWS_ENDPOINT_URL_S3 ?? '',
  objectRegion: process.env.AWS_REGION ?? 'us-east-1',
  objectAccessKeyId: process.env.AWS_ACCESS_KEY_ID ?? '',
  objectSecretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? '',
} as const

if (!env.authJwtSecret || env.authJwtSecret.length < 32) {
  throw new Error('AUTH_JWT_SECRET es requerido y debe tener al menos 32 caracteres.')
}
if (!env.authPasswordPepper) {
  throw new Error('AUTH_PASSWORD_PEPPER es requerido para derivar las contraseñas.')
}

/** Indica si el proveedor seleccionado tiene credenciales suficientes para emitir. */
export const sunatConfigurado =
  sunatProveedor === 'local'
    ? false
    : sunatProveedor === 'apisperu'
      ? apisperuConfigurado
      : sunatProveedor === 'direct'
        ? sunatDirectConfigurado
        : apisperuConfigurado || sunatDirectConfigurado

export const reniecConfigurado = Boolean(env.reniecUrl && env.reniecToken)

/** Object Storage de Neon (S3): credenciales solo en el backend. */
export const objectStorageConfigurado = Boolean(
  env.objectBucket &&
    env.objectEndpoint &&
    env.objectAccessKeyId &&
    env.objectSecretAccessKey,
)

export interface DemoCredential {
  username: string
  password: string
  role: 'ADMIN' | 'MAESTRO'
  label: string
}

/**
 * Credenciales públicas del demo local. Se leen del entorno en cada petición para
 * que las contraseñas nunca queden escritas en el repositorio ni en el bundle.
 */
export function getDemoCredentials(): DemoCredential[] {
  return [
    {
      username: (process.env.ADMIN_USUARIO ?? 'admin').trim().toLowerCase(),
      password: process.env.ADMIN_CONTRASENA ?? '',
      role: 'ADMIN' as const,
      label: 'Administrador',
    },
    {
      username: (process.env.MAESTRO_USUARIO ?? 'maestro').trim().toLowerCase(),
      password: process.env.MAESTRO_CONTRASENA ?? '',
      role: 'MAESTRO' as const,
      label: 'Maestro',
    },
  ].filter((credential) => credential.username.length > 0 && credential.password.length > 0)
}
