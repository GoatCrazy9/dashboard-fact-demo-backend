import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma.ts'
import { HttpError } from '../lib/http.ts'

const clienteSchema = z.object({
  tipoDocumento: z.enum(['DNI', 'RUC', 'CE']),
  numeroDocumento: z.string().min(6).max(20),
  razonSocial: z.string().min(2).max(200),
  direccion: z.string().max(300).nullish(),
  email: z.string().email().nullish(),
  telefono: z.string().max(30).nullish(),
  ubigeo: z
    .string()
    .refine((valor) => !valor || /^\d{6}$/.test(valor), 'El ubigeo tiene 6 dígitos.')
    .nullish(),
})

const aCliente = (row: {
  id: string
  tipoDocumento: string
  numeroDocumento: string
  razonSocial: string
  direccion: string | null
  email: string | null
  telefono: string | null
  ubigeo: string | null
}) => ({
  id: row.id,
  tipoDocumento: row.tipoDocumento,
  numeroDocumento: row.numeroDocumento,
  razonSocial: row.razonSocial,
  direccion: row.direccion,
  email: row.email,
  telefono: row.telefono,
  ubigeo: row.ubigeo,
})

export const clientesRouter = Router()

clientesRouter.get('/', async (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : ''

  const filas = await prisma.cliente.findMany({
    where: q
      ? {
          OR: [
            { razonSocial: { contains: q, mode: 'insensitive' } },
            { numeroDocumento: { contains: q } },
          ],
        }
      : undefined,
    orderBy: { razonSocial: 'asc' },
    take: 500,
  })

  res.json(filas.map(aCliente))
})

clientesRouter.post('/', async (req, res) => {
  const datos = clienteSchema.parse(req.body)
  const existente = await prisma.cliente.findUnique({
    where: { numeroDocumento: datos.numeroDocumento },
  })
  if (existente) throw new HttpError(409, 'DUPLICADO', 'Ya existe un cliente con ese documento.')

  const creado = await prisma.cliente.create({ data: datos })
  res.status(201).json(aCliente(creado))
})
