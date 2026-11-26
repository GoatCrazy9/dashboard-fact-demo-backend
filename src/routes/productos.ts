import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma.ts'
import { HttpError } from '../lib/http.ts'
import { requerirRol } from '../middleware/requerirRol.ts'
import { ajustarStock, listarMovimientos } from '../services/productos/inventario.ts'
import { aProducto } from '../services/productos/serializar.ts'

const productoSchema = z.object({
  codigo: z.string().min(1).max(40),
  descripcion: z.string().min(2).max(300),
  unidad: z.string().min(1).max(10).default('NIU'),
  precioUnitario: z.number().positive(),
  afectoIgv: z.boolean().default(true),
  stock: z.number().int().min(0).default(0),
})

const ajusteSchema = z.object({
  tipo: z.enum(['ENTRADA', 'SALIDA']),
  cantidad: z.number().int().positive(),
  motivo: z.string().trim().max(200).optional(),
})

export const productosRouter = Router()

productosRouter.get('/', async (_req, res) => {
  const filas = await prisma.producto.findMany({ orderBy: { descripcion: 'asc' }, take: 1000 })
  res.json(filas.map(aProducto))
})

productosRouter.get('/:id/movimientos', async (req, res) => {
  res.json(await listarMovimientos(String(req.params.id)))
})

productosRouter.post('/:id/ajustar', requerirRol('ADMIN'), async (req, res) => {
  const datos = ajusteSchema.parse(req.body)
  const resultado = await ajustarStock({
    productoId: String(req.params.id),
    tipo: datos.tipo,
    cantidad: datos.cantidad,
    motivo: datos.motivo,
    usuarioId: req.authUser!.id,
  })
  res.json(resultado)
})

productosRouter.post('/', async (req, res) => {
  const datos = productoSchema.parse(req.body)
  const existente = await prisma.producto.findUnique({ where: { codigo: datos.codigo } })
  if (existente) throw new HttpError(409, 'DUPLICADO', 'Ya existe un producto con ese código.')

  const creado = await prisma.$transaction(async (tx) => {
    const producto = await tx.producto.create({
      data: { ...datos, precioUnitario: datos.precioUnitario.toFixed(2) },
    })
    if (datos.stock > 0) {
      await tx.movimientoStock.create({
        data: {
          productoId: producto.id,
          tipo: 'ENTRADA',
          cantidad: datos.stock,
          motivo: 'Stock inicial',
          stockAnterior: 0,
          stockPosterior: datos.stock,
          usuarioId: req.authUser!.id,
        },
      })
    }
    return producto
  })
  res.status(201).json(aProducto(creado))
})
