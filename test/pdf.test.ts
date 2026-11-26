import assert from 'node:assert/strict'
import zlib from 'node:zlib'
import { test } from 'node:test'
import { pdfComprobante, totalEnLetras } from '../src/services/comprobantes/pdf.ts'
import { textoQrComprobante } from '../src/services/comprobantes/qr.ts'
import { pdfReporteVentas } from '../src/services/reportes/pdf.ts'
import { calcularReporteVentas, type FilaVentas } from '../src/services/reportes/ventas.ts'
import { matrizQr } from '../src/services/pdf/qr.ts'

/** Extrae el texto de los flujos Flate para comprobar el contenido sin parser de PDF. */
function textoFlujos(pdf: Buffer): string {
  const salidas: string[] = []
  const patron = /stream\r?\n([\s\S]*?)\r?\nendstream/g
  for (const coincidencia of pdf.toString('latin1').matchAll(patron)) {
    const bytes = Buffer.from(coincidencia[1], 'latin1')
    try {
      salidas.push(zlib.inflateSync(bytes).toString('latin1'))
    } catch {
      salidas.push(bytes.toString('latin1'))
    }
  }
  // El generador escapa paréntesis y barras dentro de los literal strings del PDF.
  return salidas.join('\n').replace(/\\([()\\])/g, '$1')
}

const empresa = {
  razonSocial: 'MUEBLERIA JOSE',
  direccion:
    'Av. Angamos Este Nro. 1551 Block 2, 1 Piso Tda 79 C.C. Plaza Hogar - Lima - Lima - Surquillo',
  ruc: '10101222221',
  telefono: '955779178',
}

test('el QR reproduce el texto decodificado de los PDF reales de SICAP', () => {
  const texto = textoQrComprobante({ ...empresa, numero: 431 })
  assert.equal(
    texto,
    'MUEBLERIA JOSE\r' +
      'Av. Angamos Este Nro. 1551 Block 2, 1 Piso Tda 79 C.C. Plaza Hogar - Lima - Lima - Surquillo\r' +
      '  \r' +
      'RUC: 10101222221\r' +
      'LIMA\r' +
      '  \r' +
      'Factura No. 00000431',
  )

  const qr = matrizQr(texto)
  assert.ok(qr.size >= 21)
  assert.equal(qr.datos.length, qr.size * qr.size)
  assert.ok(qr.datos.includes(0) && qr.datos.includes(1))
})

test('el ticket PDF trae el QR, el total en letras y la detracción', () => {
  const pdf = pdfComprobante(
    {
      tipo: 'FACTURA',
      serie: 'F001',
      numero: 84,
      fecha: '2026-11-10T00:00:00.000Z',
      cliente: 'Cliente Prueba',
      clienteDocumento: '20101222221',
      clienteDireccion: 'Lima',
      subtotal: 1776,
      igv: 74,
      total: 1850,
      moneda: 'PEN',
      detraccionCodigo: '008',
      detraccionTasa: 4,
      detraccionMonto: 74,
      items: [{ descripcion: 'Mesa', cantidad: 1, precioUnitario: 1850, total: 1850 }],
    },
    empresa,
  )
  const contenido = textoFlujos(pdf)

  assert.equal(pdf.subarray(0, 8).toString('latin1'), '%PDF-1.4')
  assert.match(pdf.toString('latin1'), /\/Subtype \/Image/)
  assert.match(pdf.toString('latin1'), /%%EOF\s*$/)
  assert.match(contenido, /FACTURA ELECTRÓNICA/)
  assert.match(contenido, /DETRACCIÓN 008 \(4%\)/)
  assert.match(contenido, /SON: MIL OCHOCIENTOS CINCUENTA CON 00\/100 SOLES/)
  assert.equal(totalEnLetras(1850, 'PEN'), 'SON: MIL OCHOCIENTOS CINCUENTA CON 00/100 SOLES')
})

const fila = (datos: Partial<FilaVentas> & Pick<FilaVentas, 'tipo' | 'estado' | 'total'>): FilaVentas => ({
  id: `id-${datos.numero ?? 0}`,
  fecha: new Date('2026-11-10T00:00:00.000Z'),
  serie: 'F001',
  numero: 1,
  subtotal: datos.total,
  igv: 0,
  moneda: 'PEN',
  tipoCambio: 1,
  cliente: { razonSocial: 'Cliente Prueba', numeroDocumento: '20101222221' },
  documentoAfectado: null,
  motivoNota: null,
  items: [{ descripcion: 'Mesa', cantidad: 1, total: datos.total }],
  ...datos,
})

test('el PDF del reporte incluye las cinco secciones y el pie', () => {
  const reporte = calcularReporteVentas(
    [fila({ tipo: 'FACTURA', estado: 'EMITIDO', total: 118 })],
    '2026-11-01',
    '2026-11-30',
  )
  const pdf = pdfReporteVentas(reporte, empresa)
  const contenido = textoFlujos(pdf)

  assert.equal(pdf.subarray(0, 8).toString('latin1'), '%PDF-1.4')
  for (const texto of [
    'REPORTE DE VENTAS',
    'Resumen',
    'Ventas por día',
    'Ventas por tipo de comprobante',
    'Ventas por producto',
    'Detalle de comprobantes',
    'Ventas netas (PEN)',
    'Total general (PEN)',
    'Página 1 de',
  ]) {
    assert.ok(contenido.includes(texto), `Falta «${texto}» en el PDF`)
  }
  assert.match(pdf.toString('latin1'), /\/MediaBox \[0 0 842\.00 595\.00\]/)
})

test('el PDF del reporte pagina el detalle largo', () => {
  const filas = Array.from({ length: 60 }, (_, indice) =>
    fila({ tipo: 'BOLETA', estado: 'EMITIDO', total: 50, serie: 'B001', numero: indice + 1 }),
  )
  const pdf = pdfReporteVentas(
    calcularReporteVentas(filas, '2026-11-01', '2026-11-30'),
  )
  const contenido = textoFlujos(pdf)

  assert.match(contenido, /REPORTE DE VENTAS \(continuación\)/)
  assert.match(contenido, /Página 2 de \d+/)
})
