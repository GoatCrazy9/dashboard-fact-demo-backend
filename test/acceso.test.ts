import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { NextFunction, Request, RequestHandler, Response } from 'express'
import { HttpError } from '../src/lib/http.ts'
import { accesoFacturacion } from '../src/middleware/accesoFacturacion.ts'
import { requerirRol } from '../src/middleware/requerirRol.ts'

function ejecutar(handler: RequestHandler, authUser: unknown) {
  let paso = false
  let error: unknown
  try {
    handler(
      { authUser } as Request,
      {} as Response,
      (() => {
        paso = true
      }) as NextFunction,
    )
  } catch (lanzado) {
    error = lanzado
  }
  return { paso, error }
}

test('el maestro no entra a facturación aunque intente las rutas directamente', () => {
  const { paso, error } = ejecutar(accesoFacturacion, { rol: 'MAESTRO', puedeFacturar: false })
  assert.equal(paso, false)
  assert.equal((error as HttpError).code, 'ACCESO_DENEGADO')
})

test('un vendedor sin permiso no entra; con permiso sí, y el admin siempre', () => {
  assert.equal(ejecutar(accesoFacturacion, { rol: 'VENDEDOR', puedeFacturar: false }).paso, false)
  assert.equal(ejecutar(accesoFacturacion, { rol: 'VENDEDOR', puedeFacturar: true }).paso, true)
  assert.equal(ejecutar(accesoFacturacion, { rol: 'ADMIN', puedeFacturar: false }).paso, true)
})

test('la gestión de usuarios es exclusiva del maestro', () => {
  const soloMaestro = requerirRol('MAESTRO')
  assert.equal(ejecutar(soloMaestro, { rol: 'MAESTRO' }).paso, true)

  for (const rol of ['ADMIN', 'VENDEDOR']) {
    const resultado = ejecutar(soloMaestro, { rol })
    assert.equal(resultado.paso, false)
    assert.equal((resultado.error as HttpError).code, 'ACCESO_DENEGADO')
  }
})

test('la auditoría permite a administradores y maestros', () => {
  const lecturaBitacora = requerirRol('ADMIN', 'MAESTRO')
  assert.equal(ejecutar(lecturaBitacora, { rol: 'ADMIN' }).paso, true)
  assert.equal(ejecutar(lecturaBitacora, { rol: 'MAESTRO' }).paso, true)

  const resultado = ejecutar(lecturaBitacora, { rol: 'VENDEDOR' })
  assert.equal(resultado.paso, false)
  assert.equal((resultado.error as HttpError).code, 'ACCESO_DENEGADO')
})
