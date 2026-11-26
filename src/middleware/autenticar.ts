import type { RequestHandler } from 'express'
import { env } from '../config/env.ts'
import { verificarToken } from '../lib/auth.ts'
import { HttpError } from '../lib/http.ts'
import { prisma } from '../lib/prisma.ts'

/** Protege las rutas por defecto; vuelve a consultar el usuario para respetar bajas. */
export const autenticar: RequestHandler = async (req, _res, next) => {
  const coincidencia = /^Bearer ([^\s]+)$/i.exec(req.headers.authorization ?? '')
  if (!coincidencia) {
    throw new HttpError(401, 'UNAUTHORIZED', 'Necesitas un token de acceso para continuar.')
  }

  try {
    const payload = verificarToken(coincidencia[1], env.authJwtSecret)
    const usuario = await prisma.usuario.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        nombre: true,
        usuario: true,
        rol: true,
        activo: true,
        puedeFacturar: true,
      },
    })

    if (!usuario || !usuario.activo) {
      throw new HttpError(401, 'UNAUTHORIZED', 'Usuario no disponible.')
    }

    req.authUser = {
      id: usuario.id,
      nombre: usuario.nombre,
      usuario: usuario.usuario,
      rol: String(usuario.rol),
      puedeFacturar: usuario.puedeFacturar,
    }
    next()
  } catch (error) {
    if (error instanceof HttpError) throw error
    throw new HttpError(
      401,
      'UNAUTHORIZED',
      'Tu acceso es inválido o ha caducado, por favor inicia sesión nuevamente.',
    )
  }
}
