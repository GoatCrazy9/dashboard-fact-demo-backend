import type { TipoResumenSunat } from '@prisma/client'
import { aCentavos, formatoDinero } from './dinero.ts'
import { NAMESPACES } from './xml.ts'

const SAC = 'urn:sunat:names:specification:ubl:peru:schema:xsd:SunatAggregateComponents-1'
const ROOT = {
  RESUMEN_DIARIO: 'urn:sunat:names:specification:ubl:peru:schema:xsd:SummaryDocuments-1',
  COMUNICACION_BAJA: 'urn:sunat:names:specification:ubl:peru:schema:xsd:VoidedDocuments-1',
} as const
const PREFIJO = { RESUMEN_DIARIO: 'RC', COMUNICACION_BAJA: 'RA' } as const
const CODIGO_TIPO: Record<string, string> = {
  FACTURA: '01',
  BOLETA: '03',
  NOTA_CREDITO: '07',
  NOTA_DEBITO: '08',
}

const escapar = (valor: string): string =>
  valor
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')

const fecha = (valor: Date): string => valor.toISOString().slice(0, 10)
/** SUNAT exige AAAAMMDD sin guiones en el ID y en el nombre del archivo (regla 2220). */
const fechaId = (valor: Date): string => fecha(valor).replace(/-/g, '')
const dinero = (valor: number, moneda: string): string =>
  `<cbc:PaidAmount currencyID="${moneda}">${formatoDinero(aCentavos(valor))}</cbc:PaidAmount>`

export interface ItemResumenParaEnviar {
  tipoDocumento: string
  serie: string
  numero: number
  clienteDocumento: string
  tipoDocumentoCliente?: string | null
  documentoAfectado?: string | null
  fechaEmision: Date
  subtotal: number
  igv: number
  total: number
  moneda: string
  motivoBaja?: string | null
}

export interface ResumenParaEnviar {
  tipo: TipoResumenSunat
  numero: number
  fecha: Date
  emisor: {
    ruc: string
    razonSocial: string
  }
  observacion?: string | null
  items: ItemResumenParaEnviar[]
}

/** RC-AAAAMMDD-N / RA-AAAAMMDD-N, tal como exige SUNAT en el ID del documento. */
export function idResumen(resumen: ResumenParaEnviar): string {
  return `${PREFIJO[resumen.tipo]}-${fechaId(resumen.fecha)}-${resumen.numero}`
}

/**
 * El ZIP (y el XML dentro) se llama RUC-RC-AAAAMMDD-N.zip (o RUC-RA-...).
 * Se deriva de `idResumen` para que el tag UBL y el nombre del archivo no puedan
 * divergir: SUNAT rechaza con 2220 si el `cbc:ID` no coincide con el archivo.
 */
export function nombreArchivoResumen(
  resumen: ResumenParaEnviar,
  extension: 'xml' | 'zip',
): string {
  return `${resumen.emisor.ruc}-${idResumen(resumen)}.${extension}`
}

function tipoDocumentoCliente(item: ItemResumenParaEnviar): { numero: string; tipo: string } {
  const numero = (item.clienteDocumento || '').trim() || '00000000'
  if (item.tipoDocumentoCliente) {
    return { numero, tipo: item.tipoDocumentoCliente === 'RUC' ? '6' : '1' }
  }
  if (/^\d{11}$/.test(numero)) return { numero, tipo: '6' }
  if (/^\d{8}$/.test(numero)) return { numero, tipo: '1' }
  return { numero, tipo: '1' }
}

function cabecera(resumen: ResumenParaEnviar): string[] {
  const ruc = escapar(resumen.emisor.ruc)
  const razon = escapar(resumen.emisor.razonSocial)
  return [
    '  <ext:UBLExtensions>',
    '    <ext:UBLExtension>',
    '      <ext:ExtensionContent/>',
    '    </ext:UBLExtension>',
    '  </ext:UBLExtensions>',
    '  <cbc:UBLVersionID>2.0</cbc:UBLVersionID>',
    `  <cbc:CustomizationID>${resumen.tipo === 'RESUMEN_DIARIO' ? '1.1' : '1.0'}</cbc:CustomizationID>`,
    `  <cbc:ID>${idResumen(resumen)}</cbc:ID>`,
    `  <cbc:ReferenceDate>${fecha(resumen.fecha)}</cbc:ReferenceDate>`,
    `  <cbc:IssueDate>${fecha(resumen.fecha)}</cbc:IssueDate>`,
    '  <cac:Signature>',
    '    <cbc:ID>SignatureSP</cbc:ID>',
    '    <cac:SignatoryParty>',
    '      <cac:PartyIdentification>',
    `        <cbc:ID>${ruc}</cbc:ID>`,
    '      </cac:PartyIdentification>',
    '      <cac:PartyName>',
    `        <cbc:Name>${razon}</cbc:Name>`,
    '      </cac:PartyName>',
    '    </cac:SignatoryParty>',
    '    <cac:DigitalSignatureAttachment>',
    '      <cac:ExternalReference>',
    '        <cbc:URI>#SignatureSP</cbc:URI>',
    '      </cac:ExternalReference>',
    '    </cac:DigitalSignatureAttachment>',
    '  </cac:Signature>',
    '  <cac:AccountingSupplierParty>',
    `    <cbc:CustomerAssignedAccountID>${ruc}</cbc:CustomerAssignedAccountID>`,
    '    <cbc:AdditionalAccountID>6</cbc:AdditionalAccountID>',
    '    <cac:Party>',
    '      <cac:PartyLegalEntity>',
    `        <cbc:RegistrationName>${razon}</cbc:RegistrationName>`,
    '      </cac:PartyLegalEntity>',
    '    </cac:Party>',
    '  </cac:AccountingSupplierParty>',
  ]
}

