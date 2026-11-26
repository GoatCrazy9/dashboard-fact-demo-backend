import { Router } from 'express'
import { z } from 'zod'
import { env } from '../config/env.ts'
import { hashContrasena } from '../lib/auth.ts'
import { HttpError } from '../lib/http.ts'
import { prisma } from '../lib/prisma.ts'
import { canChangePassword } from '../services/usuarios/passwordPolicy.ts'
import { autenticar } from '../middleware/autenticar.ts'
import { requerirRol } from '../middleware/requerirRol.ts'

const crearSchema = z
  .object({
    nombre: z.string().trim().min(2).max(80),
    usuario: z
      .string()
      .trim()
      .min(3)
      .max(255)
      .regex(/^[a-z0-9._-]+$/i, 'El usuario solo admite letras, números, punto, guion y guion bajo.'),
    password: z.string().min(8).max(128),
    rol: z.enum(['ADMIN', 'VENDEDOR', 'MAESTRO']).default('VENDEDOR'),
    puedeFacturar: z.boolean().default(false),
  })
  .strict()

const accesoSchema = z
  .object({
    puedeFacturar: z.boolean().optional(),
    activo: z.boolean().optional(),
  })
  .strict()
  .refine((datos) => datos.puedeFacturar !== undefined || datos.activo !== undefined, {
    message: 'Indica puedeFacturar o activo.',
  })

const passwordSchema = z
  .object({
    password: z.string().min(8).max(128),
  })
  .strict()

const camposPublicos = {
  id: true,
  nombre: true,
  usuario: true,
  rol: true,
  activo: true,
  puedeFacturar: true,
  creadoEn: true,
} as const

export const usuariosRouter = Router()

usuariosRouter.use(autenticar)
usuariosRouter.use(requerirRol('MAESTRO'))

usuariosRouter.get('/', async (_req, res) => {
  const usuarios = await prisma.usuario.findMany({
    select: camposPublicos,
    orderBy: { creadoEn: 'asc' },
  })
  res.json(usuarios)
})

usuariosRouter.post('/', async (req, res) => {
  const datos = crearSchema.parse(req.body)
  const esMaestro = req.authUser?.rol === 'MAESTRO'
  // El maestro puede crear vendedores y administradores, pero no otros maestros.
  if (esMaestro && datos.rol === 'MAESTRO') {
    throw new HttpError(403, 'ACCESO_DENEGADO', 'El maestro no puede crear otros maestros.')
  }
  const rol = datos.rol
  const puedeFacturar = rol === 'MAESTRO' ? false : datos.puedeFacturar

  const creado = await prisma.usuario.create({
    data: {
      nombre: datos.nombre,
      usuario: datos.usuario.toLowerCase(),
      passwordHash: await hashContrasena(datos.password, env.authPasswordPepper),
      rol,
      puedeFacturar,
    },
    select: camposPublicos,
  })

  res.status(201).json(creado)
})

usuariosRouter.patch('/:id', async (req, res) => {
  const datos = accesoSchema.parse(req.body)
  const objetivo = await prisma.usuario.findUnique({
    where: { id: req.params.id },
    select: { rol: true },
  })

  if (!objetivo) {
    throw new HttpError(404, 'NO_ENCONTRADO', 'No existe ese usuario.')
  }
  // El maestro gestiona vendedores y administradores, pero no a otros maestros ni a sí mismo.
  if (req.authUser?.rol === 'MAESTRO' && objetivo.rol === 'MAESTRO') {
    throw new HttpError(403, 'ACCESO_DENEGADO', 'El maestro no puede modificar cuentas de maestro.')
  }

  const actualizado = await prisma.usuario.update({
    where: { id: req.params.id },
    data: datos,
    select: camposPublicos,
  })
  res.json(actualizado)
})

usuariosRouter.patch('/:id/password', async (req, res) => {
  const { password } = passwordSchema.parse(req.body)
  const objetivo = await prisma.usuario.findUnique({
    where: { id: req.params.id },
    select: { rol: true },
  })

  if (!objetivo) {
    throw new HttpError(404, 'NO_ENCONTRADO', 'No existe ese usuario.')
  }
  const actor = req.authUser
  const esPropio = actor?.id === req.params.id
  const permitido =
    actor &&
    canChangePassword(
      { id: actor.id, role: actor.rol },
      { id: req.params.id, role: objetivo.rol },
    )
  if (!permitido) {
    const mensaje = esPropio
      ? 'El maestro no puede cambiar su propia contraseña.'
      : objetivo.rol === 'MAESTRO'
        ? 'El maestro no puede cambiar la contraseña de otro maestro.'
        : 'No tienes permiso para cambiar contraseñas.'
    throw new HttpError(403, 'ACCESO_DENEGADO', mensaje)
  }

  await prisma.usuario.update({
    where: { id: req.params.id },
    data: {
      passwordHash: await hashContrasena(password, env.authPasswordPepper),
      intentosFallidos: 0,
      ultimoFalloEn: null,
      bloqueadoHasta: null,
    },
  })
  res.status(204).end()
})
