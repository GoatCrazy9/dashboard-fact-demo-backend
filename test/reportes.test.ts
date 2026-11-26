import assert from 'node:assert/strict'
import { test } from 'node:test'
import JSZip from 'jszip'
import { rangoVentasSchema } from '../src/routes/reportes.ts'
import {
  aHojasExcel,
  calcularReporteVentas,
  type FilaVentas,
} from '../src/services/reportes/ventas.ts'
import { generarXlsx } from '../src/services/reportes/xlsx.ts'

const fila = (datos: Partial<FilaVentas> & Pick<FilaVentas, 'tipo' | 'estado' | 'total'>): FilaVentas => ({
  id: `id-${datos.tipo}-${datos.numero ?? 0}`,
  fecha: new Date('2026-11-10T00:00:00.000Z'),
  serie: datos.tipo.startsWith('NOTA') ? 'NC01' : 'F001',
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

test('el rango exige fechas reales y ordenadas', () => {
  assert.equal(rangoVentasSchema.safeParse({ desde: '2026-02-30', hasta: '2026-03-01' }).success, false)
  assert.equal(rangoVentasSchema.safeParse({ desde: '2026-11-20', hasta: '2026-11-01' }).success, false)
  const valido = rangoVentasSchema.safeParse({ desde: '2026-11-01', hasta: '2026-11-30' })
  assert.equal(valido.success, true)
})

test('el reporte descuenta notas de crédito, suma débito y excluye anulados', () => {
  const reporte = calcularReporteVentas(
    [
      fila({ tipo: 'FACTURA', estado: 'EMITIDO', total: 118, igv: 18 }),
      fila({ tipo: 'BOLETA', estado: 'ACEPTADO', total: 50, serie: 'B001' }),
      fila({ tipo: 'NOTA_CREDITO', estado: 'EMITIDO', total: 30, motivoNota: 'Devolución' }),
      fila({ tipo: 'NOTA_DEBITO', estado: 'EMITIDO', total: 10, serie: 'ND01' }),
      fila({ tipo: 'FACTURA', estado: 'ANULADO', total: 999 }),
      fila({ tipo: 'BOLETA', estado: 'BORRADOR', total: 777 }),
      fila({
        tipo: 'FACTURA',
        estado: 'EMITIDO',
        total: 118,
        moneda: 'USD',
        tipoCambio: 4,
        numero: 2,
        igv: 18,
      }),
    ],
    '2026-11-01',
    '2026-11-30',
  )

  assert.equal(reporte.resumen.comprobantes, 5)
  assert.equal(reporte.resumen.anulados, 1)
  assert.equal(reporte.resumen.facturas, 2)
  assert.equal(reporte.resumen.boletas, 1)
  assert.equal(reporte.resumen.notasCredito, 1)
  assert.equal(reporte.resumen.notasDebito, 1)
  assert.equal(reporte.resumen.igv, 36)
  assert.equal(reporte.resumen.totalPEN, 620)
  assert.equal(reporte.resumen.totalUSD, 118)
  assert.equal(reporte.resumen.ticketPromedio, 124)
  assert.equal(reporte.porDia.length, 1)
  assert.equal(reporte.porDia[0]?.totalPEN, 620)
  assert.equal(reporte.detalle.length, 5)
  assert.equal(reporte.detalle.find((item) => item.tipo === 'NOTA_CREDITO')?.signo, -1)
  assert.equal(reporte.porProducto[0]?.cantidad, 3)
})

test('el Excel generado es un zip con las cinco hojas y celdas tipadas', async () => {
  const reporte = calcularReporteVentas([
    fila({ tipo: 'FACTURA', estado: 'EMITIDO', total: 118, igv: 18 }),
  ])
  const archivo = await generarXlsx(aHojasExcel(reporte))
  const zip = await JSZip.loadAsync(archivo)

  for (const ruta of [
    '[Content_Types].xml',
    '_rels/.rels',
    'xl/workbook.xml',
    'xl/_rels/workbook.xml.rels',
    'xl/styles.xml',
    'xl/worksheets/sheet1.xml',
    'xl/worksheets/sheet5.xml',
  ]) {
    assert.ok(zip.file(ruta), `Falta ${ruta}`)
  }

  const resumen = await zip.file('xl/worksheets/sheet1.xml')!.async('string')
  assert.match(resumen, /Ventas netas \(PEN\)/)
  assert.match(resumen, /<v>118<\/v>/)

  const detalle = await zip.file('xl/worksheets/sheet2.xml')!.async('string')
  assert.match(detalle, /t="inlineStr"/)
  assert.match(detalle, /Cliente Prueba/)
})
