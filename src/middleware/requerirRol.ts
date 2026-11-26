import type { RequestHandler } from 'express'
import { HttpError } from '../lib/http.ts'

/** Restringe una ruta a los roles indicados después de `autenticar`. */
export function requerirRol(...roles: string[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.authUser || !roles.includes(req.authUser.rol)) {
      throw new HttpError(403, 'ACCESO_DENEGADO', 'No tienes permiso para realizar esta acción.')
    }
    next()
  }
}
