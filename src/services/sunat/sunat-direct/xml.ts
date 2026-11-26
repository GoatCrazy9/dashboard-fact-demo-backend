import type { CpeAEnviar } from '../types.ts'
import {
  LEYENDA_TRANSFERENCIA_GRATUITA,
  REGIMEN_IGV,
  codigoTipoComprobante,
  codigoTipoDocumento,
  codigoUnidad,
  type RegimenIgv,
} from './catalogos.ts'
import {
  calcularTotales,
  formatoCantidad,
  formatoDinero,
  formatoUnitario,
  type LineaCalculadaDirecta,
} from './dinero.ts'

export const NAMESPACES = {
  ext: 'urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2',
  cac: 'urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2',
  cbc: 'urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2',
  ds: 'http://www.w3.org/2000/09/xmldsig#',
  xades: 'http://uri.etsi.org/01903/v1.3.2#',
} as const

const escapar = (valor: string): string =>
  valor
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')

const fechaEmision = (fecha: Date): string => fecha.toISOString().slice(0, 10)

function categoriaTributo(regimen: RegimenIgv, sangria: string): string {
  const datos = REGIMEN_IGV[regimen]
  return [
    `${sangria}<cac:TaxCategory>`,
    `${sangria}  <cbc:ID schemeID="UN/ECE 5305" schemeName="Tax Category Identifier" schemeAgencyName="United Nations Economic Commission for Europe">${datos.categoria}</cbc:ID>`,
    `${sangria}  <cbc:Percent>${datos.porcentaje}</cbc:Percent>`,
    `${sangria}  <cbc:TaxExemptionReasonCode listAgencyName="PE:SUNAT" listName="SUNAT:Identificador de Tipo de Afectación del IGV" listURI="urn:pe:gob:sunat:cpe:see:gem:catalogos:catalogo07">${datos.afectacion}</cbc:TaxExemptionReasonCode>`,
    `${sangria}  <cac:TaxScheme>`,
    `${sangria}    <cbc:ID schemeID="UN/ECE 5153" schemeAgencyName="PE:SUNAT">${datos.tributo}</cbc:ID>`,
    `${sangria}    <cbc:Name>${datos.nombre}</cbc:Name>`,
    `${sangria}    <cbc:TaxTypeCode>${datos.tipoTributo}</cbc:TaxTypeCode>`,
    `${sangria}  </cac:TaxScheme>`,
    `${sangria}</cac:TaxCategory>`,
  ].join('\n')
}

function subtotalTributo(regimen: RegimenIgv, baseCentavos: number, igvCentavos: number, moneda: string): string {
  return [
    '      <cac:TaxSubtotal>',
    `        <cbc:TaxableAmount currencyID="${moneda}">${formatoDinero(baseCentavos)}</cbc:TaxableAmount>`,
    `        <cbc:TaxAmount currencyID="${moneda}">${formatoDinero(igvCentavos)}</cbc:TaxAmount>`,
    categoriaTributo(regimen, '        '),
    '      </cac:TaxSubtotal>',
  ].join('\n')
}

function direccionPostal(direccionCpe: string, ubigeo?: string): string {
  const lineas = ['      <cac:PostalAddress>']
  if (ubigeo) {
    lineas.push(
      `        <cbc:ID schemeID="UN/ECE 3199" schemeAgencyName="PE:SUNAT">${escapar(ubigeo)}</cbc:ID>`,
    )
  }
  lineas.push(`        <cbc:StreetName>${escapar(direccionCpe)}</cbc:StreetName>`)
  lineas.push(
    '        <cac:Country>',
    '          <cbc:IdentificationCode listID="ISO 3166" listAgencyName="United Nations Economic Commission for Europe" listName="Country">PE</cbc:IdentificationCode>',
    '        </cac:Country>',
    '      </cac:PostalAddress>',
  )
  return lineas.join('\n')
}

function parteEmisor(cpe: CpeAEnviar): string {
  const { emisor } = cpe
  const ruc = escapar(emisor.ruc)
  const razon = escapar(emisor.razonSocial)
  return [
    '    <cac:AccountingSupplierParty>',
    '      <cac:Party>',
    '        <cac:PartyIdentification>',
    `          <cbc:ID schemeID="6" schemeName="Documento de Identidad" schemeAgencyName="PE:SUNAT" schemeURI="urn:pe:gob:sunat:cpe:see:gem:catalogos:catalogo06">${ruc}</cbc:ID>`,
    '        </cac:PartyIdentification>',
    '        <cac:PartyName>',
    `          <cbc:Name>${razon}</cbc:Name>`,
    '        </cac:PartyName>',
    direccionPostal(emisor.direccion, emisor.ubigeo),
    '        <cac:PartyLegalEntity>',
    `          <cbc:RegistrationName>${razon}</cbc:RegistrationName>`,
    '          <cac:RegistrationAddress>',
    `            <cbc:ID schemeID="UN/ECE 3199" schemeAgencyName="PE:SUNAT">${escapar(emisor.ubigeo)}</cbc:ID>`,
    '            <cbc:AddressTypeCode>0000</cbc:AddressTypeCode>',
    `            <cbc:StreetName>${escapar(emisor.direccion)}</cbc:StreetName>`,
    '            <cac:Country><cbc:IdentificationCode>PE</cbc:IdentificationCode></cac:Country>',
    '          </cac:RegistrationAddress>',
    '        </cac:PartyLegalEntity>',
    '      </cac:Party>',
    '    </cac:AccountingSupplierParty>',
  ].join('\n')
}

