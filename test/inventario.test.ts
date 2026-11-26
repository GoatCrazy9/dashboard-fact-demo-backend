import assert from 'node:assert/strict'
import { test } from 'node:test'
import { unidadesDescontables, unidadesPorProducto } from '../src/services/productos/inventario.ts'

test('una línea fraccionaria descuenta al menos una unidad entera', () => {
  assert.equal(unidadesDescontables(2), 2)
  assert.equal(unidadesDescontables(1.6), 2)
  assert.equal(unidadesDescontables(1.2), 1)
  assert.equal(unidadesDescontables(0.4), 1)
})

test('las líneas se agrupan por producto y se ignora texto libre', () => {
  const agrupado = unidadesPorProducto([
    { productoId: 'p1', cantidad: 1.6 },
    { productoId: 'p1', cantidad: 1 },
    { productoId: 'p2', cantidad: 3 },
    { productoId: null, cantidad: 5 },
  ])

  assert.equal(agrupado.get('p1'), 3)
  assert.equal(agrupado.get('p2'), 3)
  assert.equal(agrupado.size, 2)
})
