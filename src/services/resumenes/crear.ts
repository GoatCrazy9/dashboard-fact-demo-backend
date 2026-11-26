import type { TipoResumenSunat } from '@prisma/client'
import { prisma } from '../../lib/prisma.ts'
import { errores } from '../../lib/http.ts'
import { aFecha, fechaValida } from '../../lib/fechas.ts'
import { reservarSecuencia } from '../documentos/secuencia.ts'
import { CLAVE_POR_TIPO, esBajable, esResumible, SERIE_POR_TIPO } from './validacion.ts'
import { enviarResumen } from './envio.ts'

export interface EntradaResumenDiario {
  fecha: string
  observacion?: string | null
}

export interface EntradaComunicacionBaja {
  fecha: string
  comprobanteIds: string[]
  observacion?: string | null
}

function finDelDia(fecha: string): Date {
  return new Date(aFecha(fecha).getTime() + 86_400_000)
}

async function crearResumen(
  tipo: TipoResumenSunat,
  fecha: string,
  observacion: string | null,
  datos: {
    comprobantes: {
      id: string
      tipo: 'FACTURA' | 'BOLETA' | 'NOTA_CREDITO' | 'NOTA_DEBITO' | 'GUIA_REMISION'
      serie: string
      numero: number
      fecha: Date
      subtotal: { toFixed: (decimales: number) => string }
      igv: { toFixed: (decimales: number) => string }
      total: { toFixed: (decimales: number) => string }
      cliente: { numeroDocumento: string }
      motivoAnulacion: string | null
    }[]
  },
) {
  return prisma.$transaction(async (tx) => {
    const numero = await reservarSecuencia(tx, CLAVE_POR_TIPO[tipo])
    return tx.resumenSunat.create({
      data: {
        tipo,
        serie: SERIE_POR_TIPO[tipo],
        numero,
        fecha: aFecha(fecha),
        estado: 'GENERADO',
        observacion,
        items: {
          create: datos.comprobantes.map((comprobante) => ({
            comprobanteId: comprobante.id,
            tipoDocumento: comprobante.tipo,
            serie: comprobante.serie,
            numero: comprobante.numero,
            clienteDocumento: comprobante.cliente.numeroDocumento,
            fechaEmision: comprobante.fecha,
            subtotal: comprobante.subtotal.toFixed(2),
            igv: comprobante.igv.toFixed(2),
            total: comprobante.total.toFixed(2),
            motivoBaja:
              tipo === 'COMUNICACION_BAJA' ? comprobante.motivoAnulacion : null,
          })),
        },
      },
      include: { items: true },
    })
  })
}

export async function crearResumenDiario(entrada: EntradaResumenDiario) {
  if (!fechaValida(entrada.fecha)) {
    throw errores.invalido('La fecha del resumen no es válida.')
  }

  const candidatos = await prisma.comprobante.findMany({
    where: {
      fecha: { gte: aFecha(entrada.fecha), lt: finDelDia(entrada.fecha) },
      estado: { in: ['EMITIDO', 'ACEPTADO'] },
    },
    include: { cliente: true },
    orderBy: [{ serie: 'asc' }, { numero: 'asc' }],
  })

  const yaResumidos = new Set(
    (
      await prisma.resumenSunatItem.findMany({
        where: { resumen: { tipo: 'RESUMEN_DIARIO' } },
        select: { comprobanteId: true },
      })
    ).map((fila) => fila.comprobanteId),
  )

  const seleccionados = candidatos.filter(
    (comprobante) =>
      esResumible(comprobante.tipo, comprobante.estado, comprobante.documentoAfectado) &&
      !yaResumidos.has(comprobante.id),
  )
  if (seleccionados.length === 0) {
    throw errores.conflicto(
      'No hay boletas ni notas sobre boletas pendientes de resumir en esa fecha.',
    )
  }

  const creado = await crearResumen('RESUMEN_DIARIO', entrada.fecha, entrada.observacion?.trim() || null, {
    comprobantes: seleccionados,
  })
  return enviarResumen(creado.id)
}

export async function crearComunicacionBaja(entrada: EntradaComunicacionBaja) {
  if (!fechaValida(entrada.fecha)) {
    throw errores.invalido('La fecha de la comunicación no es válida.')
  }

  const ids = [...new Set(entrada.comprobanteIds)]
  const comprobantes = await prisma.comprobante.findMany({
    where: { id: { in: ids } },
    include: { cliente: true },
  })
  if (comprobantes.length !== ids.length) {
    throw errores.invalido('Uno de los comprobantes indicados no existe.')
  }
  for (const comprobante of comprobantes) {
    if (!esBajable(comprobante.estado)) {
      throw errores.conflicto(
        `El comprobante ${comprobante.serie}-${comprobante.numero} no está anulado.`,
      )
    }
    if (
      comprobante.anuladoEn &&
      comprobante.anuladoEn.toISOString().slice(0, 10) > entrada.fecha
    ) {
      throw errores.invalido(
        `El comprobante ${comprobante.serie}-${comprobante.numero} se anuló después de la fecha indicada.`,
      )
    }
  }

  const yaComunicados = new Set(
    (
      await prisma.resumenSunatItem.findMany({
        where: {
          resumen: { tipo: 'COMUNICACION_BAJA' },
          comprobanteId: { in: ids },
        },
        select: { comprobanteId: true },
      })
    ).map((fila) => fila.comprobanteId),
  )
  const pendientes = comprobantes.filter((comprobante) => !yaComunicados.has(comprobante.id))
  if (pendientes.length === 0) {
    throw errores.conflicto('Los comprobantes ya tienen una comunicación de baja registrada.')
  }

  const creado = await crearResumen(
    'COMUNICACION_BAJA',
    entrada.fecha,
    entrada.observacion?.trim() || null,
    { comprobantes: pendientes },
  )
  return enviarResumen(creado.id)
}