function parteReceptor(cpe: CpeAEnviar): string {
  const { receptor } = cpe
  const lineas = [
    '    <cac:AccountingCustomerParty>',
    '      <cac:Party>',
    '        <cac:PartyIdentification>',
    `          <cbc:ID schemeID="${codigoTipoDocumento(receptor.tipoDocumento)}" schemeName="Documento de Identidad" schemeAgencyName="PE:SUNAT" schemeURI="urn:pe:gob:sunat:cpe:see:gem:catalogos:catalogo06">${escapar(receptor.numeroDocumento)}</cbc:ID>`,
    '        </cac:PartyIdentification>',
  ]
  if (receptor.direccion) lineas.push(direccionPostal(receptor.direccion))
  lineas.push(
    '        <cac:PartyLegalEntity>',
    `          <cbc:RegistrationName>${escapar(receptor.razonSocial)}</cbc:RegistrationName>`,
    '        </cac:PartyLegalEntity>',
    '      </cac:Party>',
    '    </cac:AccountingCustomerParty>',
  )
  return lineas.join('\n')
}

/** Solo se emite al contado (catálogo 59); SUNAT lo exige desde 2022. */
function formaPagoContado(): string {
  return [
    '  <cac:PaymentTerms>',
    '    <cbc:ID>FormaPago</cbc:ID>',
    '    <cbc:PaymentMeansID>Contado</cbc:PaymentMeansID>',
    '  </cac:PaymentTerms>',
  ].join('\n')
}

function impuestosLinea(linea: LineaCalculadaDirecta, moneda: string): string {
  return [
    '      <cac:TaxTotal>',
    `        <cbc:TaxAmount currencyID="${moneda}">${formatoDinero(linea.igvCentavos)}</cbc:TaxAmount>`,
    '        <cac:TaxSubtotal>',
    `          <cbc:TaxableAmount currencyID="${moneda}">${formatoDinero(linea.baseCentavos)}</cbc:TaxableAmount>`,
    `          <cbc:TaxAmount currencyID="${moneda}">${formatoDinero(linea.igvCentavos)}</cbc:TaxAmount>`,
    categoriaTributo(linea.regimen, '          '),
    '        </cac:TaxSubtotal>',
    '      </cac:TaxTotal>',
  ].join('\n')
}

function lineaComprobante(
  linea: CpeAEnviar['lineas'][number],
  calculada: LineaCalculadaDirecta,
  indice: number,
  moneda: string,
): string {
  const partes = [
    '    <cac:InvoiceLine>',
    `      <cbc:ID>${indice + 1}</cbc:ID>`,
    `      <cbc:InvoicedQuantity unitCode="${codigoUnidad(linea.unidad)}">${formatoCantidad(linea.cantidad)}</cbc:InvoicedQuantity>`,
    `      <cbc:LineExtensionAmount currencyID="${moneda}">${formatoDinero(calculada.baseCentavos)}</cbc:LineExtensionAmount>`,
  ]

  // SUNAT exige el precio unitario con IGV (01) en líneas onerosas y el
  // valor referencial (02) en transferencias gratuitas.
  const precioReferencia = calculada.gratuita
    ? formatoDinero(calculada.referenciaCentavos)
    : formatoUnitario(linea.precioUnitario)
  const tipoPrecio = calculada.gratuita ? '02' : '01'
  partes.push(
    '      <cac:PricingReference>',
    '        <cac:AlternativeConditionPrice>',
    `          <cbc:PriceAmount currencyID="${moneda}">${precioReferencia}</cbc:PriceAmount>`,
    `          <cbc:PriceTypeCode listName="Tipo de Precio" listAgencyName="PE:SUNAT" listURI="urn:pe:gob:sunat:cpe:see:gem:catalogos:catalogo16">${tipoPrecio}</cbc:PriceTypeCode>`,
    '        </cac:AlternativeConditionPrice>',
    '      </cac:PricingReference>',
  )

  partes.push(
    impuestosLinea(calculada, moneda),
    '      <cac:Item>',
    `        <cbc:Description>${escapar(linea.descripcion)}</cbc:Description>`,
    '      </cac:Item>',
    '      <cac:Price>',
    `        <cbc:PriceAmount currencyID="${moneda}">${calculada.gratuita ? '0.00' : formatoUnitario(linea.valorUnitario)}</cbc:PriceAmount>`,
    '      </cac:Price>',
    '    </cac:InvoiceLine>',
  )
  return partes.join('\n')
}

