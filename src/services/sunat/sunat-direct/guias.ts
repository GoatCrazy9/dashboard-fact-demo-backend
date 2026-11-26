import { codigoTipoDocumento, codigoUnidad } from './catalogos.ts'
import { formatoCantidad } from './dinero.ts'
import { firmarXmlXades, type CertificadoFirma } from './firma.ts'
import { empaquetarXml } from './zip.ts'
import { NAMESPACES } from './xml.ts'

export interface GuiaAEnviar {
  id: string
  serie: string
  numero: number
  fechaEmision: Date
  fechaTraslado: Date
  creadoEn: Date
  motivo: 'VENTA' | 'TRASLADO' | 'DEVOLUCION' | 'OTRO'
  modalidad: 'PUBLICO' | 'PRIVADO'
  pesoKg: number
  direccionPartida: string
  direccionLlegada: string
  ubigeoPartida: string | null
  ubigeoLlegada: string | null
  placa: string
  conductor: string
  conductorDocumento: string
  conductorLicencia: string
  transportistaRuc: string | null
  transportistaRazonSocial: string | null
  transportistaRegistroMtc: string | null
  notas: string | null
  comprobante: { tipo: string; serie: string; numero: number } | null
  emisor: {
    ruc: string
    razonSocial: string
    direccion: string
    ubigeo: string
  }
  receptor: {
    tipoDocumento: string
    numeroDocumento: string
    razonSocial: string
    direccion: string | null
  }
  items: { descripcion: string; cantidad: number; unidad: string }[]
}

/** Catálogo 20 (motivo de traslado) y catálogo 18 (modalidad). */
const MOTIVO: Record<GuiaAEnviar['motivo'], { codigo: string; descripcion: string }> = {
  VENTA: { codigo: '01', descripcion: 'Venta' },
  TRASLADO: { codigo: '04', descripcion: 'Traslado entre establecimientos de la misma empresa' },
  DEVOLUCION: { codigo: '06', descripcion: 'Devolución' },
  OTRO: { codigo: '13', descripcion: 'Otros' },
}

