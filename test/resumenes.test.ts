import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  crearBajaSchema,
  crearResumenDiarioSchema,
} from '../src/routes/resumenes.ts'
import { debeConsultarTicket, esFalloTransitorioSunat } from '../src/services/resumenes/envio.ts'
import { numeroResumen } from '../src/services/resumenes/serializar.ts'
import {
  esBajable,
  esResumible,
  SERIE_POR_TIPO,
} from '../src/services/resumenes/validacion.ts'
import {
  consultarEstadoTicket,
  generarXmlResumen,
  idResumen,
  nombreArchivoResumen,
  parseRespuestaGetStatus,
  parseRespuestaSendSummary,
  type ResumenParaEnviar,
} from '../src/services/sunat/sunat-direct/index.ts'

test('el resumen diario solo admite boletas y notas sobre boleta vigentes', () => {
  assert.equal(esResumible('BOLETA', 'EMITIDO'), true)
  assert.equal(esResumible('BOLETA', 'ACEPTADO'), true)
  assert.equal(esResumible('NOTA_CREDITO', 'ACEPTADO', 'B001-00000001'), true)
  assert.equal(esResumible('NOTA_DEBITO', 'EMITIDO', 'B001-00000001'), true)
  assert.equal(esResumible('FACTURA', 'ACEPTADO'), false)
  assert.equal(esResumible('BOLETA', 'ANULADO'), false)
  assert.equal(esResumible('NOTA_CREDITO', 'EMITIDO', 'F001-00000001'), false)
  assert.equal(esBajable('ANULADO'), true)
  assert.equal(esBajable('EMITIDO'), false)
})

test('las series no tributarias siguen el convenio RC/RA', () => {
  assert.equal(SERIE_POR_TIPO.RESUMEN_DIARIO, 'RC001')
  assert.equal(SERIE_POR_TIPO.COMUNICACION_BAJA, 'RA001')
  assert.equal(numeroResumen('RC001', 7), 'RC001-007')
})

test('los formularios validan fecha real y comprobantes sin repetir', () => {
  assert.equal(
    crearResumenDiarioSchema.safeParse({ fecha: '2026-11-24' }).success,
    true,
  )
  assert.equal(
    crearResumenDiarioSchema.safeParse({ fecha: '2026-02-30' }).success,
    false,
  )
  assert.equal(
    crearBajaSchema.safeParse({ fecha: '2026-11-24', comprobanteIds: [] }).success,
    false,
  )
  assert.equal(
    crearBajaSchema.safeParse({
      fecha: '2026-11-24',
      comprobanteIds: ['c-1', 'c-1'],
    }).success,
    false,
  )
})

const resumenBase: ResumenParaEnviar = {
  tipo: 'RESUMEN_DIARIO',
  numero: 3,
  fecha: new Date('2026-11-24T00:00:00.000Z'),
  emisor: { ruc: '20123456789', razonSocial: 'Demo Comercial S.A.C.' },
  observacion: 'Resumen <diario>',
  items: [
    {
      tipoDocumento: 'BOLETA',
      serie: 'B001',
      numero: 11,
      clienteDocumento: '12345678',
      tipoDocumentoCliente: 'DNI',
      documentoAfectado: null,
      fechaEmision: new Date('2026-11-24T00:00:00.000Z'),
      subtotal: 100,
      igv: 18,
      total: 118,
      moneda: 'PEN',
      motivoBaja: null,
    },
  ],
}

test('el XML del resumen usa UBL 2.0 con la extensión peruana y montos en centavos', () => {
  const xml = generarXmlResumen(resumenBase)
  assert.match(xml, /<SummaryDocuments xmlns="urn:sunat:names:specification:ubl:peru:schema:xsd:SummaryDocuments-1"/)
  assert.match(xml, /<cbc:UBLVersionID>2\.0<\/cbc:UBLVersionID>/)
  assert.match(xml, /<cbc:ID>RC-20261124-3<\/cbc:ID>/)
  assert.match(xml, /<cbc:CustomerAssignedAccountID>20123456789<\/cbc:CustomerAssignedAccountID>/)
  assert.match(xml, /<cbc:DocumentTypeCode>03<\/cbc:DocumentTypeCode>/)
  assert.match(xml, /<cbc:ID>B001-11<\/cbc:ID>/)
  assert.match(xml, /<cbc:AdditionalAccountID>1<\/cbc:AdditionalAccountID>/)
  assert.match(xml, /<cbc:ConditionCode>1<\/cbc:ConditionCode>/)
  assert.match(xml, /<sac:TotalAmount currencyID="PEN">118\.00<\/sac:TotalAmount>/)
  assert.match(xml, /<cbc:PaidAmount currencyID="PEN">100\.00<\/cbc:PaidAmount>/)
  assert.match(xml, /<cbc:InstructionID>01<\/cbc:InstructionID>/)
  assert.match(xml, /<cbc:ID>1000<\/cbc:ID>/)
  assert.equal(nombreArchivoResumen(resumenBase, 'zip'), '20123456789-RC-20261124-3.zip')
})

