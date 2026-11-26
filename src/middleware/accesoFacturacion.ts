import type { RequestHandler } from 'express'
import { HttpError } from '../lib/http.ts'

/**
 * El maestro solo administra usuarios. Un vendedor sin `puedeFacturar` no entra
 * a facturación, aunque su token siga vigente.
 */
export const accesoFacturacion: RequestHandler = (req, _res, next) => {
  const usuario = req.authUser
  if (!usuario) {
    throw new HttpError(401, 'UNAUTHORIZED', 'Necesitas un token de acceso para continuar.')
  }

  if (usuario.rol === 'ADMIN' || usuario.puedeFacturar) {
    next()
    return
  }

  throw new HttpError(
    403,
    'ACCESO_DENEGADO',
    'Tu cuenta no tiene acceso al sistema de facturación. Solicítalo al maestro.',
  )
}
