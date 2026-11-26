import { Router } from 'express'
import {
  excelTabla,
  pdfTabla,
  tablaExportSchema,
} from '../services/exportaciones/tabla.ts'

export const exportacionesRouter = Router()

const fechaArchivo = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Lima',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())

exportacionesRouter.post('/', async (req, res) => {
  const datos = tablaExportSchema.parse(req.body)
  const esPdf = datos.formato === 'pdf'
  const archivo = esPdf ? pdfTabla(datos) : await excelTabla(datos)

  res.set(
    'Content-Type',
    esPdf
      ? 'application/pdf'
      : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  )
  res.set(
    'Content-Disposition',
    `attachment; filename="${datos.nombreArchivo}-${fechaArchivo()}.${esPdf ? 'pdf' : 'xlsx'}"`,
  )
  res.set('Cache-Control', 'no-store')
  res.send(archivo)
})
