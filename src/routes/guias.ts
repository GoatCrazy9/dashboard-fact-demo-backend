import { Router } from 'express'
import { z } from 'zod'
import { fechaValida } from '../lib/fechas.ts'
import { consultarEstadoGuia, enviarYRegistrarGuia } from '../services/guias/envio.ts'
import {
  anularGuia,
  crearGuia,
  listarGuias,
  obtenerGuia,
} from '../services/guias/remision.ts'
import {
  conductorGuiaValido,
  datosTransportistaValidos,
  transportistaValido,
  ubigeoValido,
} from '../services/guias/validacion.ts'

const fecha = z.string().refine(fechaValida, 'Usa una fecha válida AAAA-MM-DD.')
const dosDecimales = (valor: number) =>
  Math.abs(valor * 1000 - Math.round(valor * 1000)) < 1e-6

export const crearGuiaSchema = z
  .object({
    fechaEmision: fecha,
    fechaTraslado: fecha,
    clienteId: z.string().min(1),
    motivo: z.enum(['VENTA', 'TRASLADO', 'DEVOLUCION', 'OTRO']),
    modalidad: z.enum(['PUBLICO', 'PRIVADO']),
    pesoKg: z.number().positive().max(1_000_000).refine(dosDecimales),
    direccionPartida: z.string().trim().min(5).max(300),
    direccionLlegada: z.string().trim().min(5).max(300),
    ubigeoPartida: z.string().trim().refine(ubigeoValido, 'El ubigeo tiene 6 dígitos.').nullish(),
    ubigeoLlegada: z.string().trim().refine(ubigeoValido, 'El ubigeo tiene 6 dígitos.').nullish(),
    placa: z.string().trim().max(20).nullish(),
    conductor: z.string().trim().max(100).nullish(),
    conductorDocumento: z.string().trim().max(20).nullish(),
    conductorLicencia: z.string().trim().max(20).nullish(),
    transportistaRuc: z.string().trim().max(11).nullish(),
    transportistaRazonSocial: z.string().trim().max(150).nullish(),
    transportistaRegistroMtc: z.string().trim().max(20).nullish(),
    notas: z.string().trim().max(500).nullish(),
    comprobanteId: z.string().min(1).nullish(),
    serie: z.string().trim().min(1).max(10).optional(),
    items: z
      .array(
        z.object({
          productoId: z.string().min(1),
          cantidad: z.number().positive().max(100_000).refine(dosDecimales),
        }),
      )
      .min(1, 'Agrega al menos un producto.')
      .max(100),
  })
  .superRefine((datos, ctx) => {
    if (datos.fechaTraslado < datos.fechaEmision) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['fechaTraslado'],
        message: 'La fecha de traslado no puede ser anterior a la emisión.',
      })
    }
    if (!transportistaValido(datos.modalidad, datos.placa, datos.conductor)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['placa'],
        message: 'El traslado público exige placa y conductor.',
      })
    }
    if (
      !conductorGuiaValido(
        datos.modalidad,
        datos.conductorDocumento,
        datos.conductorLicencia,
      )
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['conductorDocumento'],
        message: 'El traslado público exige documento y licencia del conductor.',
      })
    }
    if (
      !datosTransportistaValidos(
        datos.transportistaRuc,
        datos.transportistaRazonSocial,
        datos.transportistaRegistroMtc,
      )
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['transportistaRuc'],
        message: 'Si indicas transportista, falta su razón social o registro MTC.',
      })
    }
  })

export const anularGuiaSchema = z.object({
  motivo: z.string().trim().min(5, 'Indica el motivo de la anulación.').max(500),
})

export const guiasRouter = Router()

guiasRouter.get('/', async (_req, res) => {
  res.json(await listarGuias())
})

guiasRouter.get('/:id', async (req, res) => {
  res.json(await obtenerGuia(req.params.id))
})

guiasRouter.post('/', async (req, res) => {
  const datos = crearGuiaSchema.parse(req.body)
  res.status(201).json(await crearGuia(datos))
})

guiasRouter.post('/:id/anular', async (req, res) => {
  const { motivo } = anularGuiaSchema.parse(req.body)
  res.json(await anularGuia(req.params.id, motivo))
})

guiasRouter.post('/:id/reenviar', async (req, res) => {
  res.json(await enviarYRegistrarGuia(req.params.id, { reenvio: true }))
})

guiasRouter.post('/:id/actualizar-estado', async (req, res) => {
  res.json(await consultarEstadoGuia(req.params.id))
})
