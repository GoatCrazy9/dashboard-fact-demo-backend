import assert from 'node:assert/strict'
import { test } from 'node:test'
import { calcularDetraccion } from '../src/services/detracciones/calcular.ts'
import { DETRACCIONES, buscarDetraccion } from '../src/services/detracciones/catalogo.ts'
import { generarXmlCpe } from '../src/services/sunat/sunat-direct/xml.ts'
import type { CpeAEnviar } from '../src/services/sunat/types.ts'

test('el catálogo de detracciones conserva los 35 códigos de SICAP', () => {
  assert.equal(DETRACCIONES.length, 35)
  assert.deepEqual(buscarDetraccion('008'), { codigo: '008', nombre: 'MADERA', tasa: 4 })
  assert.equal(buscarDetraccion('999'), null)
  assert.equal(buscarDetraccion(' 000 ' )?.tasa, 0)
})

test('la detracción se calcula en centavos y respeta tasas decimales', () => {
  assert.equal(calcularDetraccion(185_000, 4), 7_400)
  assert.equal(calcularDetraccion(152_000, 1.5), 2_280)
  assert.equal(calcularDetraccion(185_000, 0), 0)
})

test('el XML local anota la detracción aplicada sin contactar a SUNAT', () => {
  const cpe: CpeAEnviar = {
    id: 'c-1',
    tipo: 'FACTURA',
    serie: 'F001',
    numero: 1,
    fecha: new Date('2026-11-24T00:00:00.000Z'),
    moneda: 'PEN',
    emisor: { ruc: '10101222221', razonSocial: 'MJ', direccion: 'Av. Uno', ubigeo: '150101' },
    receptor: {
      tipoDocumento: 'RUC',
      numeroDocumento: '20100047218',
      razonSocial: 'Cliente',
      direccion: null,
    },
    lineas: [
      {
        descripcion: 'Mueble',
        cantidad: 1,
        unidad: 'NIU',
        valorUnitario: 100,
        precioUnitario: 118,
        igv: 18,
        total: 118,
        afectoIgv: true,
      },
    ],
    subtotal: 100,
    igv: 18,
    total: 118,
    observacion: null,
    detalleDetraccion: { codigo: '008', tasa: 4, monto: 4.72 },
  }

  const xml = generarXmlCpe(cpe)
  assert.match(xml, /DETRACCIÓN 008 \(4%\): 4\.72/)
})