test('la comunicación de baja lleva serie, número y motivo por línea', () => {
  const xml = generarXmlResumen({
    ...resumenBase,
    tipo: 'COMUNICACION_BAJA',
    observacion: 'Anulación <total>',
    items: [{ ...resumenBase.items[0]!, motivoBaja: 'Error en el precio' }],
  })
  assert.match(xml, /<VoidedDocuments xmlns="urn:sunat:names:specification:ubl:peru:schema:xsd:VoidedDocuments-1"/)
  assert.match(xml, /<cbc:ID>RA-20261124-3<\/cbc:ID>/)
  assert.match(xml, /<sac:DocumentSerialID>B001<\/sac:DocumentSerialID>/)
  assert.match(xml, /<sac:DocumentNumberID>11<\/sac:DocumentNumberID>/)
  assert.match(xml, /<sac:VoidReasonDescription>Error en el precio<\/sac:VoidReasonDescription>/)
  assert.equal(nombreArchivoResumen({ ...resumenBase, tipo: 'COMUNICACION_BAJA' }, 'zip'), '20123456789-RA-20261124-3.zip')
})

test('un ticket sin CDR se puede consultar aunque el estado diga RECHAZADO por timeout', () => {
  assert.equal(debeConsultarTicket({ sunatTicket: '1795716012213', archivoCdrKey: null }), true)
  assert.equal(debeConsultarTicket({ sunatTicket: null, archivoCdrKey: null }), false)
  assert.equal(
    debeConsultarTicket({ sunatTicket: '1795716012213', archivoCdrKey: 'cpe/CDR.xml' }),
    false,
  )
})

test('solo los faults Server conservan el ticket; los Client lo invalidan', () => {
  assert.equal(esFalloTransitorioSunat('soap-env:Server.200'), true)
  assert.equal(esFalloTransitorioSunat('soap-env:Client.2220'), false)
  assert.equal(esFalloTransitorioSunat('soap:Server'), true)
})

test('el cbc:ID coincide con el nombre del archivo para RC y RA (regla 2220)', () => {
  for (const tipo of ['RESUMEN_DIARIO', 'COMUNICACION_BAJA'] as const) {
    const resumen = { ...resumenBase, tipo }
    const id = idResumen(resumen)
    const zip = nombreArchivoResumen(resumen, 'zip')
    const idDelArchivo = zip.slice(resumen.emisor.ruc.length + 1, -'.zip'.length)

    assert.equal(idDelArchivo, id)
    assert.match(id, /^(RC|RA)-\d{8}-\d{1,5}$/)
    assert.match(generarXmlResumen(resumen), new RegExp(`<cbc:ID>${id}</cbc:ID>`))
  }
})

test('un fault de SUNAT con prefijo y HTTP 500 se interpreta, no se pierde', async () => {
  const cuerpo = `<?xml version="1.0" encoding="UTF-8"?>
<soap-env:Envelope xmlns:soap-env="http://schemas.xmlsoap.org/soap/envelope/"><soap-env:Body><soap-env:Fault><faultcode>soap-env:Server.200</faultcode><faultstring> - Detalle: Failed to establish a backside connection</faultstring></soap-env:Fault></soap-env:Body></soap-env:Envelope>`
  const clienteFetch = (async () => new Response(cuerpo, { status: 500 })) as typeof fetch

  const respuesta = await consultarEstadoTicket({
    ruc: '20123456789',
    usuario: '20123456789USUARIO',
    password: 'clave',
    ticket: '1795716012213',
    endpoint: 'https://ejemplo.invalid',
    clienteFetch,
  })

  assert.deepEqual(respuesta.falla, {
    codigo: 'soap-env:Server.200',
    mensaje: '- Detalle: Failed to establish a backside connection',
  })
})

test('sendSummary devuelve ticket y getStatus interpreta CDR o "en proceso"', () => {
  const ticket = parseRespuestaSendSummary(
    '<soap:Envelope><soap:Body><sendSummaryResponse><ticket>201100000011227</ticket></sendSummaryResponse></soap:Body></soap:Envelope>',
  )
  assert.deepEqual(ticket, { ticket: '201100000011227', falla: null })

  const proceso = parseRespuestaGetStatus(
    '<getStatusResponse><status><statusCode>98</statusCode><statusMessage>En proceso</statusMessage></status></getStatusResponse>',
  )
  assert.equal(proceso.codigo, '98')
  assert.equal(proceso.cdrBase64, null)

  const listo = parseRespuestaGetStatus(
    '<getStatusResponse><status><statusCode>0</statusCode><content>Y2Ry</content></status></getStatusResponse>',
  )
  assert.equal(listo.codigo, '0')
  assert.equal(listo.cdrBase64, 'Y2Ry')

  const falla = parseRespuestaSendSummary('<soap:Fault><faultcode>Client</faultcode><faultstring>Error SOL</faultstring></soap:Fault>')
  assert.equal(falla.falla?.mensaje, 'Error SOL')
})
