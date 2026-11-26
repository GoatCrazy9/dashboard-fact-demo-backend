import { Router } from 'express'
import { obtenerConfiguracion } from '../services/configuracion.ts'

export const configuracionRouter = Router()

configuracionRouter.get('/', async (_req, res) => {
  res.json(await obtenerConfiguracion())
})
