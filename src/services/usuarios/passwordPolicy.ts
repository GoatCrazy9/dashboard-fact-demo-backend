export interface PasswordActor {
  id: string
  role: string
}

export interface PasswordTarget {
  id: string
  role: string
}

/**
 * La gestión de contraseñas es exclusiva del MAESTRO, pero las cuentas MAESTRO
 * quedan protegidas: nadie puede renovarlas desde este endpoint, incluido el
 * propio usuario autenticado.
 */
export function canChangePassword(actor: PasswordActor, target: PasswordTarget): boolean {
  return actor.role === 'MAESTRO' && target.role !== 'MAESTRO'
}
