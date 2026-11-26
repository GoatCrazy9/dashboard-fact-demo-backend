import assert from 'node:assert/strict'
import { test } from 'node:test'
import { canChangePassword } from '../src/services/usuarios/passwordPolicy.ts'

const maestro = { id: 'usr-maestro', role: 'MAESTRO' }
const admin = { id: 'usr-admin', role: 'ADMIN' }
const vendedor = { id: 'usr-vendedor', role: 'VENDEDOR' }

test('el maestro no puede cambiar su propia contraseña', () => {
  assert.equal(canChangePassword(maestro, maestro), false)
})

test('el maestro no puede cambiar la contraseña de otro maestro', () => {
  assert.equal(canChangePassword(maestro, { id: 'otro-maestro', role: 'MAESTRO' }), false)
})

test('el maestro puede renovar contraseñas de administradores y vendedores', () => {
  assert.equal(canChangePassword(maestro, admin), true)
  assert.equal(canChangePassword(maestro, vendedor), true)
})

test('otros roles no pueden usar el endpoint de contraseñas', () => {
  assert.equal(canChangePassword(admin, maestro), false)
  assert.equal(canChangePassword(vendedor, admin), false)
})
