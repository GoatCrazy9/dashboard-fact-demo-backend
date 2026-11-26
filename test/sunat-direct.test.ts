import assert from 'node:assert/strict'
import { test } from 'node:test'
import JSZip from 'jszip'
import forge from 'node-forge'
import { SignedXml } from 'xml-crypto'
import { calcularComprobante } from '../src/services/comprobantes/calcular.ts'
import type { GuiaAEnviar } from '../src/services/sunat/sunat-direct/guias.ts'
import type { CpeAEnviar } from '../src/services/sunat/types.ts'
import {
  LEYENDA_TRANSFERENCIA_GRATUITA,
  aCentavos,
  calcularTotales,
  cargarCertificado,
  codigoUnidad,
  construirSolicitudGetStatus,
  construirSolicitudSendBill,
  construirSolicitudSendSummary,
  empaquetarXml,
  firmarXmlXades,
  generarXmlCpe,
  generarXmlGuia,
  interpretarCdr,
  nombreArchivoCpe,
  nombreArchivoGuia,
  parseRespuestaSendBill,
  type CertificadoFirma,
} from '../src/services/sunat/sunat-direct/index.ts'

function cpe(overrides: Partial<CpeAEnviar> = {}): CpeAEnviar {
  return {
    id: 'comprobante-1',
    tipo: 'FACTURA',
    serie: 'F001',
    numero: 7,
    fecha: new Date('2026-11-24T00:00:00.000Z'),
    moneda: 'PEN',
    emisor: {
      ruc: '20123456789',
      razonSocial: 'Mueblería José S.A.C.',
      direccion: 'Av. Los Muebles 123, Lima',
      ubigeo: '150101',
    },
    receptor: {
      tipoDocumento: 'RUC',
      numeroDocumento: '20600123456',
      razonSocial: 'Cliente & Asociados S.A.C.',
      direccion: null,
    },
    lineas: [
      {
        descripcion: 'Mesa <roble> "Jardín"',
        cantidad: 1,
        unidad: 'UNIDAD',
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
    ...overrides,
  }
}

test('el XML de factura usa UBL 2.1, catálogos y montos en centavos', () => {
  const xml = generarXmlCpe(cpe())

  assert.match(xml, /<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"/)
  assert.match(xml, /<cbc:UBLVersionID>2\.1<\/cbc:UBLVersionID>/)
  assert.match(xml, /<cbc:CustomizationID>2\.0<\/cbc:CustomizationID>/)
  assert.match(xml, /<cbc:ID>F001-7<\/cbc:ID>/)
  assert.match(xml, /<cbc:IssueDate>2026-11-24<\/cbc:IssueDate>/)
  assert.match(xml, />01<\/cbc:InvoiceTypeCode>/)
  assert.match(xml, /<cbc:DocumentCurrencyCode[^>]*>PEN<\/cbc:DocumentCurrencyCode>/)
  assert.match(xml, /schemeID="6"[^>]*>20123456789<\/cbc:ID>/)
  assert.match(xml, /<cbc:AddressTypeCode>0000<\/cbc:AddressTypeCode>/)
  assert.match(xml, /<cac:PaymentTerms>\s*<cbc:ID>FormaPago<\/cbc:ID>\s*<cbc:PaymentMeansID>Contado<\/cbc:PaymentMeansID>\s*<\/cac:PaymentTerms>/)
  assert.match(xml, /<cbc:InvoicedQuantity unitCode="NIU">1<\/cbc:InvoicedQuantity>/)
  assert.match(xml, /<cbc:PriceTypeCode[^>]*>01<\/cbc:PriceTypeCode>/)
  assert.match(xml, /<cbc:PriceAmount currencyID="PEN">118\.00<\/cbc:PriceAmount>/)
  assert.match(xml, /<cbc:TaxableAmount currencyID="PEN">100\.00<\/cbc:TaxableAmount>/)
  assert.match(xml, /<cbc:TaxAmount currencyID="PEN">18\.00<\/cbc:TaxAmount>/)
  assert.match(xml, /<cbc:PayableAmount currencyID="PEN">118\.00<\/cbc:PayableAmount>/)
  assert.match(xml, /<cbc:Description>Mesa &lt;roble&gt; &quot;Jardín&quot;<\/cbc:Description>/)
  assert.doesNotMatch(xml, /languageLocaleID="1002"/)
})

test('UND se convierte a NIU del catálogo 03', () => {
  assert.equal(codigoUnidad('UND'), 'NIU')
  assert.equal(codigoUnidad('UNID'), 'NIU')
})

test('la boleta usa el código 03 y el tipo de documento del receptor', () => {
  const xml = generarXmlCpe(
    cpe({
      tipo: 'BOLETA',
      serie: 'B001',
      receptor: {
        tipoDocumento: 'DNI',
        numeroDocumento: '12345678',
        razonSocial: 'Juan Pérez',
        direccion: null,
      },
    }),
  )

  assert.match(xml, />03<\/cbc:InvoiceTypeCode>/)
  assert.match(xml, /schemeID="1"[^>]*>12345678<\/cbc:ID>/)
  assert.match(xml, /<cbc:ID>B001-7<\/cbc:ID>/)
})

test('una operación totalmente gratuita lleva la leyenda 1002 y el tributo 9996', () => {
  const gratuita = cpe({
    subtotal: 0,
    igv: 0,
    total: 0,
    lineas: [
      {
        descripcion: 'Muestra gratuita',
        cantidad: 2,
        unidad: 'SERVICIO',
        valorUnitario: 0,
        precioUnitario: 0,
        igv: 0,
        total: 0,
        afectoIgv: true,
        valorReferencial: 50,
      },
    ],
  })
  const xml = generarXmlCpe(gratuita)

  assert.match(xml, /<cbc:Note languageLocaleID="1002">TRANSFERENCIA GRATUITA DE UN BIEN Y\/O SERVICIO PRESTADO GRATUITAMENTE<\/cbc:Note>/)
  assert.match(xml, /<cbc:InvoicedQuantity unitCode="H87">2<\/cbc:InvoicedQuantity>/)
  assert.match(xml, /<cbc:PriceTypeCode[^>]*>02<\/cbc:PriceTypeCode>/)
  assert.match(xml, /<cbc:PriceAmount currencyID="PEN">50\.00<\/cbc:PriceAmount>/)
  assert.match(xml, /<cbc:PriceAmount currencyID="PEN">0\.00<\/cbc:PriceAmount>/)
  assert.match(xml, /<cbc:TaxableAmount currencyID="PEN">100\.00<\/cbc:TaxableAmount>/)
  assert.match(xml, /<cbc:TaxAmount currencyID="PEN">18\.00<\/cbc:TaxAmount>/)
  assert.match(xml, />21<\/cbc:TaxExemptionReasonCode>/)
  assert.match(xml, />Z<\/cbc:ID>/)
  assert.match(xml, />9996<\/cbc:ID>/)
  assert.match(xml, /<cbc:PayableAmount currencyID="PEN">0\.00<\/cbc:PayableAmount>/)
  assert.equal(LEYENDA_TRANSFERENCIA_GRATUITA.length > 0, true)
})

test('los totales se recalculan en centavos sin arrastrar decimales binarios', () => {
  const calculadas = calcularComprobante([{ precioUnitario: 33.33, cantidad: 3, afectoIgv: true }])
  const comprobante = cpe({
    subtotal: calculadas.subtotal,
    igv: calculadas.igv,
    total: calculadas.total,
    lineas: [
      {
        descripcion: 'Silla',
        cantidad: 3,
        unidad: 'NIU',
        valorUnitario: calculadas.lineas[0]!.valorUnitario,
        precioUnitario: 33.33,
        igv: calculadas.lineas[0]!.igv,
        total: calculadas.lineas[0]!.total,
        afectoIgv: true,
      },
    ],
  })
  const totales = calcularTotales(comprobante)

  assert.equal(aCentavos(0.1) + aCentavos(0.2), 30)
  assert.equal(totales.gravadoCentavos, 8474)
  assert.equal(totales.igvCentavos, 1525)
  assert.equal(totales.totalCentavos, 9999)
  assert.equal(totales.lineExtensionCentavos + totales.igvCentavos, totales.totalCentavos)
  assert.equal(totales.todasGratuitas, false)
})

test('el ZIP se llama RUC-Tipo-Serie-Numero y contiene solo el XML', async () => {
  const comprobante = cpe()
  const nombreXml = nombreArchivoCpe(comprobante, 'xml')
  assert.equal(nombreXml, '20123456789-01-F001-7.xml')
  assert.equal(nombreArchivoCpe(comprobante, 'zip'), '20123456789-01-F001-7.zip')

  const zip = await empaquetarXml(nombreXml, generarXmlCpe(comprobante))
  const abierto = await JSZip.loadAsync(zip)
  assert.deepEqual(Object.keys(abierto.files), [nombreXml])
  assert.match(await abierto.file(nombreXml)!.async('string'), /<cbc:ID>F001-7<\/cbc:ID>/)
})

test('la petición sendBill lleva WS-Security y el ZIP en base64', () => {
  const xml = construirSolicitudSendBill({
    ruc: '20123456789',
    usuario: '20123456789USUARIO',
    password: 'clave',
    nombreArchivo: '20123456789-01-F001-7.zip',
    contenidoZip: Buffer.from('x'),
  })

  assert.match(xml, /<wsse:Username>20123456789USUARIO<\/wsse:Username>/)
  assert.match(xml, /#PasswordText">clave<\/wsse:Password>/)
  assert.match(xml, /<fileName>20123456789-01-F001-7\.zip<\/fileName>/)
  assert.match(xml, /<contentFile>eA==<\/contentFile>/)
})

test('sendSummary y getStatus usan la misma seguridad SOAP con ticket', () => {
  const resumen = construirSolicitudSendSummary({
    ruc: '20123456789',
    usuario: '20123456789USUARIO',
    password: 'clave',
    nombreArchivo: '20123456789-RC-20261124-3.zip',
    contenidoZip: Buffer.from('x'),
  })
  const estado = construirSolicitudGetStatus({
    ruc: '20123456789',
    usuario: '20123456789USUARIO',
    password: 'clave',
    ticket: '201100000011227',
  })

  assert.match(resumen, /<ser:sendSummary>/)
  assert.match(resumen, /<fileName>20123456789-RC-20261124-3\.zip<\/fileName>/)
  assert.match(resumen, /#PasswordText">clave<\/wsse:Password>/)
  assert.match(estado, /<ser:getStatus>/)
  assert.match(estado, /<ticket>201100000011227<\/ticket>/)
  assert.match(estado, /<wsse:Username>20123456789USUARIO<\/wsse:Username>/)
})

test('se distinguen los fault SOAP del CDR', () => {
  const falla = parseRespuestaSendBill(
    '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"><soapenv:Body><soapenv:Fault><faultcode>soap:Client</faultcode><faultstring>Invalid username</faultstring></soapenv:Fault></soapenv:Body></soapenv:Envelope>',
  )
  assert.deepEqual(falla.falla, { codigo: 'soap:Client', mensaje: 'Invalid username' })
  assert.equal(falla.cdrBase64, null)

  const respuesta = parseRespuestaSendBill(
    '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><s:sendBillResponse><applicationResponse>UEVE</applicationResponse></s:sendBillResponse></s:Body></s:Envelope>',
  )
  assert.equal(respuesta.cdrBase64, 'UEVE')

  const cdrAceptado = interpretarCdr(
    '<ApplicationResponse><cac:DocumentResponse><cac:Response><cbc:ResponseCode>0</cbc:ResponseCode><cbc:Description>La factura ha sido aceptada</cbc:Description></cac:Response></cac:DocumentResponse></ApplicationResponse>',
  )
  assert.deepEqual(cdrAceptado, {
    estado: 'ACEPTADO',
    codigo: '0',
    mensaje: 'La factura ha sido aceptada',
  })

  const cdrRechazado = interpretarCdr(
    '<ApplicationResponse><cac:Response><cbc:ResponseCode>0100</cbc:ResponseCode><cbc:Description>Error en el RUC</cbc:Description></cac:Response></ApplicationResponse>',
  )
  assert.equal(cdrRechazado.estado, 'RECHAZADO')
})

function certificadoDePrueba(): { certificado: CertificadoFirma; pfx: Buffer } {
  const llaves = forge.pki.rsa.generateKeyPair({ bits: 1024, e: 0x10001 })
  const certificado = forge.pki.createCertificate()
  certificado.publicKey = llaves.publicKey
  certificado.serialNumber = '123456789'
  certificado.validity.notBefore = new Date(Date.now() - 60_000)
  certificado.validity.notAfter = new Date(Date.now() + 86_400_000)
  const atributos = [
    { name: 'commonName', value: 'PRUEBA SUNAT' },
    { name: 'organizationName', value: 'Muebleria Jose' },
    { name: 'countryName', value: 'PE' },
  ]
  certificado.setSubject(atributos)
  certificado.setIssuer(atributos)
  certificado.sign(llaves.privateKey, forge.md.sha256.create())

  const certificadoPem = forge.pki.certificateToPem(certificado)
  const clavePrivadaPem = forge.pki.privateKeyToPem(llaves.privateKey)
  const pfx = Buffer.from(
    forge.asn1.toDer(forge.pkcs12.toPkcs12Asn1(llaves.privateKey, certificado, 'clave')).getBytes(),
    'binary',
  )
  return { certificado: { certificadoPem, clavePrivadaPem }, pfx }
}

test('firma XAdES-BES con PEM y la firma se puede verificar', { timeout: 30_000 }, () => {
  const { certificado, pfx } = certificadoDePrueba()
  const desdePfx = cargarCertificado({ pfxBase64: pfx.toString('base64'), pfxPassword: 'clave' })
  assert.match(desdePfx.certificadoPem, /BEGIN CERTIFICATE/)
  assert.match(desdePfx.clavePrivadaPem, /PRIVATE KEY/)

  const fecha = new Date('2026-11-24T12:00:00.000Z')
  const xmlFirmado = firmarXmlXades(generarXmlCpe(cpe()), certificado, fecha)

  assert.match(xmlFirmado, /^<\?xml version="1\.0" encoding="UTF-8"\?>/)
  assert.match(xmlFirmado, /<ext:ExtensionContent><ds:Signature Id="SignatureSP"/)
  assert.match(xmlFirmado, /<ds:Signature Id="SignatureSP"/)
  assert.match(xmlFirmado, /<xades:SignedProperties Id="SignedProperties">/)
  assert.match(xmlFirmado, /<xades:SigningTime>2026-11-24T12:00:00\.000Z<\/xades:SigningTime>/)
  assert.match(xmlFirmado, /<ds:X509Certificate>/)
  assert.match(xmlFirmado, /Type="http:\/\/uri\.etsi\.org\/01903#SignedProperties"/)
  const firmaExtraida = xmlFirmado.match(/<ds:Signature[\s\S]*?<\/ds:Signature>/)![0]
  const verificador = new SignedXml({ publicCert: certificado.certificadoPem })
  verificador.loadSignature(firmaExtraida)
  assert.equal(verificador.checkSignature(xmlFirmado), true)
})

function guia(overrides: Partial<GuiaAEnviar> = {}): GuiaAEnviar {
  return {
    id: 'guia-1',
    serie: 'T001',
    numero: 3,
    fechaEmision: new Date('2026-11-24T00:00:00.000Z'),
    fechaTraslado: new Date('2026-11-25T00:00:00.000Z'),
    creadoEn: new Date('2026-11-24T17:30:00.000Z'),
    motivo: 'VENTA',
    modalidad: 'PUBLICO',
    pesoKg: 125.5,
    direccionPartida: 'Av. Ejemplo 123, Lima',
    direccionLlegada: 'Calle Mercaderes 456, Arequipa',
    ubigeoPartida: '150101',
    ubigeoLlegada: '040101',
    placa: 'ABC123',
    conductor: 'Juan Carlos Pérez',
    conductorDocumento: '45678912',
    conductorLicencia: 'Q45678912',
    transportistaRuc: null,
    transportistaRazonSocial: null,
    transportistaRegistroMtc: null,
    notas: 'Entregar en almacén',
    comprobante: { tipo: 'FACTURA', serie: 'F001', numero: 9 },
    emisor: {
      ruc: '20123456789',
      razonSocial: 'Mueblería José S.A.C.',
      direccion: 'Av. Los Muebles 123, Lima',
      ubigeo: '150101',
    },
    receptor: {
      tipoDocumento: 'RUC',
      numeroDocumento: '20987654321',
      razonSocial: 'Cliente & Asociados S.A.C.',
      direccion: null,
    },
    items: [{ descripcion: 'Mesa <roble> & silla', cantidad: 2.5, unidad: 'KGM' }],
    ...overrides,
  }
}

test('la guía usa DespatchAdvice 2.1, catálogos SUNAT y HTTP firmable', () => {
  const xml = generarXmlGuia(guia())

  assert.match(xml, /<DespatchAdvice xmlns="urn:oasis:names:specification:ubl:schema:xsd:DespatchAdvice-2"/)
  assert.match(xml, /<cbc:UBLVersionID>2\.1<\/cbc:UBLVersionID>/)
  assert.match(xml, /<cbc:CustomizationID>2\.0<\/cbc:CustomizationID>/)
  assert.match(xml, /<cbc:ID>T001-3<\/cbc:ID>/)
  assert.match(xml, /<cbc:IssueDate>2026-11-24<\/cbc:IssueDate>/)
  assert.match(xml, /<cbc:IssueTime>12:30:00<\/cbc:IssueTime>/)
  assert.match(xml, /<cbc:DespatchAdviceTypeCode[^>]*>09<\/cbc:DespatchAdviceTypeCode>/)
  assert.match(xml, /<cbc:ID>F001-9<\/cbc:ID>/)
  assert.match(xml, /<cbc:HandlingCode>01<\/cbc:HandlingCode>/)
  assert.match(xml, /<cbc:HandlingInstructions>Venta<\/cbc:HandlingInstructions>/)
  assert.match(xml, /<cbc:GrossWeightMeasure unitCode="KGM">125\.500<\/cbc:GrossWeightMeasure>/)
  assert.match(xml, /<cbc:TransportModeCode>01<\/cbc:TransportModeCode>/)
  assert.match(xml, /<cbc:ID schemeID="1">45678912<\/cbc:ID>/)
  assert.match(xml, /<cbc:ID>Q45678912<\/cbc:ID>/)
  assert.match(xml, /<cbc:DeliveredQuantity unitCode="KGM">2\.5<\/cbc:DeliveredQuantity>/)
  assert.match(xml, /<cbc:Description>Mesa &lt;roble&gt; &amp; silla<\/cbc:Description>/)
  assert.equal(nombreArchivoGuia(guia(), 'zip'), '20123456789-09-T001-3.zip')
})

test('una guía privada no inventa datos de transportista', () => {
  const xml = generarXmlGuia(
    guia({
      modalidad: 'PRIVADO',
      placa: '',
      conductor: '',
      conductorDocumento: '',
      conductorLicencia: '',
    }),
  )

  assert.match(xml, /<cbc:TransportModeCode>02<\/cbc:TransportModeCode>/)
  assert.doesNotMatch(xml, /<cac:DriverPerson>/)
  assert.doesNotMatch(xml, /<cac:CarrierParty>/)
})
