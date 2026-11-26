import type { TipoComprobante } from '@prisma/client'

/** Catálogo 01 (SUNAT): solo factura y boleta están soportados por el emisor directo. */
export const CODIGO_TIPO_COMPROBANTE: Partial<Record<TipoComprobante, '01' | '03'>> = {
  FACTURA: '01',
  BOLETA: '03',
}

export function codigoTipoComprobante(tipo: TipoComprobante): '01' | '03' {
  const codigo = CODIGO_TIPO_COMPROBANTE[tipo]
  if (!codigo) {
    throw new Error(`El proveedor directo solo soporta FACTURA (01) y BOLETA (03); recibió ${tipo}.`)
  }
  return codigo
}

/** Catálogo 06: tipo de documento de identidad del receptor. */
const TIPO_DOCUMENTO: Record<string, string> = {
  DNI: '1',
  RUC: '6',
  CE: '4',
  CARNE_EXTRANJERIA: '4',
  PASAPORTE: '7',
  NO_DOMICILIADO: '0',
  DIPLOMATICO: 'A',
}

export const codigoTipoDocumento = (tipo: string): string => TIPO_DOCUMENTO[tipo.trim().toUpperCase()] ?? '0'

/** Catálogo 03: unidades de medida. Se aceptan alias en español y códigos UNECE. */
const UNIDADES: Record<string, string> = {
  UNIDAD: 'NIU',
  UND: 'NIU',
  UNID: 'NIU',
  UN: 'NIU',
  U: 'NIU',
  PIEZA: 'NIU',
  SERVICIO: 'H87',
  SE: 'H87',
  KILOGRAMO: 'KGM',
  KG: 'KGM',
  GRAMO: 'GRM',
  GR: 'GRM',
  TONELADA: 'TNE',
  METRO: 'MTR',
  M: 'MTR',
  'METRO CUADRADO': 'MTK',
  M2: 'MTK',
  'METRO CUBICO': 'MTQ',
  M3: 'MTQ',
  CENTIMETRO: 'CMT',
  CM: 'CMT',
  MILIMETRO: 'MMT',
  MM: 'MMT',
  LITRO: 'LTR',
  LT: 'LTR',
  GALON: 'GLL',
  CAJA: 'XBX',
  PAQUETE: 'PAK',
  DOCENA: 'DZN',
  JUEGO: 'SET',
  SET: 'SET',
  HORA: 'HUR',
  MINUTO: 'MIN',
  DIA: 'DAY',
  SEMANA: 'WEE',
  MES: 'MON',
  ANIO: 'ANN',
  'AÑO': 'ANN',
}

export function codigoUnidad(unidad: string): string {
  const valor = unidad.trim().toUpperCase()
  return UNIDADES[valor] ?? (/^[A-Z0-9]{2,3}$/.test(valor) ? valor : 'NIU')
}

/** Catálogos 05 y 07: régimen del IGV por línea. */
export const REGIMEN_IGV = {
  GRAVADO: {
    afectacion: '10',
    categoria: 'S',
    tributo: '1000',
    nombre: 'IGV',
    tipoTributo: 'VAT',
    porcentaje: '18.00',
  },
  EXONERADO: {
    afectacion: '20',
    categoria: 'E',
    tributo: '9997',
    nombre: 'EXONERADO',
    tipoTributo: 'VAT',
    porcentaje: '18.00',
  },
  GRATUITO: {
    afectacion: '21',
    categoria: 'Z',
    tributo: '9996',
    nombre: 'GRATUITO',
    tipoTributo: 'FRE',
    porcentaje: '0.00',
  },
  INAFECTO: {
    afectacion: '30',
    categoria: 'O',
    tributo: '9998',
    nombre: 'INAFECTO',
    tipoTributo: 'FRE',
    porcentaje: '0.00',
  },
} as const

export type RegimenIgv = keyof typeof REGIMEN_IGV

/** Catálogo 52, código 1002. Aplica cuando todas las operaciones son gratuitas. */
export const LEYENDA_TRANSFERENCIA_GRATUITA =
  'TRANSFERENCIA GRATUITA DE UN BIEN Y/O SERVICIO PRESTADO GRATUITAMENTE'
