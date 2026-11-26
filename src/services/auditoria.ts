import type { Request } from 'express'
import { prisma } from '../lib/prisma.ts'

/** Módulos que se muestran en el filtro de la bitácora. */
export const MODULOS_AUDITORIA = [
  'Sesión',
  'Ventas',
  'Comprobantes',
  'Proformas y pedidos',
  'Guías de remisión',
  'Resúmenes y bajas',
  'Clientes',
  'Productos',
  'Usuarios y accesos',
  'Configuración',
  'Reportes',
  'Sistema',
] as const

type ModuloAuditoria = (typeof MODULOS_AUDITORIA)[number]

const RUTAS_MODULO: { patron: RegExp; modulo: ModuloAuditoria; entidad: string }[] = [
  { patron: /^\/api\/autenticacion/, modulo: 'Sesión', entidad: 'Sesión' },
  { patron: /^\/api\/ventas/, modulo: 'Ventas', entidad: 'Comprobante' },
  { patron: /^\/api\/comprobantes/, modulo: 'Comprobantes', entidad: 'Comprobante' },
  { patron: /^\/api\/documentos/, modulo: 'Proformas y pedidos', entidad: 'Documento' },
  { patron: /^\/api\/guias/, modulo: 'Guías de remisión', entidad: 'Guía' },
  { patron: /^\/api\/resumenes/, modulo: 'Resúmenes y bajas', entidad: 'Resumen' },
  { patron: /^\/api\/clientes/, modulo: 'Clientes', entidad: 'Cliente' },
  { patron: /^\/api\/productos/, modulo: 'Productos', entidad: 'Producto' },
  { patron: /^\/api\/usuarios/, modulo: 'Usuarios y accesos', entidad: 'Usuario' },
  { patron: /^\/api\/configuracion/, modulo: 'Configuración', entidad: 'Configuración' },
  { patron: /^\/api\/detracciones/, modulo: 'Configuración', entidad: 'Detracción' },
  { patron: /^\/api\/reportes/, modulo: 'Reportes', entidad: 'Reporte' },
  { patron: /^\/api\/exportaciones/, modulo: 'Reportes', entidad: 'Exportación' },
  { patron: /^\/api\/reniec/, modulo: 'Clientes', entidad: 'RENIEC' },
]

const ACCIONES_RUTA: Record<string, string> = {
  ajustar: 'Ajustar stock',
  anular: 'Anular',
  aprobar: 'Aprobar',
  bajas: 'Generar bajas',
  convertir: 'Convertir',
  diario: 'Generar diario',
  emitir: 'Emitir',
  estado: 'Cambiar estado',
  exportaciones: 'Exportar',
  login: 'Iniciar sesión',
  logout: 'Cerrar sesión',
  notas: 'Emitir nota',
  password: 'Cambiar contraseña',
  rechazar: 'Rechazar',
  reenviar: 'Reenviar',
}

export interface EventoAuditoria {
  usuarioId: string | null
  usuario: string
  nombre: string | null
  modulo: string
  accion: string
  entidad: string
  entidadId: string | null
  metodo: string
  ruta: string
  estado: number
  direccionIp: string | null
  detalle?: string | null
}

const CLAVES_SENSIBLES = /contrase(?:ñ|n)a|password|token|secret|clave|authorization|cookie|jwt|pepper/i
const LONGITUD_TEXTO = 500
const MAX_ENTRADAS = 50
const MAX_DETALLE = 8000