/**
 * Genera el XML UBL 2.1 sin firmar de una Factura (01) o Boleta (03).
 * El contenedor `UBLExtensions` queda vacío: la firma XAdES-BES se inserta ahí.
 */
export function generarXmlCpe(cpe: CpeAEnviar): string {
  const totales = calcularTotales(cpe)
  const codigo = codigoTipoComprobante(cpe.tipo)
  const moneda = escapar(cpe.moneda || 'PEN')
  const ruc = escapar(cpe.emisor.ruc)
  const razon = escapar(cpe.emisor.razonSocial)
  const legendas: string[] = []
  if (totales.todasGratuitas) {
    legendas.push(`  <cbc:Note languageLocaleID="1002">${LEYENDA_TRANSFERENCIA_GRATUITA}</cbc:Note>`)
  }
  if (cpe.observacion?.trim()) {
    legendas.push(`  <cbc:Note>${escapar(cpe.observacion.trim())}</cbc:Note>`)
  }
  if (cpe.detalleDetraccion && cpe.detalleDetraccion.codigo !== '000') {
    const { codigo, tasa, monto } = cpe.detalleDetraccion
    legendas.push(
      `  <cbc:Note>DETRACCIÓN ${escapar(codigo)} (${tasa}%): ${formatoDinero(Math.round(monto * 100))}</cbc:Note>`,
    )
  }

  const igvGratuito = totales.lineas
    .filter((linea) => linea.gratuita)
    .reduce((suma, linea) => suma + linea.igvCentavos, 0)
  const igvOneroso = totales.igvCentavos - igvGratuito

  const subtotales: string[] = []
  if (totales.gravadoCentavos > 0 || igvOneroso > 0) {
    subtotales.push(subtotalTributo('GRAVADO', totales.gravadoCentavos, igvOneroso, moneda))
  }
  if (totales.exoneradoCentavos > 0) {
    subtotales.push(subtotalTributo('EXONERADO', totales.exoneradoCentavos, 0, moneda))
  }
  if (totales.gratuitoCentavos > 0) {
    subtotales.push(subtotalTributo('GRATUITO', totales.gratuitoCentavos, igvGratuito, moneda))
  }

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"',
    `  xmlns:cac="${NAMESPACES.cac}"`,
    `  xmlns:cbc="${NAMESPACES.cbc}"`,
    `  xmlns:ds="${NAMESPACES.ds}"`,
    `  xmlns:ext="${NAMESPACES.ext}">`,
    '  <ext:UBLExtensions>',
    '    <ext:UBLExtension>',
    '      <ext:ExtensionContent/>',
    '    </ext:UBLExtension>',
    '  </ext:UBLExtensions>',
    '  <cbc:UBLVersionID>2.1</cbc:UBLVersionID>',
    '  <cbc:CustomizationID>2.0</cbc:CustomizationID>',
    `  <cbc:ID>${escapar(cpe.serie)}-${cpe.numero}</cbc:ID>`,
    `  <cbc:IssueDate>${fechaEmision(cpe.fecha)}</cbc:IssueDate>`,
    '  <cbc:InvoiceTypeCode listID="0101" listAgencyName="PE:SUNAT" listName="Tipo de Documento" listURI="urn:pe:gob:sunat:cpe:see:gem:catalogos:catalogo01">' +
      codigo +
      '</cbc:InvoiceTypeCode>',
    ...legendas,
    `  <cbc:DocumentCurrencyCode listID="ISO 4217 Alpha" listName="Currency" listAgencyName="United Nations Economic Commission for Europe">${moneda}</cbc:DocumentCurrencyCode>`,
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
    parteEmisor(cpe),
    parteReceptor(cpe),
    formaPagoContado(),
    '  <cac:TaxTotal>',
    `    <cbc:TaxAmount currencyID="${moneda}">${formatoDinero(igvOneroso)}</cbc:TaxAmount>`,
    ...subtotales,
    '  </cac:TaxTotal>',
    '  <cac:LegalMonetaryTotal>',
    `    <cbc:LineExtensionAmount currencyID="${moneda}">${formatoDinero(totales.lineExtensionCentavos)}</cbc:LineExtensionAmount>`,
    `    <cbc:TaxInclusiveAmount currencyID="${moneda}">${formatoDinero(totales.totalCentavos)}</cbc:TaxInclusiveAmount>`,
    `    <cbc:PayableAmount currencyID="${moneda}">${formatoDinero(totales.totalCentavos)}</cbc:PayableAmount>`,
    '  </cac:LegalMonetaryTotal>',
    ...totales.lineas.map((linea, indice) => lineaComprobante(cpe.lineas[indice]!, linea, indice, moneda)),
    '</Invoice>',
    '',
  ].join('\n')
}

