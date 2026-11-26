import { env, reniecConfigurado } from '../config/env.ts'
import { HttpError } from '../lib/http.ts'

export type TipoDocumentoReniec = 'dni' | 'cee' | 'ruc'

export interface PersonaReniec {
  proveedor: string
  tipo_documento: 'DNI' | 'CEE'
  numero_documento: string | null
  nombres: string | null
  apellido_paterno: string | null
  apellido_materno: string | null
  nombre_completo: string | null
  direccion: string | null
  direccion_completa: string | null
  distrito: string | null
  provincia: string | null
  departamento: string | null
  ubigeo_reniec: string | null
  ubigeo_sunat: string | null
}

export interface ContribuyenteReniec {
  proveedor: string
  tipo_documento: 'RUC'
  numero_documento: string | null
  razon_social: string | null
  estado: string | null
  condicion: string | null
  direccion: string | null
  direccion_completa: string | null
  distrito: string | null
  provincia: string | null
  departamento: string | null
  ubigeo_sunat: string | null
}

export type RespuestaReniec = PersonaReniec | ContribuyenteReniec

type DatosProveedor = Record<string, unknown>

const PESOS_RUC = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2]

const texto = (valor: unknown): string | null =>
  typeof valor === 'string' && valor.trim() ? valor.trim() : null

function validar(
  tipo: TipoDocumentoReniec,
  numero: string,
): { valor: string; error: string | null } {
  const valor = tipo === 'cee' ? numero.trim().toUpperCase() : numero.trim()
  if (tipo === 'dni' && !/^\d{8}$/.test(valor))
    return { valor, error: 'El DNI tiene 8 dígitos.' }
  if (tipo === 'cee' && !/^[A-Z0-9]{8,12}$/.test(valor))
    return { valor, error: 'El carné de extranjería tiene entre 8 y 12 letras o números.' }
  if (tipo === 'ruc') {
    if (!/^(10|15|16|17|20)\d{9}$/.test(valor))
      return { valor, error: 'El RUC tiene 11 dígitos.' }
    const suma = PESOS_RUC.reduce(
      (total, peso, indice) => total + peso * Number(valor[indice]),
      0,
    )
    const verificador = (11 - (suma % 11)) % 10
    if (verificador !== Number(valor[10]))
      return { valor, error: 'El RUC ingresado no es válido.' }
  }
  return { valor, error: null }
}

function normalizar(
  tipo: TipoDocumentoReniec,
  datos: DatosProveedor,
): RespuestaReniec {
  if (tipo === 'ruc') {
    return {
      proveedor: 'factiliza',
      tipo_documento: 'RUC',
      numero_documento: texto(datos.numero),
      razon_social: texto(datos.nombre_o_razon_social),
      estado: texto(datos.estado),
      condicion: texto(datos.condicion),
      direccion: texto(datos.direccion),
      direccion_completa: texto(datos.direccion_completa),
      distrito: texto(datos.distrito),
      provincia: texto(datos.provincia),
      departamento: texto(datos.departamento),
      ubigeo_sunat: texto(datos.ubigeo_sunat),
    }
  }

  const nombres = texto(datos.nombres)
  const apellidoPaterno = texto(datos.apellido_paterno)
  const apellidoMaterno = texto(datos.apellido_materno)
  const nombreCompleto =
    texto(datos.nombre_completo) ??
    [nombres, apellidoPaterno, apellidoMaterno].filter(Boolean).join(' ')

  return {
    proveedor: 'factiliza',
    tipo_documento: tipo === 'dni' ? 'DNI' : 'CEE',
    numero_documento: texto(datos.numero),
    nombres,
    apellido_paterno: apellidoPaterno,
    apellido_materno: apellidoMaterno,
    nombre_completo: nombreCompleto || null,
    direccion: texto(datos.direccion),
    direccion_completa: texto(datos.direccion_completa),
    distrito: texto(datos.distrito),
    provincia: texto(datos.provincia),
    departamento: texto(datos.departamento),
    ubigeo_reniec: texto(datos.ubigeo_reniec),
    ubigeo_sunat: texto(datos.ubigeo_sunat),
  }
}

/** Consulta DNI, CEE o RUC en Factiliza y devuelve el contrato usado por el frontend. */
export async function consultarDocumento(
  tipo: TipoDocumentoReniec,
  numero: string,
): Promise<RespuestaReniec> {
  if (!reniecConfigurado) {
    throw new HttpError(
      503,
      'RENIEC_NO_CONFIGURADO',
      'La consulta de documentos no está configurada. Avisa al administrador.',
    )
  }

  const { valor, error } = validar(tipo, numero)
  if (error) throw new HttpError(400, 'DATOS_INVALIDOS', error)

  const etiqueta = tipo.toUpperCase()
  let respuesta: Response
  try {
    respuesta = await fetch(
      `${env.reniecUrl.replace(/\/$/, '')}/${tipo}/info/${encodeURIComponent(valor)}`,
      {
        headers: {
          Authorization: `Bearer ${env.reniecToken}`,
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(env.reniecTimeoutMs),
      },
    )
  } catch {
    throw new HttpError(
      503,
      'RENIEC_ERROR',
      `El servicio de consulta de ${etiqueta} no está disponible. Inténtalo más tarde.`,
    )
  }

  if ([400, 404, 422].includes(respuesta.status)) {
    throw new HttpError(404, 'NO_ENCONTRADO', `No se encontraron datos para el ${etiqueta} ingresado.`)
  }
  if (!respuesta.ok) {
    throw new HttpError(
      503,
      'RENIEC_ERROR',
      `El servicio de consulta de ${etiqueta} no está disponible. Inténtalo más tarde.`,
    )
  }

  const cuerpo = (await respuesta.json()) as { success?: boolean; data?: DatosProveedor }
  if (cuerpo.success === false || !cuerpo.data) {
    throw new HttpError(404, 'NO_ENCONTRADO', `No se encontraron datos para el ${etiqueta} ingresado.`)
  }

  return normalizar(tipo, cuerpo.data)
}