function lineaResumen(item: ItemResumenParaEnviar, indice: number): string {
  const moneda = item.moneda || 'PEN'
  const cliente = tipoDocumentoCliente(item)
  const afectado = item.documentoAfectado?.trim()
  const referencia = afectado
    ? [
        '    <cac:BillingReference>',
        '      <cac:InvoiceDocumentReference>',
        `        <cbc:ID>${escapar(afectado)}</cbc:ID>`,
        `        <cbc:DocumentTypeCode>${afectado.startsWith('F') ? '01' : '03'}</cbc:DocumentTypeCode>`,
        '      </cac:InvoiceDocumentReference>',
        '    </cac:BillingReference>',
      ]
    : []
  const monto = (valor: number) => formatoDinero(aCentavos(valor))

  return [
    '  <sac:SummaryDocumentsLine>',
    `    <cbc:LineID>${indice + 1}</cbc:LineID>`,
    `    <cbc:DocumentTypeCode>${CODIGO_TIPO[item.tipoDocumento] ?? '03'}</cbc:DocumentTypeCode>`,
    `    <cbc:ID>${escapar(`${item.serie}-${item.numero}`)}</cbc:ID>`,
    '    <cac:AccountingCustomerParty>',
    `      <cbc:CustomerAssignedAccountID>${escapar(cliente.numero)}</cbc:CustomerAssignedAccountID>`,
    `      <cbc:AdditionalAccountID>${cliente.tipo}</cbc:AdditionalAccountID>`,
    '    </cac:AccountingCustomerParty>',
    ...referencia,
    '    <cac:Status>',
    '      <cbc:ConditionCode>1</cbc:ConditionCode>',
    '    </cac:Status>',
    `    <sac:TotalAmount currencyID="${moneda}">${monto(item.total)}</sac:TotalAmount>`,
    '    <sac:BillingPayment>',
    dinero(item.subtotal, moneda),
    '      <cbc:InstructionID>01</cbc:InstructionID>',
    '    </sac:BillingPayment>',
    '    <cac:TaxTotal>',
    `      <cbc:TaxAmount currencyID="${moneda}">${monto(item.igv)}</cbc:TaxAmount>`,
    '      <cac:TaxSubtotal>',
    `        <cbc:TaxAmount currencyID="${moneda}">${monto(item.igv)}</cbc:TaxAmount>`,
    '        <cac:TaxCategory>',
    '          <cbc:Percent>18.00</cbc:Percent>',
    '          <cac:TaxScheme>',
    '            <cbc:ID>1000</cbc:ID>',
    '            <cbc:Name>IGV</cbc:Name>',
    '            <cbc:TaxTypeCode>VAT</cbc:TaxTypeCode>',
    '          </cac:TaxScheme>',
    '        </cac:TaxCategory>',
    '      </cac:TaxSubtotal>',
    '    </cac:TaxTotal>',
    '  </sac:SummaryDocumentsLine>',
  ].join('\n')
}

function lineaBaja(item: ItemResumenParaEnviar, indice: number, observacion: string): string {
  const motivo = item.motivoBaja?.trim() || observacion || 'Anulación registrada por la empresa.'
  return [
    '  <sac:VoidedDocumentsLine>',
    `    <cbc:LineID>${indice + 1}</cbc:LineID>`,
    `    <cbc:DocumentTypeCode>${CODIGO_TIPO[item.tipoDocumento] ?? '01'}</cbc:DocumentTypeCode>`,
    `    <sac:DocumentSerialID>${escapar(item.serie)}</sac:DocumentSerialID>`,
    `    <sac:DocumentNumberID>${item.numero}</sac:DocumentNumberID>`,
    `    <sac:VoidReasonDescription>${escapar(motivo)}</sac:VoidReasonDescription>`,
    '  </sac:VoidedDocumentsLine>',
  ].join('\n')
}

/**
 * XML UBL 2.0 con la extensión peruana que SUNAT exige para RC y RA.
 * El contenedor UBLExtensions queda vacío; la firma XAdES se inserta ahí.
 */
export function generarXmlResumen(resumen: ResumenParaEnviar): string {
  const raiz = resumen.tipo === 'RESUMEN_DIARIO' ? 'SummaryDocuments' : 'VoidedDocuments'
  const observacion = resumen.observacion?.trim() ?? ''
  const lineas =
    resumen.tipo === 'RESUMEN_DIARIO'
      ? resumen.items.map((item, indice) => lineaResumen(item, indice))
      : resumen.items.map((item, indice) => lineaBaja(item, indice, observacion))

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<${raiz} xmlns="${ROOT[resumen.tipo]}"`,
    `  xmlns:cac="${NAMESPACES.cac}"`,
    `  xmlns:cbc="${NAMESPACES.cbc}"`,
    `  xmlns:ds="${NAMESPACES.ds}"`,
    `  xmlns:ext="${NAMESPACES.ext}"`,
    `  xmlns:sac="${SAC}">`,
    ...cabecera(resumen),
    ...lineas,
    `</${raiz}>`,
    '',
  ].join('\n')
}
