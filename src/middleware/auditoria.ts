import type { RequestHandler } from 'express'
import {
  construirDetalle,
  describirOperacion,
  direccionIp,
  registrarEventoSeguro,
  rutaSegura,
} from '../services/auditoria.ts'

const METODOS_REGISTRADOS = new Set(['POST', 'PATCH', 'PUT', 'DELETE'])

/**
 * Registra las operaciones que cambian datos, incluidas las rechazadas por permisos.
 * Se coloca después de `autenticar` y antes del bloqueo de facturación.
 */
export const registrarAuditoria: RequestHandler = (req, res, next) => {
  if (METODOS_REGISTRADOS.has(req.method.toUpperCase())) {
    const descripcion = describirOperacion(req.method, rutaSegura(req))
    let respuesta: unknown

    // Captura el JSON de salida sin alterarlo para poder mostrarlo en la bitácora.
    const jsonOriginal = res.json.bind(res)
    res.json = ((cuerpo: unknown) => {
      respuesta = cuerpo
      return jsonOriginal(cuerpo)
    }) as typeof res.json

    res.once('finish', () => {
      registrarEventoSeguro({
        usuarioId: req.authUser?.id ?? null,
        usuario: req.authUser?.usuario ?? 'anónimo',
        nombre: req.authUser?.nombre ?? null,
        ...descripcion,
        metodo: req.method.toUpperCase(),
        ruta: rutaSegura(req),
        estado: res.statusCode,
        direccionIp: direccionIp(req),
        detalle: construirDetalle({
          solicitud: req.body,
          consulta: req.query,
          respuesta,
        }),
      })
    })
  }

  next()
}
