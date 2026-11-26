import { prisma } from '../../lib/prisma.ts'
import { errores } from '../../lib/http.ts'
import { proveedorActual } from '../sunat/index.ts'
import type { CpeAEnviar } from '../sunat/types.ts'
import { archivarCpe } from '../almacenamiento/cpe.ts'
import { registrarSalidaPorVenta } from '../productos/inventario.ts'
import { aResumenComprobante } from './serializar.ts'

/**
 * Envía un comprobante ya guardado y registra lo que devuelve el proveedor.
 * Lo usan la emisión inicial y el reenvío para que el estado SUNAT tenga un solo dueño.
 */
export async function enviarYRegistrar(id: string) {
  const [comprobante, empresa] = await Promise.all([
    prisma.comprobante.findUnique({ where: { id }, include: { cliente: true, items: true } }),
    prisma.empresa.findFirst(),
  ])

  if (!comprobante) throw errores.noEncontrado('El comprobante no existe.')
  if (!empresa) {
    throw errores.invalido('Falta registrar los datos de la empresa emisora (ejecuta el seed).')
  }

  const idsProducto = [...new Set(comprobante.items.map((item) => item.productoId).filter(Boolean))] as string[]
  const productos = await prisma.producto.findMany({ where: { id: { in: idsProducto } } })
  const unidades = new Map(productos.map((producto) => [producto.id, producto.unidad]))

  const observacion = [
    comprobante.motivoNota && `Motivo: ${comprobante.motivoNota}`,
    comprobante.documentoAfectado && `Doc. afectado: ${comprobante.documentoAfectado}`,
    comprobante.observacion,
  ]
    .filter(Boolean)
    .join(' · ')

  const cpe: CpeAEnviar = {
    id: comprobante.id,
    tipo: comprobante.tipo,
    serie: comprobante.serie,
    numero: comprobante.numero,
    fecha: comprobante.fecha,
    moneda: comprobante.moneda,
    emisor: {
      ruc: empresa.ruc,
      razonSocial: empresa.razonSocial,
      direccion: empresa.direccion,
      ubigeo: empresa.ubigeo,
    },
    receptor: {
      tipoDocumento: comprobante.cliente.tipoDocumento,
      numeroDocumento: comprobante.cliente.numeroDocumento,
      razonSocial: comprobante.cliente.razonSocial,
      direccion: comprobante.cliente.direccion,
    },
    lineas: comprobante.items.map((item) => ({
      descripcion: item.descripcion,
      cantidad: Number(item.cantidad),
      unidad: (item.productoId && unidades.get(item.productoId)) || 'NIU',
      valorUnitario: Number(item.valorUnitario),
      precioUnitario: Number(item.precioUnitario),
      igv: Number(item.igv),
      total: Number(item.total),
      afectoIgv: item.afectoIgv,
    })),
    subtotal: Number(comprobante.subtotal),
    igv: Number(comprobante.igv),
    total: Number(comprobante.total),
    observacion: observacion || null,
    detalleDetraccion:
      comprobante.detraccionCodigo === '000'
        ? undefined
        : {
            codigo: comprobante.detraccionCodigo,
            tasa: Number(comprobante.detraccionTasa),
            monto: Number(comprobante.detraccionMonto),
          },
  }
  const resultado = await proveedorActual().enviar(cpe)

  let claves: Awaited<ReturnType<typeof archivarCpe>> = null
  if (resultado.archivos) {
    try {
      claves = await archivarCpe(cpe, resultado.archivos)
    } catch (error) {
      // El archivado es complementario: SUNAT ya aceptó o rechazó el comprobante.
      console.error('[archivo-cpe] No se pudo archivar el paquete:', error)
    }
  }

  const actualizado = await prisma.comprobante.update({
    where: { id },
    data: {
      estado: resultado.estado,
      sunatCodigo: resultado.codigo,
      sunatMensaje: resultado.mensaje,
      sunatUuid: resultado.uuid,
      sunatTicket: resultado.uuid,
      ...(claves && {
        archivoXmlKey: claves.xmlKey,
        archivoZipKey: claves.zipKey,
        archivoCdrKey: claves.cdrKey,
      }),
    },
    include: { cliente: true },
  })

  const resumen = aResumenComprobante(actualizado)

  if (
    actualizado.estado !== 'RECHAZADO' &&
    (actualizado.tipo === 'FACTURA' || actualizado.tipo === 'BOLETA')
  ) {
    const referencia = `${actualizado.serie}-${String(actualizado.numero).padStart(8, '0')}`
    try {
      await registrarSalidaPorVenta(id, referencia, comprobante.items)
    } catch (error) {
      // El comprobante ya fue aceptado: un fallo del inventario no debe borrarlo.
      console.error('[inventario] No se pudo descontar el stock de la venta:', error)
    }
  }

  return resumen
}