const MODALIDAD: Record<GuiaAEnviar['modalidad'], string> = {
  PUBLICO: '01',
  PRIVADO: '02',
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

/** Hora de Lima (UTC-5) para el tag IssueTime; SUNAT la exige en la cabecera. */
function horaLima(valor: Date): string {
  return new Date(valor.getTime() - 5 * 60 * 60 * 1000).toISOString().slice(11, 19)
}

function primeraYResto(nombre: string): [string, string] {
  const partes = nombre.trim().split(/\s+/)
  if (partes.length === 0) return ['-', '-']
  if (partes.length === 1) return [partes[0]!, '-']
  return [partes[0]!, partes.slice(1).join(' ')]
}

function parteEmisor(guia: GuiaAEnviar): string {
  const razon = escapar(guia.emisor.razonSocial)
  return [
    '  <cac:DespatchSupplierParty>',
    '    <cac:Party>',
    '      <cac:PartyIdentification>',
    `        <cbc:ID schemeID="6">${escapar(guia.emisor.ruc)}</cbc:ID>`,
    '      </cac:PartyIdentification>',
    '      <cac:PartyName>',
    `        <cbc:Name>${razon}</cbc:Name>`,
    '      </cac:PartyName>',
    '      <cac:PartyLegalEntity>',
    `        <cbc:RegistrationName>${razon}</cbc:RegistrationName>`,
    '      </cac:PartyLegalEntity>',
    '    </cac:Party>',
    '  </cac:DespatchSupplierParty>',
  ].join('\n')
}

function parteReceptor(guia: GuiaAEnviar): string {
  return [
    '  <cac:DeliveryCustomerParty>',
    '    <cac:Party>',
    '      <cac:PartyIdentification>',
    `        <cbc:ID schemeID="${codigoTipoDocumento(guia.receptor.tipoDocumento)}">${escapar(guia.receptor.numeroDocumento)}</cbc:ID>`,
    '      </cac:PartyIdentification>',
    '      <cac:PartyLegalEntity>',
    `        <cbc:RegistrationName>${escapar(guia.receptor.razonSocial)}</cbc:RegistrationName>`,
    '      </cac:PartyLegalEntity>',
    '    </cac:Party>',
    '  </cac:DeliveryCustomerParty>',
  ].join('\n')
}

function documentoRelacionado(guia: GuiaAEnviar): string[] {
  if (!guia.comprobante) return []
  const tipo = guia.comprobante.tipo === 'BOLETA' ? '03' : '01'
  const numero = `${guia.comprobante.serie}-${guia.comprobante.numero}`
  return [
    '  <cac:AdditionalDocumentReference>',
    `    <cbc:ID>${escapar(numero)}</cbc:ID>`,
    `    <cbc:DocumentTypeCode>${tipo}</cbc:DocumentTypeCode>`,
    `    <cbc:DocumentType>${tipo === '01' ? 'Factura' : 'Boleta'}</cbc:DocumentType>`,
    '    <cac:IssuerParty>',
    '      <cac:PartyIdentification>',
    `        <cbc:ID schemeID="6">${escapar(guia.emisor.ruc)}</cbc:ID>`,
    '      </cac:PartyIdentification>',
    '    </cac:IssuerParty>',
    '  </cac:AdditionalDocumentReference>',
  ]
}

function conductor(guia: GuiaAEnviar): string[] {
  if (!guia.conductor) return []
  const [nombre, apellido] = primeraYResto(guia.conductor)
  return [
    '      <cac:DriverPerson>',
    `        <cbc:ID schemeID="1">${escapar(guia.conductorDocumento)}</cbc:ID>`,
    `        <cbc:FirstName>${escapar(nombre)}</cbc:FirstName>`,
    `        <cbc:FamilyName>${escapar(apellido)}</cbc:FamilyName>`,
    '        <cbc:JobTitle>Principal</cbc:JobTitle>',
    '        <cac:IdentityDocumentReference>',
    `          <cbc:ID>${escapar(guia.conductorLicencia)}</cbc:ID>`,
    '        </cac:IdentityDocumentReference>',
    '      </cac:DriverPerson>',
  ]
}

function transportista(guia: GuiaAEnviar): string[] {
  if (
    guia.modalidad !== 'PUBLICO' ||
    !guia.transportistaRuc ||
    !guia.transportistaRegistroMtc
  ) {
    return []
  }
  const razon = escapar(guia.transportistaRazonSocial ?? guia.transportistaRuc)
  return [
    '      <cac:CarrierParty>',
    '        <cac:PartyIdentification>',
    `          <cbc:ID schemeID="6">${escapar(guia.transportistaRuc)}</cbc:ID>`,
    '        </cac:PartyIdentification>',
    '        <cac:PartyName>',
    `          <cbc:Name>${razon}</cbc:Name>`,
    '        </cac:PartyName>',
    '        <cac:PartyLegalEntity>',
    `          <cbc:RegistrationName>${razon}</cbc:RegistrationName>`,
    '        </cac:PartyLegalEntity>',
    `        <cbc:AdditionalAccountID schemeID="MTC">${escapar(guia.transportistaRegistroMtc ?? '')}</cbc:AdditionalAccountID>`,
    '      </cac:CarrierParty>',
  ]
}

function direccion(etiqueta: 'DeliveryAddress' | 'DespatchAddress', ubigeo: string | null, texto: string, ruc: string, esPartida: boolean): string[] {
  return [
    `        <cac:${etiqueta}>`,
    `          <cbc:ID>${escapar(ubigeo ?? '')}</cbc:ID>`,
    esPartida
      ? `          <cbc:AddressTypeCode listID="${escapar(ruc)}">0000</cbc:AddressTypeCode>`
      : '',
    '          <cac:AddressLine>',
    `            <cbc:Line>${escapar(texto)}</cbc:Line>`,
    '          </cac:AddressLine>',
    `        </cac:${etiqueta}>`,
  ].filter(Boolean)
}

/** Genera el DespatchAdvice UBL 2.1 sin firmar. El contenedor ext queda listo para XAdES. */
export function generarXmlGuia(guia: GuiaAEnviar): string {
  const motivo = MOTIVO[guia.motivo]
  const razon = escapar(guia.emisor.razonSocial)
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<DespatchAdvice xmlns="urn:oasis:names:specification:ubl:schema:xsd:DespatchAdvice-2"',
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
    // La plataforma nueva GRE (REST) exige la estructura 2.0 (regla 2112).
    '  <cbc:CustomizationID>2.0</cbc:CustomizationID>',
    `  <cbc:ID>${escapar(guia.serie)}-${guia.numero}</cbc:ID>`,
    `  <cbc:IssueDate>${fecha(guia.fechaEmision)}</cbc:IssueDate>`,
    `  <cbc:IssueTime>${horaLima(guia.creadoEn)}</cbc:IssueTime>`,
    '  <cbc:DespatchAdviceTypeCode listAgencyName="PE:SUNAT" listName="SUNAT:Identificador de Tipo de Documento" listURI="urn:pe:gob:sunat:cpe:see:gem:catalogos:catalogo01">09</cbc:DespatchAdviceTypeCode>',
    ...(guia.notas?.trim() ? [`  <cbc:Note>${escapar(guia.notas.trim())}</cbc:Note>`] : []),
    ...documentoRelacionado(guia),
    '  <cac:Signature>',
    '    <cbc:ID>SignatureSP</cbc:ID>',
    '    <cac:SignatoryParty>',
    '      <cac:PartyIdentification>',
    `        <cbc:ID>${escapar(guia.emisor.ruc)}</cbc:ID>`,
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
    parteEmisor(guia),
    parteReceptor(guia),
    '  <cac:Shipment>',
    '    <cbc:ID>SUNAT_Envio</cbc:ID>',
    `    <cbc:HandlingCode>${motivo.codigo}</cbc:HandlingCode>`,
    `    <cbc:HandlingInstructions>${escapar(motivo.descripcion)}</cbc:HandlingInstructions>`,
    `    <cbc:GrossWeightMeasure unitCode="KGM">${guia.pesoKg.toFixed(3)}</cbc:GrossWeightMeasure>`,
    '    <cac:ShipmentStage>',
    `      <cbc:TransportModeCode>${MODALIDAD[guia.modalidad]}</cbc:TransportModeCode>`,
    '      <cac:TransitPeriod>',
    `        <cbc:StartDate>${fecha(guia.fechaTraslado)}</cbc:StartDate>`,
    '      </cac:TransitPeriod>',
    ...transportista(guia),
    ...conductor(guia),
    '    </cac:ShipmentStage>',
    '    <cac:Delivery>',
    ...direccion('DeliveryAddress', guia.ubigeoLlegada, guia.direccionLlegada, guia.emisor.ruc, false),
    '      <cac:Despatch>',
    ...direccion('DespatchAddress', guia.ubigeoPartida, guia.direccionPartida, guia.emisor.ruc, true),
    '      </cac:Despatch>',
    '    </cac:Delivery>',
    ...(guia.placa
      ? [
          '    <cac:TransportHandlingUnit>',
          '      <cac:TransportEquipment>',
          `        <cbc:ID>${escapar(guia.placa)}</cbc:ID>`,
          '      </cac:TransportEquipment>',
          '    </cac:TransportHandlingUnit>',
        ]
      : []),
    '  </cac:Shipment>',
    ...guia.items.map(
      (item, indice) =>
        [
          '  <cac:DespatchLine>',
          `    <cbc:ID>${indice + 1}</cbc:ID>`,
          `    <cbc:DeliveredQuantity unitCode="${codigoUnidad(item.unidad)}">${formatoCantidad(item.cantidad)}</cbc:DeliveredQuantity>`,
          '    <cac:OrderLineReference>',
          `      <cbc:LineID>${indice + 1}</cbc:LineID>`,
          '    </cac:OrderLineReference>',
          '    <cac:Item>',
          `      <cbc:Description>${escapar(item.descripcion)}</cbc:Description>`,
          '    </cac:Item>',
          '  </cac:DespatchLine>',
        ].join('\n'),
    ),
    '</DespatchAdvice>',
    '',
  ].join('\n')
}

export function nombreArchivoGuia(guia: GuiaAEnviar, extension: 'xml' | 'zip'): string {
  return `${guia.emisor.ruc}-09-${guia.serie}-${guia.numero}.${extension}`
}

export interface PaqueteGuia {
  nombreXml: string
  nombreZip: string
  xmlFirmado: string
  zip: Buffer
}

export async function prepararPaqueteGuia(
  guia: GuiaAEnviar,
  certificado: CertificadoFirma,
): Promise<PaqueteGuia> {
  const xml = generarXmlGuia(guia)
  const xmlFirmado = firmarXmlXades(xml, certificado)
  const nombreXml = nombreArchivoGuia(guia, 'xml')
  return {
    nombreXml,
    nombreZip: nombreArchivoGuia(guia, 'zip'),
    xmlFirmado,
    zip: await empaquetarXml(nombreXml, xmlFirmado),
  }
}

