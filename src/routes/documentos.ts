import { Router } from 'express'
import { z } from 'zod'
import { fechaValida } from '../lib/fechas.ts'
import {
  cambiarEstadoDocumento,
  convertirDocumentoVenta,
  crearDocumentoVenta,
  listarDocumentosVenta,
  obtenerDocumentoVenta,
} from '../services/documentos/venta.ts'

const fecha = z
  .string()
  .refine(fechaValida, 'Usa una fecha válida AAAA-MM-DD.')

const fechaOpcional = z
  .string()
  .refine((valor) => valor === '' || fechaValida(valor), 'Usa una fecha válida AAAA-MM-DD.')
  .nullish()

const dosDecimales = (valor: number) =>
  Math.abs(valor * 100 - Math.round(valor * 100)) < 1e-6

const itemSchema = z
  .object({
    productoId: z.string().min(1).optional(),
    descripcion: z.string().trim().min(1).max(300).optional(),
    cantidad: z
      .number()
      .positive()
      .max(100_000)
      .refine(dosDecimales, 'Máximo 2 decimales.'),
    precioUnitario: z
      .number()
      .min(0)
      .max(1_000_000_000)
      .refine(dosDecimales, 'Máximo 2 decimales.')
      .optional(),
    igvPorcentaje: z.number().min(0).max(100).optional(),
  })
  .refine((item) => Boolean(item.productoId || item.descripcion), {
    message: 'Indica un producto del catálogo o escribe el texto de la línea.',
  })

export const crearDocumentoSchema = z
  .object({
    tipo: z.enum(['COTIZACION', 'PEDIDO']),
    clienteId: z.string().min(1),
    fecha,
    fechaVencimiento: fechaOpcional,
    fechaEntrega: fechaOpcional,
    serie: z.string().trim().min(1).max(10).optional(),
    solicitadoPor: z.string().trim().max(100).nullish(),
    observacion: z.string().trim().max(500).nullish(),
    items: z.array(itemSchema).min(1, 'Agrega al menos un producto.').max(100),
  })
  .superRefine((datos, ctx) => {
    if (datos.fechaVencimiento && datos.fechaVencimiento < datos.fecha) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['fechaVencimiento'],
        message: 'La fecha de vencimiento no puede ser anterior a la emisión.',
      })
    }
    if (datos.fechaEntrega && datos.fechaEntrega < datos.fecha) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['fechaEntrega'],
        message: 'La fecha de entrega no puede ser anterior a la emisión.',
      })
    }
  })

export const cambiarEstadoSchema = z.object({
  estado: z.enum(['PENDIENTE', 'APROBADO', 'RECHAZADO']),
})

export const convertirDocumentoSchema = z.object({
  tipo: z.enum(['FACTURA', 'BOLETA']),
  fecha: fecha.optional(),
  observacion: z.string().trim().max(500).nullish(),
})

const filtroSchema = z.object({
  tipo: z.enum(['COTIZACION', 'PEDIDO']).optional(),
})

export const documentosRouter = Router()

documentosRouter.get('/', async (req, res) => {
  const { tipo } = filtroSchema.parse(req.query)
  res.json(await listarDocumentosVenta(tipo))
})

documentosRouter.get('/:id', async (req, res) => {
  res.json(await obtenerDocumentoVenta(req.params.id))
})

documentosRouter.post('/', async (req, res) => {
  const datos = crearDocumentoSchema.parse(req.body)
  res.status(201).json(await crearDocumentoVenta(datos))
})

documentosRouter.patch('/:id/estado', async (req, res) => {
  const { estado } = cambiarEstadoSchema.parse(req.body)
  res.json(await cambiarEstadoDocumento(req.params.id, estado))
})

documentosRouter.post('/:id/convertir', async (req, res) => {
  const datos = convertirDocumentoSchema.parse(req.body)
  res.json(await convertirDocumentoVenta(req.params.id, datos))
})
