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
    ruc: '10101222221',
    razonSocial: 'MUEBLERIA JOSE',
    direccion: 'Av. Angamos Este 1551',
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
  assert.equal(claves.xmlKey, 'cpe/10101222221/2026/11/B001-00000011.xml')
  assert.equal(claves.zipKey, 'cpe/10101222221/2026/11/B001-00000011.zip')
  assert.equal(claves.cdrKey, 'cpe/10101222221/2026/11/B001-00000011-cdr.xml')
})

test('sin CDR no se registra llave de CDR', () => {
  assert.equal(clavesArchivoCpe(comprobante, false).cdrKey, null)
})
