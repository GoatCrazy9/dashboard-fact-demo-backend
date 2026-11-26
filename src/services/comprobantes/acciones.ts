import type { EstadoComprobante } from '@prisma/client'
import { prisma } from '../../lib/prisma.ts'
import { errores } from '../../lib/http.ts'
import { nombreProveedorActual } from '../sunat/index.ts'
import { enviarYRegistrar } from './envio.ts'
import { aResumenComprobante } from './serializar.ts'

const ESTADOS_ANULABLES: EstadoComprobante[] = ['EMITIDO', 'ACEPTADO']

export const esEstadoAnulable = (estado: EstadoComprobante): boolean =>
  ESTADOS_ANULABLES.includes(estado)

export async function anularComprobante(id: string, motivo: string) {
  const comprobante = await prisma.comprobante.findUnique({
    where: { id },
    include: { cliente: true },
  })
  if (!comprobante) throw errores.noEncontrado('El comprobante no existe.')
  if (comprobante.estado === 'ANULADO') {
    throw errores.conflicto('El comprobante ya está anulado.')
  }
  if (!esEstadoAnulable(comprobante.estado)) {
    throw errores.conflicto('Solo se pueden anular comprobantes emitidos o aceptados.')
  }

  const esLocal = nombreProveedorActual() === 'local'
  const actualizado = await prisma.comprobante.update({
    where: { id },
    data: {
      estado: 'ANULADO',
      motivoAnulacion: motivo.trim(),
      anuladoEn: new Date(),
      ...(esLocal && {
        sunatCodigo: 'LOCAL-BAJA',
        sunatMensaje: 'Modo de prueba: baja registrada localmente, no se envió a SUNAT.',
      }),
    },
    include: { cliente: true },
  })
  return aResumenComprobante(actualizado)
}

/** Consulta el estado registrado del CPE. Con el proveedor local no hay llamada a SUNAT. */
export async function consultarCdr(id: string) {
  const comprobante = await prisma.comprobante.findUnique({ where: { id } })
  if (!comprobante) throw errores.noEncontrado('El comprobante no existe.')

  const proveedor = nombreProveedorActual()
  const esLocal = proveedor === 'local'
  return {
    comprobante: `${comprobante.serie}-${String(comprobante.numero).padStart(8, '0')}`,
    tipo: comprobante.tipo,
    estado: comprobante.estado,
    codigo: comprobante.sunatCodigo,
    mensaje: esLocal
      ? 'Modo local: no se consultó SUNAT; se muestra el estado registrado al emitir.'
      : comprobante.sunatMensaje,
    ticket: comprobante.sunatTicket ?? comprobante.sunatUuid,
    cdr: comprobante.sunatUuid,
    proveedor,
    esLocal,
    consultadoEn: new Date().toISOString(),
  }
}

export async function reenviarComprobante(id: string) {
  const comprobante = await prisma.comprobante.findUnique({ where: { id } })
  if (!comprobante) throw errores.noEncontrado('El comprobante no existe.')
  if (comprobante.estado === 'ANULADO') {
    throw errores.conflicto('No se puede reenviar un comprobante anulado.')
  }
  return enviarYRegistrar(id)
}
