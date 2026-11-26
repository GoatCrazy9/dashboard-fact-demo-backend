import type { TipoResumenSunat } from '@prisma/client'
import { prisma } from '../../lib/prisma.ts'
import { errores } from '../../lib/http.ts'
import { serializarResumen } from './serializar.ts'
import { reenviarResumen as reenviarResumenService } from './envio.ts'

const incluir = { items: true } as const

export async function listarResumenes(tipo?: TipoResumenSunat) {
  const filas = await prisma.resumenSunat.findMany({
    where: tipo ? { tipo } : undefined,
    include: incluir,
    orderBy: [{ fecha: 'desc' }, { creadoEn: 'desc' }],
    take: 300,
  })
  return filas.map(serializarResumen)
}

async function recargar(id: string) {
  const fila = await prisma.resumenSunat.findUnique({ where: { id }, include: incluir })
  if (!fila) throw errores.noEncontrado('El resumen no existe.')
  return serializarResumen(fila)
}

export async function obtenerResumen(id: string) {
  return recargar(id)
}

export async function reenviarResumen(id: string) {
  return reenviarResumenService(id)
}
