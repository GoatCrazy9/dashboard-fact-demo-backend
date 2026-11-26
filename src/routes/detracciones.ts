import { Router } from 'express'
import { prisma } from '../lib/prisma.ts'

export const detraccionesRouter = Router()

detraccionesRouter.get('/', async (_req, res) => {
  const filas = await prisma.detraccion.findMany({
    where: { activo: true },
    orderBy: { codigo: 'asc' },
  })
  res.json(
    filas.map((fila) => ({
      codigo: fila.codigo,
      nombre: fila.nombre,
      tasa: Number(fila.tasa),
    })),
  )
})
