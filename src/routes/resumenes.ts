import { Router } from 'express'
import { z } from 'zod'
import { env } from '../config/env.ts'
import { fechaValida } from '../lib/fechas.ts'
import { HttpError } from '../lib/http.ts'
import { prisma } from '../lib/prisma.ts'
import { descargarArchivoCpe } from '../services/almacenamiento/cpe.ts'
import {
  crearComunicacionBaja,
  crearResumenDiario,
} from '../services/resumenes/crear.ts'
import {
  listarResumenes,
  obtenerResumen,
  reenviarResumen,
} from '../services/resumenes/consultas.ts'
import {
  consultarTicketResumen,
  resumenesConEnvioReal,
} from '../services/resumenes/envio.ts'

const fecha = z.string().refine(fechaValida, 'Usa una fecha válida AAAA-MM-DD.')
const observacion = z.string().trim().max(500).nullish()

export const crearResumenDiarioSchema = z.object({
  fecha,
  observacion,
})

export const crearBajaSchema = z
  .object({
    fecha,
    comprobanteIds: z
      .array(z.string().min(1))
      .min(1, 'Selecciona al menos un comprobante.')
      .max(100),
    observacion,
  })
  .refine((datos) => new Set(datos.comprobanteIds).size === datos.comprobanteIds.length, {
    path: ['comprobanteIds'],
    message: 'No repitas comprobantes.',
  })

const filtroSchema = z.object({
  tipo: z.enum(['RESUMEN_DIARIO', 'COMUNICACION_BAJA']).optional(),
})

export const resumenesRouter = Router()

/** El frontend solo necesita saber si el servidor puede enviar RC/RA de verdad. */
resumenesRouter.get('/config', (_req, res) => {
  res.json({
    envioReal: resumenesConEnvioReal(),
    modo: resumenesConEnvioReal() ? env.sunatModo : 'local',
  })
})

resumenesRouter.get('/', async (req, res) => {
  const { tipo } = filtroSchema.parse(req.query)
  res.json(await listarResumenes(tipo))
})

resumenesRouter.post('/diario', async (req, res) => {
  const datos = crearResumenDiarioSchema.parse(req.body)
  res.status(201).json(await crearResumenDiario(datos))
})

resumenesRouter.post('/bajas', async (req, res) => {
  const datos = crearBajaSchema.parse(req.body)
  res.status(201).json(await crearComunicacionBaja(datos))
})

/** XML firmado, ZIP enviado y CDR archivados en Object Storage. */
resumenesRouter.get('/:id/archivo/:tipo', async (req, res) => {
  const tipo = z.enum(['xml', 'zip', 'cdr']).parse(req.params.tipo)
  const resumen = await prisma.resumenSunat.findUnique({ where: { id: req.params.id } })
  if (!resumen) throw new HttpError(404, 'NO_ENCONTRADO', 'El resumen no existe.')

  const claves = {
    xml: resumen.archivoXmlKey,
    zip: resumen.archivoZipKey,
    cdr: resumen.archivoCdrKey,
  }
  const clave = claves[tipo]
  if (!clave) {
    throw new HttpError(404, 'NO_ENCONTRADO', `El resumen no tiene un archivo ${tipo} archivado.`)
  }

  const archivo = await descargarArchivoCpe(clave)
  const nombre = `${resumen.serie}-${resumen.numero}${tipo === 'cdr' ? '-cdr' : ''}.${tipo === 'zip' ? 'zip' : 'xml'}`
  res.set('Content-Type', tipo === 'zip' ? 'application/zip' : 'application/xml')
  res.set('Content-Disposition', `attachment; filename="${nombre}"`)
  res.set('Cache-Control', 'private, no-store')
  res.send(archivo)
})

resumenesRouter.get('/:id', async (req, res) => {
  res.json(await obtenerResumen(req.params.id))
})

resumenesRouter.post('/:id/estado', async (req, res) => {
  res.json(await consultarTicketResumen(req.params.id))
})

resumenesRouter.post('/:id/reenviar', async (req, res) => {
  res.json(await reenviarResumen(req.params.id))
})
