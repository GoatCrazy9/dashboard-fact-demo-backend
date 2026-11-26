import assert from 'node:assert/strict'
import { test } from 'node:test'
import { emitirSchema } from '../src/routes/ventas.ts'

const base = {
  tipo: 'BOLETA' as const,
  cliente: {
    tipoDocumento: 'DNI' as const,
    numeroDocumento: '10203040',
    razonSocial: 'Cliente de prueba',
    email: 'cliente@example.com',
    telefono: '999 888 777',
    ubigeo: '150101',
  },
  fecha: '2026-11-24',
  items: [
    {
      codigo: 'P-1',
      descripcion: 'Mesa de prueba',
      unidad: 'UND',
      precioUnitario: 118,
      igv: 18,
      cantidad: 2,
    },
  ],
}

test('acepta una boleta con datos completos y detalle de venta', () => {
  const resultado = emitirSchema.safeParse({
    ...base,
    detalle: {
      tipoCotizacion: 'VENTA',
      formaPago: 'EFECTIVO',
      moneda: 'PEN',
      tipoCambio: 1,
      fechaEntrega: '2026-11-25',
    },
  })
  assert.equal(resultado.success, true, resultado.success ? '' : JSON.stringify(resultado.error.issues))
})

test('rechaza una factura con DNI', () => {
  const resultado = emitirSchema.safeParse({
    ...base,
    tipo: 'FACTURA',
    cliente: { ...base.cliente, tipoDocumento: 'DNI' },
  })
  assert.equal(resultado.success, false)
  assert.ok(
    resultado.success === false &&
      resultado.error.issues.some((issue) => issue.path.join('.') === 'cliente.tipoDocumento'),
  )
})

test('rechaza correo, teléfono y ubigeo mal formados', () => {
  const resultado = emitirSchema.safeParse({
    ...base,
    cliente: { ...base.cliente, email: 'sin-arroba', telefono: '123', ubigeo: '1501' },
  })
  assert.equal(resultado.success, false)
  assert.ok(
    resultado.success === false &&
      ['cliente.email', 'cliente.telefono', 'cliente.ubigeo'].every((campo) =>
        resultado.error.issues.some((issue) => issue.path.join('.') === campo),
      ),
  )
})

test('rechaza precios con más de dos decimales y cantidades fuera de rango', () => {
  const resultado = emitirSchema.safeParse({
    ...base,
    items: [{ ...base.items[0], precioUnitario: 10.999, cantidad: 0 }],
  })
  assert.equal(resultado.success, false)
  assert.ok(
    resultado.success === false && resultado.error.issues.length >= 2,
  )
})

test('exige fecha de pago en crédito y tipo de cambio en USD', () => {
  const resultado = emitirSchema.safeParse({
    ...base,
    detalle: { formaPago: 'CREDITO', moneda: 'USD' },
  })
  assert.equal(resultado.success, false)
  assert.ok(
    resultado.success === false &&
      ['detalle.fechaPago', 'detalle.tipoCambio'].every((campo) =>
        resultado.error.issues.some((issue) => issue.path.join('.') === campo),
      ),
  )
})
