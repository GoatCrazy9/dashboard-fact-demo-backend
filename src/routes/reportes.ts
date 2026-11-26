import { Router } from 'express'
import { z } from 'zod'
import { aHojasExcel, reporteVentas } from '../services/reportes/ventas.ts'
import { pdfReporteVentas } from '../services/reportes/pdf.ts'
import { generarXlsx } from '../services/reportes/xlsx.ts'
import { prisma } from '../lib/prisma.ts'

const fechaValida = (valor: string) => {
  const fecha = new Date(`${valor}T00:00:00.000Z`)
  return !Number.isNaN(fecha.getTime()) && fecha.toISOString().slice(0, 10) === valor
}

const fecha = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Usa el formato AAAA-MM-DD.')
  .refine(fechaValida, 'La fecha no existe.')

export const rangoVentasSchema = z
  .object({ desde: fecha, hasta: fecha })
  .refine(({ desde, hasta }) => desde <= hasta, {
    message: 'La fecha inicial no puede ser mayor que la final.',
    path: ['desde'],
  })

export const reportesRouter = Router()

reportesRouter.get('/ventas/pdf', async (req, res) => {
  const filtros = rangoVentasSchema.parse(req.query)
  const [reporte, empresa] = await Promise.all([
    reporteVentas(filtros),
    prisma.empresa.findFirst(),
  ])
  const archivo = pdfReporteVentas(reporte, empresa)

  res.set('Content-Type', 'application/pdf')
  res.set(
    'Content-Disposition',
    `attachment; filename="reporte-ventas-${filtros.desde}-${filtros.hasta}.pdf"`,
  )
  res.set('Cache-Control', 'no-store')
  res.send(archivo)
})

reportesRouter.get('/ventas/excel', async (req, res) => {
  const filtros = rangoVentasSchema.parse(req.query)
  const reporte = await reporteVentas(filtros)
  const archivo = await generarXlsx(aHojasExcel(reporte))

  res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  res.set(
    'Content-Disposition',
    `attachment; filename="reporte-ventas-${filtros.desde}-${filtros.hasta}.xlsx"`,
  )
  res.set('Cache-Control', 'no-store')
  res.send(archivo)
})

reportesRouter.get('/ventas', async (req, res) => {
  const filtros = rangoVentasSchema.parse(req.query)
  res.json(await reporteVentas(filtros))
})
