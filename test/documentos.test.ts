import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fechaValida } from '../src/lib/fechas.ts'
import {
  crearDocumentoSchema,
  convertirDocumentoSchema,
} from '../src/routes/documentos.ts'
import { crearGuiaSchema } from '../src/routes/guias.ts'
import { transicionValida } from '../src/services/documentos/estados.ts'
import { prepararItems } from '../src/services/lineas.ts'
import {
  transportistaValido,
  ubigeoValido,
} from '../src/services/guias/validacion.ts'

const documento = {
  tipo: 'COTIZACION',
  clienteId: 'cliente-1',
  fecha: '2026-11-24',
  items: [{ productoId: 'producto-1', cantidad: 2 }],
}

test('las fechas del formulario son reales y no se invierten', () => {
  assert.equal(fechaValida('2026-02-30'), false)
  assert.equal(fechaValida('2026-11-24'), true)
  assert.equal(
    crearDocumentoSchema.safeParse({ ...documento, fechaEntrega: '2026-11-20' }).success,
    false,
  )
  assert.equal(
    crearDocumentoSchema.safeParse({ ...documento, fechaEntrega: '2026-11-25' }).success,
    true,
  )
})

test('una línea escrita a mano no necesita producto y calcula el IGV con su precio', () => {
  const items = [{ descripcion: 'Mesa de prueba', cantidad: 1, precioUnitario: 118 }]
  assert.equal(crearDocumentoSchema.safeParse({ ...documento, items }).success, true)
  assert.equal(
    crearDocumentoSchema.safeParse({ ...documento, items: [{ cantidad: 1 }] }).success,
    false,
  )

  const preparado = prepararItems([], items)
  assert.equal(preparado.items[0]!.producto, null)
  assert.equal(preparado.items[0]!.descripcion, 'Mesa de prueba')
  assert.equal(preparado.totales.subtotal, 100)
  assert.equal(preparado.totales.igv, 18)
  assert.equal(preparado.totales.total, 118)
})

test('las transiciones de documentos no permiten saltar ni salir de CONVERTIDO', () => {
  assert.equal(transicionValida('PENDIENTE', 'APROBADO'), true)
  assert.equal(transicionValida('APROBADO', 'RECHAZADO'), true)
  assert.equal(transicionValida('RECHAZADO', 'PENDIENTE'), true)
  assert.equal(transicionValida('PENDIENTE', 'CONVERTIDO'), false)
  assert.equal(transicionValida('CONVERTIDO', 'PENDIENTE'), false)
  assert.equal(convertirDocumentoSchema.safeParse({ tipo: 'NOTA_CREDITO' }).success, false)
})

const guia = {
  fechaEmision: '2026-11-24',
  fechaTraslado: '2026-11-25',
  clienteId: 'cliente-1',
  motivo: 'VENTA',
  modalidad: 'PRIVADO',
  pesoKg: 12.5,
  direccionPartida: 'Av. Principal 123',
  direccionLlegada: 'Jr. Secundario 456',
  items: [{ productoId: 'producto-1', cantidad: 1 }],
}

test('la guía exige transportista en traslado público y ubigeo de 6 dígitos', () => {
  assert.equal(ubigeoValido('150101'), true)
  assert.equal(ubigeoValido('1501'), false)
  assert.equal(transportistaValido('PRIVADO', null, null), true)
  assert.equal(transportistaValido('PUBLICO', 'ABC123', 'Juan Pérez'), true)
  assert.equal(transportistaValido('PUBLICO', '', 'Juan Pérez'), false)

  assert.equal(
    crearGuiaSchema.safeParse({ ...guia, modalidad: 'PUBLICO' }).success,
    false,
  )
  assert.equal(
    crearGuiaSchema.safeParse({
      ...guia,
      modalidad: 'PUBLICO',
      placa: 'ABC123',
      conductor: 'Juan Pérez',
      conductorDocumento: '12345678',
      conductorLicencia: 'Q12345678',
      ubigeoLlegada: '150101',
    }).success,
    true,
  )
})
