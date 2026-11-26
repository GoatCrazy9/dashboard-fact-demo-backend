import { Router } from 'express'
import { consultarDocumento } from '../services/reniec.ts'

export const reniecRouter = Router()

reniecRouter.get('/dni/:numero', async (req, res, next) => {
  try {
    res.json(await consultarDocumento('dni', req.params.numero))
  } catch (error) {
    next(error)
  }
})

reniecRouter.get('/cee/:numero', async (req, res, next) => {
  try {
    res.json(await consultarDocumento('cee', req.params.numero))
  } catch (error) {
    next(error)
  }
})

reniecRouter.get('/ruc/:numero', async (req, res, next) => {
  try {
    res.json(await consultarDocumento('ruc', req.params.numero))
  } catch (error) {
    next(error)
  }
})
