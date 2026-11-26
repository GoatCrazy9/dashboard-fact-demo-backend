import assert from 'node:assert/strict'
import { test } from 'node:test'
import { clavesArchivoCpe } from '../src/services/almacenamiento/cpe.ts'
import type { CpeAEnviar } from '../src/services/sunat/types.ts'

const comprobante: CpeAEnviar = {
  id: 'comprobante-1',
  tipo: 'BOLETA',
  serie: 'B001',
  numero: 11,
  fecha: new Date('2026-11-25T00:00:00.000Z'),
  moneda: 'PEN',
  emisor: {
    ruc: '20000000001',
    razonSocial: 'DEMO COMERCIAL SAC',
    direccion: 'Av. Demostracion 123',
    ubigeo: '150101',
  },
  receptor: {
    tipoDocumento: 'DNI',
    numeroDocumento: '12345678',
    razonSocial: 'Cliente Prueba',
    direccion: null,
  },
  lineas: [],
  subtotal: 100,
  igv: 18,
  total: 118,
  observacion: null,
}

test('las llaves de archivo ordenan por RUC, año y mes', () => {
  const claves = clavesArchivoCpe(comprobante, true)
  assert.equal(claves.xmlKey, 'cpe/20000000001/2026/11/B001-00000011.xml')
  assert.equal(claves.zipKey, 'cpe/20000000001/2026/11/B001-00000011.zip')
  assert.equal(claves.cdrKey, 'cpe/20000000001/2026/11/B001-00000011-cdr.xml')
})

test('sin CDR no se registra llave de CDR', () => {
  assert.equal(clavesArchivoCpe(comprobante, false).cdrKey, null)
})
