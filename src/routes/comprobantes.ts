import { Router } from 'express'
import { z } from 'zod'
import { crearComprobante } from '../services/comprobantes/crear.ts'
import {
  anularComprobante,
  consultarCdr,
  reenviarComprobante,
} from '../services/comprobantes/acciones.ts'
import { listarComprobantes, obtenerComprobante } from '../services/comprobantes/listar.ts'
import { pdfComprobante } from '../services/comprobantes/pdf.ts'
import { textoQrComprobante } from '../services/comprobantes/qr.ts'
import { dataUrlQr } from '../services/pdf/qr.ts'
import { descargarArchivoCpe } from '../services/almacenamiento/cpe.ts'
import { prisma } from '../lib/prisma.ts'
import { HttpError } from '../lib/http.ts'

export const crearComprobanteSchema = z
  .object({
    tipo: z.enum(['FACTURA', 'BOLETA', 'NOTA_CREDITO', 'NOTA_DEBITO']),
    clienteId: z.string().min(1),
    fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'La fecha debe tener formato AAAA-MM-DD.'),
    serie: z.string().trim().min(1).max(10).optional(),
    observacion: z.string().trim().max(500).optional(),
    comprobanteAfectadoId: z.string().min(1).optional(),
    motivoNota: z.string().trim().max(500).optional(),
    detraccionCodigo: z
      .string()
      .regex(/^\d{3}$/, 'El código de detracción tiene 3 dígitos.')
      .optional(),
    items: z
      .array(
        z.object({
          productoId: z.string().min(1),
          cantidad: z.number().positive().max(100_000),
        }),
      )
      .min(1, 'Agrega al menos un producto.'),
  })
  .superRefine((datos, ctx) => {
    const esNota = datos.tipo === 'NOTA_CREDITO' || datos.tipo === 'NOTA_DEBITO'
    if (!esNota) return

    if (!datos.comprobanteAfectadoId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['comprobanteAfectadoId'],
        message: 'La nota necesita un comprobante afectado.',
      })
    }
    if (!datos.motivoNota || datos.motivoNota.trim().length < 5) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['motivoNota'],
        message: 'Indica el motivo de la nota (al menos 5 caracteres).',
      })
    }
  })

export const anularComprobanteSchema = z.object({
  motivo: z.string().trim().min(5, 'Indica el motivo de la anulación.').max(500),
})

export const comprobantesRouter = Router()

/** Datos de empresa usados tanto en el PDF como en el QR; SICAP no guarda teléfono en la API. */
const EMPRESA_SICAP = {
  razonSocial: 'MUEBLERIA JOSE',
  direccion:
    'Av. Angamos Este Nro. 1551 Block 2, 1 Piso Tda 79 C.C. Plaza Hogar - Lima - Lima - Surquillo',
  ruc: '10101222221',
}

async function contextoComprobante(id: string) {
  const comprobante = await obtenerComprobante(id)
  if (!comprobante) throw new HttpError(404, 'NO_ENCONTRADO', 'El comprobante no existe.')
  const empresa = await prisma.empresa.findFirst()
  return {
    comprobante,
    empresa: {
      razonSocial: empresa?.razonSocial || EMPRESA_SICAP.razonSocial,
      direccion: empresa?.direccion || EMPRESA_SICAP.direccion,
      ruc: empresa?.ruc || EMPRESA_SICAP.ruc,
      telefono: empresa?.telefono ?? null,
    },
  }
}

comprobantesRouter.get('/', async (_req, res) => {
  res.json(await listarComprobantes())
})

