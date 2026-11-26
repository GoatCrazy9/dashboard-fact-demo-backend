import { Prisma, type PrismaClient } from '@prisma/client'
import { prisma } from '../../lib/prisma.ts'

type ClienteSecuencia = Pick<PrismaClient, 'secuencia'>

/**
 * Correlativo atómico para series no tributarias (C001, P001, T001).
 * `upsert` crea la serie en 1 y, si ya existe, la incrementa en la misma
 * operación. Reintenta solo el conflicto de inserción simultánea.
 */
export async function reservarSecuencia(cliente: ClienteSecuencia, clave: string): Promise<number> {
  for (let intento = 0; intento < 3; intento += 1) {
    try {
      const fila = await cliente.secuencia.upsert({
        where: { clave },
        create: { clave, siguiente: 2 },
        update: { siguiente: { increment: 1 } },
      })
      return fila.siguiente - 1
    } catch (error) {
      const esConflicto =
        error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
      if (!esConflicto || intento === 2) throw error
    }
  }

  throw new Error('No se pudo reservar el correlativo.')
}

export async function reservarSecuenciaGlobal(clave: string): Promise<number> {
  return reservarSecuencia(prisma, clave)
}
