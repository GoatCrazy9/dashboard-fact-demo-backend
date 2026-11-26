import { Router } from 'express'
import { Prisma } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '../lib/prisma.ts'
import { requerirRol } from '../middleware/requerirRol.ts'
import { fechaValida, limitesDia } from '../services/auditoria.ts'

const textoOpcional = (max: number) =>
  z.preprocess(
    (valor) => (typeof valor === 'string' && valor.trim() === '' ? undefined : valor),
    z.string().trim().min(1).max(max).optional(),
  )

const entero = (porDefecto: number, minimo: number, maximo: number) =>
  z.preprocess(
    (valor) => (valor === undefined || valor === '' ? porDefecto : valor),
    z.coerce.number().int().min(minimo).max(maximo),
  )

const filtrosSchema = z
  .object({
    usuario: textoOpcional(100),
    modulo: textoOpcional(80),
    accion: textoOpcional(40),
    resultado: z.preprocess(
      (valor) => (valor === '' ? undefined : valor),
      z.enum(['OK', 'ERROR']).optional(),
    ),
    desde: z.preprocess(
      (valor) => (valor === '' ? undefined : valor),
      z.string().refine(fechaValida, 'El filtro desde debe tener formato AAAA-MM-DD.').optional(),
    ),
    hasta: z.preprocess(
      (valor) => (valor === '' ? undefined : valor),
      z.string().refine(fechaValida, 'El filtro hasta debe tener formato AAAA-MM-DD.').optional(),
    ),
    limite: entero(20, 1, 100),
    offset: entero(0, 0, 1_000_000),
  })
  .refine((datos) => !datos.desde || !datos.hasta || datos.desde <= datos.hasta, {
    message: 'La fecha desde no puede ser posterior a hasta.',
  })

export const auditoriaRouter = Router()

auditoriaRouter.use(requerirRol('ADMIN', 'MAESTRO'))

auditoriaRouter.get('/', async (req, res) => {
  const filtros = filtrosSchema.parse(req.query)
  const where: Prisma.AuditoriaWhereInput = {}

  if (filtros.usuario) {
    where.usuario = { contains: filtros.usuario, mode: 'insensitive' }
  }
  if (filtros.modulo) where.modulo = filtros.modulo
  if (filtros.accion) where.accion = filtros.accion
  if (filtros.resultado === 'OK') where.estado = { gte: 200, lt: 400 }
  if (filtros.resultado === 'ERROR') where.estado = { gte: 400 }

  const rango: Prisma.DateTimeFilter = {}
  if (filtros.desde) Object.assign(rango, { gte: limitesDia(filtros.desde).inicio })
  if (filtros.hasta) Object.assign(rango, { lte: limitesDia(filtros.hasta).fin })
  if (Object.keys(rango).length > 0) where.creadoEn = rango

  const [registros, total] = await Promise.all([
    prisma.auditoria.findMany({
      where,
      orderBy: { creadoEn: 'desc' },
      skip: filtros.offset,
      take: filtros.limite,
    }),
    prisma.auditoria.count({ where }),
  ])

  res.json({
    data: registros.map(({ creadoEn, ...resto }) => ({
      ...resto,
      creadoEn: creadoEn.toISOString(),
    })),
    pagination: { total, limit: filtros.limite, offset: filtros.offset },
  })
})