/** XML firmado, ZIP enviado y CDR archivados en Object Storage. */
comprobantesRouter.get('/:id/archivo/:tipo', async (req, res) => {
  const tipo = z.enum(['xml', 'zip', 'cdr']).parse(req.params.tipo)
  const comprobante = await prisma.comprobante.findUnique({ where: { id: req.params.id } })
  if (!comprobante) throw new HttpError(404, 'NO_ENCONTRADO', 'El comprobante no existe.')

  const claves = {
    xml: comprobante.archivoXmlKey,
    zip: comprobante.archivoZipKey,
    cdr: comprobante.archivoCdrKey,
  }
  const clave = claves[tipo]
  if (!clave) {
    throw new HttpError(404, 'NO_ENCONTRADO', `El comprobante no tiene un archivo ${tipo} archivado.`)
  }

  const archivo = await descargarArchivoCpe(clave)
  const numero = `${comprobante.serie}-${String(comprobante.numero).padStart(8, '0')}`
  const nombre = `${numero}${tipo === 'cdr' ? '-cdr' : ''}.${tipo === 'zip' ? 'zip' : 'xml'}`
  res.set('Content-Type', tipo === 'zip' ? 'application/zip' : 'application/xml')
  res.set('Content-Disposition', `attachment; filename="${nombre}"`)
  res.set('Cache-Control', 'private, no-store')
  res.send(archivo)
})

comprobantesRouter.get('/:id/cdr', async (req, res) => {
  res.json(await consultarCdr(req.params.id))
})

/** QR con el texto decodificado de los PDF reales de SICAP. No es un código SUNAT. */
comprobantesRouter.get('/:id/qr', async (req, res) => {
  const { comprobante, empresa } = await contextoComprobante(req.params.id)
  const texto = textoQrComprobante({
    razonSocial: empresa.razonSocial,
    direccion: empresa.direccion,
    ruc: empresa.ruc,
    numero: comprobante.numero,
  })
  res.json({ dataUrl: await dataUrlQr(texto) })
})

comprobantesRouter.get('/:id/pdf', async (req, res) => {
  const { comprobante, empresa } = await contextoComprobante(req.params.id)
  if (comprobante.tipo === 'GUIA_REMISION') {
    throw new HttpError(400, 'DATOS_INVALIDOS', 'La guía de remisión usa un documento A4, no un ticket POS.')
  }
  const archivo = pdfComprobante(
    {
      tipo: comprobante.tipo,
      serie: comprobante.serie,
      numero: comprobante.numero,
      fecha: comprobante.fecha,
      cliente: comprobante.cliente,
      clienteDocumento: comprobante.clienteDocumento,
      clienteDireccion: comprobante.clienteDireccion,
      subtotal: comprobante.subtotal,
      igv: comprobante.igv,
      total: comprobante.total,
      moneda: comprobante.moneda,
      detraccionCodigo: comprobante.detraccionCodigo,
      detraccionTasa: comprobante.detraccionTasa,
      detraccionMonto: comprobante.detraccionMonto,
      items: comprobante.items.map((item) => ({
        descripcion: item.descripcion,
        cantidad: item.cantidad,
        precioUnitario: item.precioUnitario,
        total: item.total,
      })),
    },
    empresa,
  )

  res.set('Content-Type', 'application/pdf')
  res.set(
    'Content-Disposition',
    `attachment; filename="${comprobante.serie}-${String(comprobante.numero).padStart(8, '0')}.pdf"`,
  )
  res.set('Cache-Control', 'no-store')
  res.send(archivo)
})

comprobantesRouter.post('/:id/anular', async (req, res) => {
  const { motivo } = anularComprobanteSchema.parse(req.body)
  res.json(await anularComprobante(req.params.id, motivo))
})

comprobantesRouter.post('/:id/reenviar', async (req, res) => {
  res.json(await reenviarComprobante(req.params.id))
})

comprobantesRouter.get('/:id', async (req, res) => {
  const comprobante = await obtenerComprobante(req.params.id)
  if (!comprobante) throw new HttpError(404, 'NO_ENCONTRADO', 'El comprobante no existe.')
  res.json(comprobante)
})

comprobantesRouter.post('/', async (req, res) => {
  const datos = crearComprobanteSchema.parse(req.body)
  res.status(201).json(await crearComprobante(datos))
})