/** Convierte solicitudes/respuestas en un valor serializable sin secretos ni ciclos. */
export function sanitizarDetalle(valor: unknown, visitados = new WeakSet<object>()): unknown {
  if (valor === null || valor === undefined) return null
  if (typeof valor === 'string') {
    return valor.length > LONGITUD_TEXTO ? `${valor.slice(0, LONGITUD_TEXTO)}…` : valor
  }
  if (typeof valor === 'number' || typeof valor === 'boolean') return valor
  if (typeof valor === 'bigint') return valor.toString()
  if (valor instanceof Date) return valor.toISOString()
  if (typeof valor !== 'object') return String(valor)

  if (visitados.has(valor)) return '[CIRCULAR]'
  visitados.add(valor)

  if (Array.isArray(valor)) {
    return valor.slice(0, MAX_ENTRADAS).map((item) => sanitizarDetalle(item, visitados))
  }

  const resultado: Record<string, unknown> = {}
  for (const [clave, hijo] of Object.entries(valor).slice(0, MAX_ENTRADAS)) {
    resultado[clave] = CLAVES_SENSIBLES.test(clave)
      ? '[OCULTO]'
      : sanitizarDetalle(hijo, visitados)
  }
  return resultado
}

/** Texto JSON guardado en la bitácora. Devuelve null cuando no hay nada útil que mostrar. */
export function construirDetalle(partes: Record<string, unknown>): string | null {
  const limpio: Record<string, unknown> = {}
  for (const [clave, valor] of Object.entries(partes)) {
    if (valor === undefined || valor === null) continue
    const saneado = sanitizarDetalle(valor)
    if (saneado && typeof saneado === 'object' && !Array.isArray(saneado)
      && Object.keys(saneado as Record<string, unknown>).length === 0) continue
    limpio[clave] = saneado
  }
  if (Object.keys(limpio).length === 0) return null
  return JSON.stringify(limpio, null, 2).slice(0, MAX_DETALLE)
}

/** Traduce una petición a los campos legibles que se guardan en la bitácora. */
export function describirOperacion(metodo: string, ruta: string) {
  const limpia = ruta.split('?')[0]
  const modulo = RUTAS_MODULO.find((item) => item.patron.test(limpia)) ?? {
    modulo: 'Sistema' as ModuloAuditoria,
    entidad: 'Registro',
  }

  const relativas = limpia.replace(/^\/api\/?/, '').split('/').filter(Boolean)
  const ultimo = relativas.at(-1) ?? ''
  let accion = ACCIONES_RUTA[ultimo]
  if (!accion) {
    if (metodo.toUpperCase() === 'POST') accion = 'Crear'
    else if (metodo.toUpperCase() === 'DELETE') accion = 'Eliminar'
    else accion = 'Actualizar'
  }

  // En `/api/documentos/:id/convertir` el identificador es el segmento después del módulo.
  const candidato = relativas[1]
  const entidadId = candidato && !ACCIONES_RUTA[candidato] ? candidato : null

  return { modulo: modulo.modulo, entidad: modulo.entidad, accion, entidadId }
}

export function rutaSegura(req: Request): string {
  return req.originalUrl.split('?')[0].slice(0, 300)
}

export function direccionIp(req: Request): string | null {
  return req.ip?.replace(/^::ffff:/, '') ?? null
}

export async function registrarEvento(datos: EventoAuditoria): Promise<void> {
  await prisma.auditoria.create({ data: datos })
}

/** La bitácora nunca debe impedir una operación ya realizada. */
export function registrarEventoSeguro(datos: EventoAuditoria): void {
  void registrarEvento(datos).catch((error: unknown) => {
    console.error('[auditoría] No se pudo registrar el evento:', error)
  })
}

const FECHA = /^\d{4}-\d{2}-\d{2}$/

export function fechaValida(valor: string): boolean {
  if (!FECHA.test(valor)) return false
  const fecha = new Date(`${valor}T00:00:00.000Z`)
  return !Number.isNaN(fecha.getTime()) && fecha.toISOString().slice(0, 10) === valor
}

/** El frontend trabaja en hora de Lima (UTC-5, sin horario de verano). */
export function limitesDia(valor: string): { inicio: Date; fin: Date } {
  return {
    inicio: new Date(`${valor}T00:00:00.000-05:00`),
    fin: new Date(`${valor}T23:59:59.999-05:00`),
  }
}
