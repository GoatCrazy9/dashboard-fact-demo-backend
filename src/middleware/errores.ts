import type { ErrorRequestHandler, RequestHandler } from 'express'
import { ZodError } from 'zod'
import { Prisma } from '@prisma/client'
import { HttpError } from '../lib/http.ts'

export const noEncontrado: RequestHandler = (req, res) => {
  res.status(404).json({
    error: { code: 'RUTA_NO_ENCONTRADA', message: `No existe la ruta ${req.method} ${req.originalUrl}.` },
  })
}

export const manejadorErrores: ErrorRequestHandler = (error, _req, res, _next) => {
  if (error instanceof HttpError) {
    res.status(error.status).json({ error: { code: error.code, message: error.message } })
    return
  }

  if (error instanceof ZodError) {
    const detalle = error.issues
      .map((issue) => `${issue.path.join('.') || 'cuerpo'}: ${issue.message}`)
      .join('; ')
    res.status(400).json({ error: { code: 'DATOS_INVALIDOS', message: detalle } })
    return
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002') {
      res.status(409).json({
        error: { code: 'DUPLICADO', message: 'Ya existe un registro con esos datos únicos.' },
      })
      return
    }
    if (error.code === 'P2025') {
      res.status(404).json({ error: { code: 'NO_ENCONTRADO', message: 'El registro no existe.' } })
      return
    }
  }

  console.error('[api] error no controlado:', error)
  res.status(500).json({
    error: { code: 'ERROR_INTERNO', message: 'Ocurrió un error inesperado en el servidor.' },
  })
}
