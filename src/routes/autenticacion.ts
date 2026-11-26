import { Router, type Request } from 'express'
import { z } from 'zod'
import { env } from '../config/env.ts'
import { emitirToken, hashContrasena, verificarContrasena } from '../lib/auth.ts'
import { HttpError } from '../lib/http.ts'
import { prisma } from '../lib/prisma.ts'
import { autenticar } from '../middleware/autenticar.ts'
import { construirDetalle, direccionIp, registrarEventoSeguro } from '../services/auditoria.ts'

const loginSchema = z
  .object({
    usuario: z.string().trim().min(1).max(255),
    password: z.string().min(1).max(128).optional(),
    contraseña: z.string().min(1).max(128).optional(),
  })
  .strict()
  .refine((datos) => Boolean(datos.password ?? datos.contraseña), {
    message: 'La contraseña es requerida.',
    path: ['password'],
  })

export const autenticacionRouter = Router()

/** El login es público: se registra aquí porque no pasa por el middleware global. */
function registrarSesion(
  req: Request,
  datos: {
    usuario: string
    usuarioId?: string | null
    nombre?: string | null
    accion: string
    estado: number
    detalle?: Record<string, unknown>
  },
) {
  registrarEventoSeguro({
    usuarioId: datos.usuarioId ?? null,
    usuario: datos.usuario,
    nombre: datos.nombre ?? null,
    modulo: 'Sesión',
    accion: datos.accion,
    entidad: 'Sesión',
    entidadId: datos.usuarioId ?? null,
    metodo: 'POST',
    ruta: req.originalUrl.split('?')[0],
    estado: datos.estado,
    direccionIp: direccionIp(req),
    detalle: construirDetalle({ sesion: datos.detalle ?? { resultado: datos.accion } }),
  })
}

autenticacionRouter.post('/login', async (req, res) => {
  const datos = loginSchema.parse(req.body)
  const password = (datos.password ?? datos.contraseña) as string
  const usuarioNormalizado = datos.usuario.toLowerCase()
  const ahora = new Date()

  res.set('Cache-Control', 'no-store')

  const usuario = await prisma.usuario.findUnique({
    where: { usuario: usuarioNormalizado },
    select: {
      id: true,
      nombre: true,
      usuario: true,
      passwordHash: true,
      rol: true,
      activo: true,
      puedeFacturar: true,
      intentosFallidos: true,
      ultimoFalloEn: true,
      bloqueadoHasta: true,
    },
  })

  if (usuario?.bloqueadoHasta && usuario.bloqueadoHasta > ahora) {
    registrarSesion(req, {
      usuario: usuarioNormalizado,
      usuarioId: usuario.id,
      nombre: usuario.nombre,
      accion: 'Inicio bloqueado',
      estado: 423,
      detalle: { motivo: 'Cuenta bloqueada por intentos fallidos' },
    })
    throw new HttpError(
      423,
      'ACCOUNT_LOCKED',
      'Cuenta bloqueada temporalmente por intentos fallidos.',
    )
  }

  const ventanaMs = env.authVentanaMinutos * 60_000
  const fallosPrevios =
    usuario?.ultimoFalloEn && ahora.getTime() - usuario.ultimoFalloEn.getTime() <= ventanaMs
      ? usuario.intentosFallidos
      : 0

  // Se verifica siempre un hash para no revelar si el usuario existe por el tiempo de respuesta.
  const hashSeñuelo = usuario
    ? null
    : await hashContrasena('usuario-inexistente', env.authPasswordPepper)
  const coincide = await verificarContrasena(
    password,
    usuario?.passwordHash ?? (hashSeñuelo as string),
    env.authPasswordPepper,
  )

  if (!usuario || !coincide) {
    const fallos = usuario ? fallosPrevios + 1 : 0
    const bloqueado = Boolean(usuario && fallos >= env.authMaxIntentos)
    if (usuario) {
      await prisma.usuario.update({
        where: { id: usuario.id },
        data: {
          intentosFallidos: bloqueado ? 0 : fallos,
          ultimoFalloEn: ahora,
          bloqueadoHasta: bloqueado
            ? new Date(ahora.getTime() + env.authBloqueoMinutos * 60_000)
            : null,
        },
      })
    }
    registrarSesion(req, {
      usuario: usuarioNormalizado,
      usuarioId: usuario?.id,
      nombre: usuario?.nombre,
      accion: bloqueado ? 'Cuenta bloqueada' : 'Inicio fallido',
      estado: bloqueado ? 423 : 401,
      detalle: {
        motivo: bloqueado ? 'Se alcanzó el máximo de intentos' : 'Usuario o contraseña inválidos',
      },
    })
    if (bloqueado) {
      throw new HttpError(
        423,
        'ACCOUNT_LOCKED',
        'Cuenta bloqueada temporalmente por intentos fallidos.',
      )
    }
    throw new HttpError(401, 'INVALID_CREDENTIALS', 'Usuario o contraseña inválidos')
  }

  if (!usuario.activo) {
    registrarSesion(req, {
      usuario: usuarioNormalizado,
      usuarioId: usuario.id,
      nombre: usuario.nombre,
      accion: 'Inicio inactivo',
      estado: 403,
      detalle: { motivo: 'Cuenta inactiva' },
    })
    throw new HttpError(403, 'ACCOUNT_INACTIVE', 'Tu cuenta está inactiva. Contacta al administrador.')
  }

  const rol = String(usuario.rol)
  const { token, expiresAt, expiresEn } = emitirToken(
    { id: usuario.id, nombre: usuario.nombre, usuario: usuario.usuario, rol },
    env.authJwtSecret,
    env.authTtlSegundos,
  )

  await prisma.usuario.update({
    where: { id: usuario.id },
    data: { intentosFallidos: 0, ultimoFalloEn: null, bloqueadoHasta: null },
  })

  const user = {
    id: usuario.id,
    nombre: usuario.nombre,
    usuario: usuario.usuario,
    rol,
    puedeFacturar: usuario.puedeFacturar,
  }
  registrarSesion(req, {
    usuario: usuario.usuario,
    usuarioId: usuario.id,
    nombre: usuario.nombre,
    accion: 'Iniciar sesión',
    estado: 200,
    detalle: { resultado: 'Sesión iniciada', rol },
  })
  res.json({
    token,
    token_type: 'Bearer',
    expires_in: expiresEn,
    expiresAt,
    user,
    // Compatibilidad con el contrato histórico del frontend de demo.
    usuario: {
      public_id: usuario.id,
      usuario: usuario.usuario,
      rol_id: rol,
      estado: true,
      rol: { id: rol, nombre: rol.toLowerCase() },
    },
  })
})

autenticacionRouter.get('/me', autenticar, (req, res) => {
  res.set('Cache-Control', 'no-store')
  res.json({ user: req.authUser })
})

autenticacionRouter.post('/logout', autenticar, (req, res) => {
  registrarSesion(req, {
    usuario: req.authUser?.usuario ?? 'anónimo',
    usuarioId: req.authUser?.id,
    nombre: req.authUser?.nombre,
    accion: 'Cerrar sesión',
    estado: 204,
  })
  res.status(204).end()
})
