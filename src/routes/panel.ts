import { Router } from 'express'
import { resumenPanel } from '../services/panel.ts'

export const panelRouter = Router()

panelRouter.get('/resumen', async (_req, res) => {
  res.json(await resumenPanel())
})
