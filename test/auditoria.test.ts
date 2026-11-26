import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  construirDetalle,
  describirOperacion,
  fechaValida,
  limitesDia,
} from '../src/services/auditoria.ts'

test('una conversión de documento se registra con módulo, acción e identificador', () => {
  const resultado = describirOperacion(
    'POST',
    '/api/documentos/cmwl123/convertir',
  )
  assert.deepEqual(resultado, {
    modulo: 'Proformas y pedidos',
    entidad: 'Documento',
    accion: 'Convertir',
    entidadId: 'cmwl123',
  })
})

test('una anulación de comprobante se registra como Anular', () => {
  const resultado = describirOperacion('POST', '/api/comprobantes/cmp1/anular?x=1')
  assert.equal(resultado.modulo, 'Comprobantes')
  assert.equal(resultado.accion, 'Anular')
  assert.equal(resultado.entidadId, 'cmp1')
})

test('un alta sin sufijo se registra como Crear y sin identificador', () => {
  const resultado = describirOperacion('POST', '/api/clientes')
  assert.deepEqual(resultado, {
    modulo: 'Clientes',
    entidad: 'Cliente',
    accion: 'Crear',
    entidadId: null,
  })
})

test('las fechas inválidas se rechazan y el rango usa medianoche de Lima', () => {
  assert.equal(fechaValida('2026-11-24'), true)
  assert.equal(fechaValida('2026-02-30'), false)
  assert.equal(fechaValida('24/11/2026'), false)

  const { inicio, fin } = limitesDia('2026-11-24')
  assert.equal(inicio.toISOString(), '2026-11-24T05:00:00.000Z')
  assert.equal(fin.toISOString(), '2026-11-25T04:59:59.999Z')
})

test('el detalle JSON oculta contraseñas y tokens anidados', () => {
  const texto = construirDetalle({
    solicitud: {
      usuario: 'admin',
      password: 'clave-de-prueba',
      sesion: { access_token: 'secreto', refresco: 123 },
    },
  })
  const detalle = JSON.parse(texto as string)
  assert.equal(detalle.solicitud.usuario, 'admin')
  assert.equal(detalle.solicitud.password, '[OCULTO]')
  assert.equal(detalle.solicitud.sesion.access_token, '[OCULTO]')
  assert.equal(detalle.solicitud.sesion.refresco, 123)
  assert.equal(texto?.includes('clave-de-prueba'), false)
  assert.equal(texto?.includes('secreto'), false)
})

test('el detalle JSON tolera ciclos y recorta textos largos', () => {
  const nodo: Record<string, unknown> = { nombre: 'x'.repeat(700) }
  nodo.self = nodo
  const texto = construirDetalle({ solicitud: nodo }) as string
  const detalle = JSON.parse(texto)
  assert.equal(detalle.solicitud.self, '[CIRCULAR]')
  assert.equal(detalle.solicitud.nombre.length, 501)
})

test('sin datos útiles no se guarda detalle', () => {
  assert.equal(construirDetalle({ solicitud: {}, consulta: {} }), null)
})
