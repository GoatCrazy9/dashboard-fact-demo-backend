import type { TipoComprobante } from '@prisma/client'

export interface EmisorCpe {
  ruc: string
  razonSocial: string
  direccion: string
  ubigeo: string
}

export interface ReceptorCpe {
  tipoDocumento: string
  numeroDocumento: string
  razonSocial: string
  direccion: string | null
}

export interface LineaCpe {
  descripcion: string
  cantidad: number
  unidad: string
  valorUnitario: number
  precioUnitario: number
  igv: number
  total: number
  afectoIgv: boolean
  /** Opcional: el proveedor directo también detecta líneas gratuitas por precio y total en cero. */
  gratuito?: boolean
  /** Opcional: valor referencial por unidad en operaciones no onerosas (catálogo 16, código 02). */
  valorReferencial?: number
}

export interface CpeAEnviar {
  id: string
  tipo: TipoComprobante
  serie: string
  numero: number
  fecha: Date
  moneda: string
  emisor: EmisorCpe
  receptor: ReceptorCpe
  lineas: LineaCpe[]
  subtotal: number
  igv: number
  total: number
  observacion: string | null
  detalleDetraccion?: {
    codigo: string
    tasa: number
    monto: number
  }
}

/** Paquete generado por el emisor directo, listo para archivar. */
export interface ArchivosEnvio {
  xmlFirmado: string
  zip: Buffer
  cdrBase64?: string | null
}

export interface ResultadoEnvio {
  estado: 'ACEPTADO' | 'EMITIDO' | 'RECHAZADO'
  codigo: string | null
  mensaje: string | null
  uuid: string | null
  archivos?: ArchivosEnvio
}

export interface ProveedorSunat {
  readonly nombre: string
  enviar(cpe: CpeAEnviar): Promise<ResultadoEnvio>
}
