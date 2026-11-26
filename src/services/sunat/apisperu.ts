import { env } from '../../config/env.ts'
import { errores } from '../../lib/http.ts'
import type { CpeAEnviar, ProveedorSunat, ResultadoEnvio } from './types.ts'

const CODIGO_DOCUMENTO: Record<string, string> = {
  FACTURA: '01',
  BOLETA: '03',
  NOTA_CREDITO: '07',
  NOTA_DEBITO: '08',
  GUIA_REMISION: '09',
}

const CODIGO_TIPO_DOCUMENTO: Record<string, string> = {
  DNI: '1',
  RUC: '6',
  CE: '4',
  PASAPORTE: '7',
}

const dinero = (valor: number) => valor.toFixed(2)

interface RespuestaToken {
  data?: { access_token?: string; expires_at?: string }
}

interface RespuestaCpe {
  success?: boolean
  message?: string
  data?: {
    cpe?: {
      uuid?: string
      status?: string
      accepted?: boolean
    }
    provider?: {
      response_code?: string | null
      description?: string | null
      ticket?: string | null
    }
    response?: { code?: string | null; description?: string | null }
  }
}

let tokenCache: { valor: string; expiraEn: number } | null = null

async function obtenerToken(): Promise<string> {
  if (tokenCache && tokenCache.expiraEn > Date.now() + 60_000) return tokenCache.valor

  const respuesta = await fetch(`${env.apisperuBaseUrl}/api/v1/auth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      client_id: env.apisperuClientId,
      client_secret: env.apisperuClientSecret,
    }),
  })

  if (!respuesta.ok) {
    throw errores.sunat(`No se pudo autenticar con el proveedor SUNAT (${respuesta.status}).`)
  }

  const cuerpo = (await respuesta.json()) as RespuestaToken
  const token = cuerpo.data?.access_token
  if (!token) throw errores.sunat('El proveedor SUNAT no devolvió un token de acceso.')

  const expira = cuerpo.data?.expires_at ? Date.parse(cuerpo.data.expires_at) : Date.now() + 50 * 60_000
  tokenCache = { valor: token, expiraEn: Number.isNaN(expira) ? Date.now() + 50 * 60_000 : expira }
  return token
}

function construirPayload(cpe: CpeAEnviar) {
  const gravadas = cpe.lineas.filter((linea) => linea.afectoIgv)
  const exoneradas = cpe.lineas.filter((linea) => !linea.afectoIgv)

  return {
    external_reference: `${cpe.serie}-${cpe.numero}`,
    document_type_code: CODIGO_DOCUMENTO[cpe.tipo] ?? '01',
    series: cpe.serie,
    number: String(cpe.numero),
    issue_date: cpe.fecha.toISOString().slice(0, 10),
    currency_code: cpe.moneda,
    country_code: 'PE',
    sunat_establishment_code: '0000',
    operation_type_code: '0101',
    issuer: {
      ruc: cpe.emisor.ruc,
      trade_name: cpe.emisor.razonSocial,
      address: cpe.emisor.direccion,
    },
    customer: {
      document_type_code: CODIGO_TIPO_DOCUMENTO[cpe.receptor.tipoDocumento] ?? '0',
      document_number: cpe.receptor.numeroDocumento,
      name: cpe.receptor.razonSocial,
      ...(cpe.receptor.direccion ? { address: cpe.receptor.direccion } : {}),
    },
    items: cpe.lineas.map((linea) => ({
      description: linea.descripcion,
      quantity: linea.cantidad.toFixed(2),
      unit_code: linea.unidad,
      unit_value: dinero(linea.valorUnitario),
      line_value: dinero(linea.valorUnitario * linea.cantidad),
      igv_type_code: linea.afectoIgv ? '10' : '20',
      igv_percentage: linea.afectoIgv ? '18.00' : '0.00',
      igv_amount: dinero(linea.igv),
      line_total: dinero(linea.total),
    })),
    totals: {
      taxable_amount: dinero(gravadas.reduce((suma, l) => suma + l.valorUnitario * l.cantidad, 0)),
      exonerated_amount: dinero(
        exoneradas.reduce((suma, l) => suma + l.valorUnitario * l.cantidad, 0),
      ),
      unaffected_amount: '0.00',
      igv_amount: dinero(cpe.igv),
      total_amount: dinero(cpe.total),
    },
    ...(cpe.observacion ? { observation: cpe.observacion } : {}),
    payment: { type: 'contado' },
  }
}

function interpretar(cuerpo: RespuestaCpe): ResultadoEnvio {
  const estado = cuerpo.data?.cpe?.status ?? ''
  const codigo = cuerpo.data?.provider?.response_code ?? cuerpo.data?.response?.code ?? null
  const mensaje =
    cuerpo.data?.provider?.description ??
    cuerpo.data?.response?.description ??
    cuerpo.message ??
    null

  if (estado === 'rejected') {
    return { estado: 'RECHAZADO', codigo: codigo ?? 'RECHAZADO', mensaje, uuid: cuerpo.data?.cpe?.uuid ?? null }
  }

  if (estado === 'accepted') {
    return { estado: 'ACEPTADO', codigo: codigo ?? '0', mensaje, uuid: cuerpo.data?.cpe?.uuid ?? null }
  }

  return {
    estado: 'EMITIDO',
    codigo: codigo ?? 'PENDIENTE',
    mensaje: mensaje ?? 'Comprobante enviado. SUNAT aún no confirma el resultado.',
    uuid: cuerpo.data?.cpe?.uuid ?? null,
  }
}

export const proveedorApisperu: ProveedorSunat = {
  nombre: 'apisperu',

  async enviar(cpe) {
    const token = await obtenerToken()

    const respuesta = await fetch(`${env.apisperuBaseUrl}/api/v2/cpe`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(construirPayload(cpe)),
    })

    if (respuesta.status === 401) {
      tokenCache = null
      throw errores.sunat('El proveedor SUNAT rechazó las credenciales (401).')
    }

    if (respuesta.status >= 500) {
      throw errores.sunat(`El proveedor SUNAT no respondió correctamente (${respuesta.status}).`)
    }

    const cuerpo = (await respuesta.json().catch(() => ({}))) as RespuestaCpe

    if (!respuesta.ok && !cuerpo.data?.cpe) {
      const detalle = cuerpo.message ?? `Error ${respuesta.status} al enviar el comprobante.`
      return { estado: 'RECHAZADO', codigo: String(respuesta.status), mensaje: detalle, uuid: null }
    }

    return interpretar(cuerpo)
  },
}
