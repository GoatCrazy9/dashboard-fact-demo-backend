import assert from 'node:assert/strict'
import { test } from 'node:test'
import { anularComprobanteSchema, crearComprobanteSchema } from '../src/routes/comprobantes.ts'
import { esEstadoAnulable } from '../src/services/comprobantes/acciones.ts'

const base = {
  clienteId: 'cliente-1',
  fecha: '2026-11-24',
  items: [{ productoId: 'producto-1', cantidad: 1 }],
}

test('acepta facturas y boletas sin campos de nota', () => {
  for (const tipo of ['FACTURA', 'BOLETA'] as const) {
    const resultado = crearComprobanteSchema.safeParse({ ...base, tipo })
    assert.equal(resultado.success, true, resultado.success ? '' : JSON.stringify(resultado.error.issues))
  }
})

test('una nota exige comprobante afectado y motivo', () => {
  for (const tipo of ['NOTA_CREDITO', 'NOTA_DEBITO'] as const) {
    const incompleta = crearComprobanteSchema.safeParse({ ...base, tipo })
    assert.equal(incompleta.success, false)
    if (!incompleta.success) {
      const caminos = incompleta.error.issues.map((issue) => issue.path.join('.'))
      assert.ok(caminos.includes('comprobanteAfectadoId'))
      assert.ok(caminos.includes('motivoNota'))
    }

    const completa = crearComprobanteSchema.safeParse({
      ...base,
      tipo,
      comprobanteAfectadoId: 'comprobante-1',
      motivoNota: 'Producto devuelto por el cliente',
    })
    assert.equal(completa.success, true, completa.success ? '' : JSON.stringify(completa.error.issues))
  }
})

test('la anulación exige un motivo con al menos 5 caracteres', () => {
  assert.equal(anularComprobanteSchema.safeParse({ motivo: 'abc' }).success, false)
  const valida = anularComprobanteSchema.safeParse({ motivo: '  Cliente se arrepintió  ' })
  assert.equal(valida.success, true)
  if (valida.success) assert.equal(valida.data.motivo, 'Cliente se arrepintió')
})

test('solo se anulan comprobantes emitidos o aceptados', () => {
  assert.equal(esEstadoAnulable('EMITIDO'), true)
  assert.equal(esEstadoAnulable('ACEPTADO'), true)
  assert.equal(esEstadoAnulable('BORRADOR'), false)
  assert.equal(esEstadoAnulable('RECHAZADO'), false)
  assert.equal(esEstadoAnulable('ANULADO'), false)
})
