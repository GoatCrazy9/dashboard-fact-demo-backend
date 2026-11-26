import { apisperuConfigurado, env, sunatDirectConfigurado } from '../../config/env.ts'
import { proveedorApisperu } from './apisperu.ts'
import { proveedorLocal } from './local.ts'
import { endpointDirecto } from './sunat-direct/cliente.ts'
import { proveedorDirecto } from './sunat-direct/index.ts'
import type { ProveedorSunat } from './types.ts'

export type { CpeAEnviar, LineaCpe, ProveedorSunat, ResultadoEnvio } from './types.ts'
export { proveedorDirecto } from './sunat-direct/index.ts'

type NombreProveedor = 'local' | 'apisperu' | 'sunat-direct'

/**
 * Selección por configuración:
 * - SUNAT_PROVEEDOR=local|apisperu|direct fuerza el proveedor.
 * - En `auto` (por defecto) se conserva el comportamiento histórico: apisperu
 *   si tiene credenciales, luego el emisor directo y, si no, el simulador.
 */
export function nombreProveedorActual(): NombreProveedor {
  if (env.sunatProveedor === 'local' || (env.sunatProveedor === 'auto' && env.sunatModo === 'local')) {
    return 'local'
  }
  if (env.sunatProveedor === 'apisperu') return 'apisperu'
  if (env.sunatProveedor === 'direct') return 'sunat-direct'
  if (apisperuConfigurado) return 'apisperu'
  if (sunatDirectConfigurado) return 'sunat-direct'
  return 'local'
}

/** Si faltan credenciales, el sistema emite en modo local en lugar de fallar. */
export function proveedorActual(): ProveedorSunat {
  switch (nombreProveedorActual()) {
    case 'apisperu':
      return proveedorApisperu
    case 'sunat-direct':
      return proveedorDirecto
    default:
      return proveedorLocal
  }
}

export function endpointSunatActual(): string {
  return nombreProveedorActual() === 'sunat-direct' ? endpointDirecto() : 'local (sin envío a SUNAT)'
}
