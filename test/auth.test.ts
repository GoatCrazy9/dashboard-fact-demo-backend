import assert from 'node:assert/strict'
import { test } from 'node:test'
import { randomBytes } from 'node:crypto'
import {
  emitirToken,
  hashContrasena,
  verificarContrasena,
  verificarToken,
} from '../src/lib/auth.ts'

const LLAVE = 'clave-de-prueba-con-al-menos-32-caracteres'
const PEPPER = 'pepper-de-prueba'
const CLAVE = randomBytes(16).toString('hex')

test('el hash scrypt acepta la contraseña correcta y rechaza otra', async () => {
  const hash = await hashContrasena(CLAVE, PEPPER)
  assert.match(hash, /^scrypt\$/)
  assert.equal(await verificarContrasena(CLAVE, hash, PEPPER), true)
  assert.equal(await verificarContrasena('clave-incorrecta', hash, PEPPER), false)
  assert.equal(await verificarContrasena(CLAVE, hash, 'otro-pepper'), false)
})

test('el token HS256 conserva el usuario y rechaza modificaciones', () => {
  const usuario = { id: 'usr-1', nombre: 'Administrador', usuario: 'admin', rol: 'ADMIN' }
  const { token, expiresAt, expiresEn } = emitirToken(usuario, LLAVE, 3600)
  const payload = verificarToken(token, LLAVE)

  assert.equal(payload.sub, usuario.id)
  assert.deepEqual(payload.user, usuario)
  assert.equal(expiresEn, 3600)
  assert.ok(expiresAt > Date.now())
  assert.throws(() => verificarToken(`${token}x`, LLAVE), /TOKEN_INVALIDO/)
  assert.throws(() => verificarToken(token, 'otra-clave-de-prueba-con-32-caracteres'), /TOKEN_INVALIDO/)
})

test('un token vencido se rechaza', () => {
  const { token } = emitirToken(
    { id: 'usr-1', nombre: 'Administrador', usuario: 'admin', rol: 'ADMIN' },
    LLAVE,
    -10,
  )
  assert.throws(() => verificarToken(token, LLAVE), /TOKEN_INVALIDO/)
})
