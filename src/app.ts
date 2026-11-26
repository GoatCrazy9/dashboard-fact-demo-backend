import express from 'express'
import cors from 'cors'
import { auditoriaRouter } from './routes/auditoria.ts'
import { autenticacionRouter } from './routes/autenticacion.ts'
import { clientesRouter } from './routes/clientes.ts'
import { comprobantesRouter } from './routes/comprobantes.ts'
import { configuracionRouter } from './routes/configuracion.ts'
import { detraccionesRouter } from './routes/detracciones.ts'
import { documentosRouter } from './routes/documentos.ts'
import { exportacionesRouter } from './routes/exportaciones.ts'
import { guiasRouter } from './routes/guias.ts'
import { panelRouter } from './routes/panel.ts'
import { productosRouter } from './routes/productos.ts'
import { reniecRouter } from './routes/reniec.ts'
import { reportesRouter } from './routes/reportes.ts'
import { resumenesRouter } from './routes/resumenes.ts'
import { usuariosRouter } from './routes/usuarios.ts'
import { ventasRouter } from './routes/ventas.ts'
import { accesoFacturacion } from './middleware/accesoFacturacion.ts'
import { registrarAuditoria } from './middleware/auditoria.ts'
import { autenticar } from './middleware/autenticar.ts'
import { manejadorErrores, noEncontrado } from './middleware/errores.ts'

export function crearApp() {
  const app = express()

  app.use(cors())
  app.use(express.json({ limit: '1mb' }))

  app.get('/api/salud', (_req, res) => {
    res.json({ ok: true, servicio: 'facturacion-muebleria-jose' })
  })

  // Login público y verificación de sesión antes del middleware global.
  app.use('/api/autenticacion', autenticacionRouter)

  // Toda API nueva queda protegida por defecto; /api/salud ya respondió arriba.
  app.use('/api', autenticar)

  // Bitácora de mutaciones, antes del bloqueo de facturación para capturar también los 403.
  app.use('/api', registrarAuditoria)

  // Auditoría es solo lectura para admin y maestro; usuarios es exclusivo del maestro.
  app.use('/api/auditoria', auditoriaRouter)
  app.use('/api/usuarios', usuariosRouter)

  // El resto de la API exige acceso explícito al sistema de facturación.
  app.use('/api', accesoFacturacion)

  app.use('/api/panel', panelRouter)
  app.use('/api/comprobantes', comprobantesRouter)
  app.use('/api/documentos', documentosRouter)
  app.use('/api/exportaciones', exportacionesRouter)
  app.use('/api/guias', guiasRouter)
  app.use('/api/clientes', clientesRouter)
  app.use('/api/productos', productosRouter)
  app.use('/api/configuracion', configuracionRouter)
  app.use('/api/detracciones', detraccionesRouter)
  app.use('/api/reniec', reniecRouter)
  app.use('/api/reportes', reportesRouter)
  app.use('/api/resumenes', resumenesRouter)
  app.use('/api/ventas', ventasRouter)

  app.use(noEncontrado)
  app.use(manejadorErrores)

  return app
}
