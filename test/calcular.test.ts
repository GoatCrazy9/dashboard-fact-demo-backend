import assert from 'node:assert/strict'
import { test } from 'node:test'
import { calcularComprobante } from '../src/services/comprobantes/calcular.ts'

test('un precio con IGV de 118 deja base 100 e IGV 18', () => {
  const totales = calcularComprobante([{ precioUnitario: 118, cantidad: 1, afectoIgv: true }])
  assert.equal(totales.subtotal, 100)
  assert.equal(totales.igv, 18)
  assert.equal(totales.total, 118)
})

test('varias unidades no pierden centavos y base + IGV es el total', () => {
  const totales = calcularComprobante([{ precioUnitario: 100, cantidad: 3, afectoIgv: true }])
  assert.equal(totales.total, 300)
  assert.equal(totales.subtotal + totales.igv, totales.total)
  assert.equal(totales.igv, 45.76)
})

test('una línea exonerada no genera IGV', () => {
  const totales = calcularComprobante([{ precioUnitario: 50, cantidad: 2, afectoIgv: false }])
  assert.equal(totales.subtotal, 100)
  assert.equal(totales.igv, 0)
  assert.equal(totales.total, 100)
})

test('mezcla de gravado y exonerado suma cada régimen', () => {
  const totales = calcularComprobante([
    { precioUnitario: 118, cantidad: 1, afectoIgv: true },
    { precioUnitario: 50, cantidad: 2, afectoIgv: false },
  ])
  assert.equal(totales.subtotal, 200)
  assert.equal(totales.igv, 18)
  assert.equal(totales.total, 218)
})

test('el redondeo por línea converge al total cobrado', () => {
  const totales = calcularComprobante([{ precioUnitario: 33.33, cantidad: 3, afectoIgv: true }])
  assert.equal(totales.total, 99.99)
  assert.equal(totales.subtotal + totales.igv, 99.99)
})

test('respeta la tasa de IGV indicada en cada línea', () => {
  const totales = calcularComprobante([
    { precioUnitario: 118, cantidad: 1, afectoIgv: true, igvPorcentaje: 18 },
    { precioUnitario: 110, cantidad: 1, afectoIgv: true, igvPorcentaje: 10 },
    { precioUnitario: 50, cantidad: 2, afectoIgv: false, igvPorcentaje: 0 },
  ])
  assert.equal(totales.subtotal, 300)
  assert.equal(totales.igv, 28)
  assert.equal(totales.total, 328)
})
