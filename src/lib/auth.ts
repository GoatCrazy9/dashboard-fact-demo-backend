import {
  createHmac,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from 'node:crypto'

export interface UsuarioToken {
  id: string
  nombre: string
  usuario: string
  rol: string
}

export interface PayloadToken {
  sub: string
  iss: string
  aud: string
  iat: number
  exp: number
  user: UsuarioToken
}

const EMISOR = 'muebleria-jose-api'
const AUDIENCIA = 'muebleria-jose-client'
const LONGITUD_CLAVE = 64

function derivar(password: string, salt: Buffer, pepper: string): Promise<Buffer> {
  const preparada = createHmac('sha256', pepper).update(password).digest('base64')
  return new Promise((resolve, reject) => {
    scryptCallback(preparada, salt, LONGITUD_CLAVE, (error, clave) => {
      if (error || !clave) {
        reject(error ?? new Error('No se pudo derivar la contraseña.'))
        return
      }
      resolve(clave as Buffer)
    })
  })
}

/** Hash scrypt con salt aleatorio y pepper de entorno: `scrypt$salt$hash`. */
export async function hashContrasena(password: string, pepper: string): Promise<string> {
  const salt = randomBytes(16)
  const hash = await derivar(password, salt, pepper)
  return `scrypt$${salt.toString('base64url')}$${hash.toString('base64url')}`
}

export async function verificarContrasena(
  password: string,
  guardado: string,
  pepper: string,
): Promise<boolean> {
  const partes = guardado.split('$')
  if (partes.length !== 3 || partes[0] !== 'scrypt') return false

  const salt = Buffer.from(partes[1], 'base64url')
  const esperada = Buffer.from(partes[2], 'base64url')
  if (!salt.length || !esperada.length) return false

  const actual = await derivar(password, salt, pepper)
  return esperada.length === actual.length && timingSafeEqual(esperada, actual)
}

function aBase64Url(valor: string | object): string {
  const texto = typeof valor === 'string' ? valor : JSON.stringify(valor)
  return Buffer.from(texto, 'utf8').toString('base64url')
}

function firmar(cabecera: string, cuerpo: string, secreto: string): string {
  return createHmac('sha256', secreto).update(`${cabecera}.${cuerpo}`).digest('base64url')
}

/** JWT HS256 de 8 h por defecto, con issuer/audience propios de SICAP. */
export function emitirToken(
  usuario: UsuarioToken,
  secreto: string,
  ttlSegundos = 28_800,
): { token: string; expiresAt: number; expiresEn: number } {
  const emitidoEn = Math.floor(Date.now() / 1000)
  const payload: PayloadToken = {
    sub: usuario.id,
    iss: EMISOR,
    aud: AUDIENCIA,
    iat: emitidoEn,
    exp: emitidoEn + ttlSegundos,
    user: usuario,
  }
  const cabecera = aBase64Url({ alg: 'HS256', typ: 'JWT' })
  const cuerpo = aBase64Url(payload)
  const token = `${cabecera}.${cuerpo}.${firmar(cabecera, cuerpo, secreto)}`
  return { token, expiresAt: payload.exp * 1000, expiresEn: ttlSegundos }
}

export function verificarToken(token: string, secreto: string): PayloadToken {
  const partes = token.split('.')
  if (partes.length !== 3) throw new Error('TOKEN_INVALIDO')
  const [cabecera, cuerpo, firma] = partes

  const esperada = Buffer.from(firmar(cabecera, cuerpo, secreto), 'utf8')
  const recibida = Buffer.from(firma, 'utf8')
  if (esperada.length !== recibida.length || !timingSafeEqual(esperada, recibida)) {
    throw new Error('TOKEN_INVALIDO')
  }

  let header: { alg?: string; typ?: string }
  let payload: PayloadToken
  try {
    header = JSON.parse(Buffer.from(cabecera, 'base64url').toString('utf8')) as typeof header
    payload = JSON.parse(Buffer.from(cuerpo, 'base64url').toString('utf8')) as PayloadToken
  } catch {
    throw new Error('TOKEN_INVALIDO')
  }

  const ahora = Math.floor(Date.now() / 1000)
  if (
    header.alg !== 'HS256' ||
    payload.iss !== EMISOR ||
    payload.aud !== AUDIENCIA ||
    typeof payload.sub !== 'string' ||
    typeof payload.exp !== 'number' ||
    payload.exp <= ahora ||
    !payload.user ||
    typeof payload.user.id !== 'string' ||
    typeof payload.user.nombre !== 'string' ||
    typeof payload.user.usuario !== 'string' ||
    typeof payload.user.rol !== 'string'
  ) {
    throw new Error('TOKEN_INVALIDO')
  }

  return payload
}
