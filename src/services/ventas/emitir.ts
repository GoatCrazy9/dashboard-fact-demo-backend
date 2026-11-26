import { crearComprobante } from '../comprobantes/crear.ts'
import { prisma } from '../../lib/prisma.ts'

export interface DetalleVenta {
  tipoCotizacion?: string
  numeroGuia?: string
  ordenCompra?: string
  solicitadoPor?: string
  fechaEntrega?: string
  formaPago?: string
  fechaPago?: string
  condicionesPago?: string
  moneda?: 'PEN' | 'USD'
  tipoCambio?: number
}

export interface EntradaEmitirVenta {
  tipo: 'BOLETA' | 'FACTURA'
  cliente: {
    tipoDocumento: 'DNI' | 'RUC' | 'CE'
    numeroDocumento: string
    razonSocial: string
    direccion?: string | null
    email?: string | null
    telefono?: string | null
    distrito?: string | null
    provincia?: string | null
    departamento?: string | null
    ubigeo?: string | null
  }
  fecha: string
  observacion?: string
  detraccionCodigo?: string
  detalle?: DetalleVenta
  items: {
    codigo: string
    descripcion: string
    unidad: string
    precioUnitario: number
    igv: number
    cantidad: number
  }[]
}

const limpio = (valor: string | null | undefined) => {
  const texto = valor?.trim()
  return texto ? texto : null
}

/** Convierte el detalle validado en la observación que se guarda con el comprobante. */
function observacionDelDetalle(detalle?: DetalleVenta): string | undefined {
  if (!detalle) return undefined
  return (
    [
      detalle.tipoCotizacion && `Tipo: ${detalle.tipoCotizacion}`,
      detalle.numeroGuia && `Guía: ${detalle.numeroGuia}`,
      detalle.ordenCompra && `Orden de compra: ${detalle.ordenCompra}`,
      detalle.solicitadoPor && `Solicitado por: ${detalle.solicitadoPor}`,
      detalle.fechaEntrega && `Entrega: ${detalle.fechaEntrega}`,
      detalle.formaPago && `Forma de pago: ${detalle.formaPago}`,
      detalle.fechaPago && `Fecha de pago: ${detalle.fechaPago}`,
      detalle.condicionesPago && `Condiciones: ${detalle.condicionesPago}`,
      detalle.moneda === 'USD' && `Moneda: USD (tipo de cambio ${detalle.tipoCambio})`,
    ]
      .filter(Boolean)
      .join(' · ')
      .slice(0, 500) || undefined
  )
}

/**
 * Emite una boleta o factura desde el formulario de Ventas. El cliente y los productos se
 * reutilizan si ya existen (por documento y por código); si no, se dan de alta.
 * El correlativo, el cálculo en centavos y el envío al proveedor los hace
 * `crearComprobante`, igual que en el resto del sistema. El precio y el IGV de cada línea se
 * pasan como overrides y no alteran el catálogo; moneda y tipo de cambio se guardan aparte.
 */
export async function emitirVenta(entrada: EntradaEmitirVenta) {
  const numeroDocumento = entrada.cliente.numeroDocumento.trim()
  const ubigeo = limpio(entrada.cliente.ubigeo)
  let cliente = await prisma.cliente.findUnique({ where: { numeroDocumento } })

  if (!cliente) {
    cliente = await prisma.cliente.create({
      data: {
        tipoDocumento: entrada.cliente.tipoDocumento,
        numeroDocumento,
        razonSocial: entrada.cliente.razonSocial.trim(),
        direccion: limpio(entrada.cliente.direccion),
        email: limpio(entrada.cliente.email),
        telefono: limpio(entrada.cliente.telefono),
        ubigeo,
      },
    })
  } else if (ubigeo && !cliente.ubigeo) {
    // Solo completa el ubigeo ausente: no sobrescribe datos ya registrados.
    cliente = await prisma.cliente.update({
      where: { id: cliente.id },
      data: { ubigeo },
    })
  }

  const items: {
    productoId: string
    cantidad: number
    precioUnitario: number
    igvPorcentaje: number
  }[] = []
  for (const item of entrada.items) {
    const codigo = item.codigo.trim()
    let producto = await prisma.producto.findUnique({ where: { codigo } })

    if (!producto) {
      producto = await prisma.producto.create({
        data: {
          codigo,
          descripcion: item.descripcion.trim(),
          unidad: limpio(item.unidad) ?? 'NIU',
          precioUnitario: item.precioUnitario.toFixed(2),
          afectoIgv: item.igv > 0,
          stock: 0,
        },
      })
    }

    items.push({
      productoId: producto.id,
      cantidad: item.cantidad,
      precioUnitario: item.precioUnitario,
      igvPorcentaje: item.igv,
    })
  }

  return crearComprobante({
    tipo: entrada.tipo,
    clienteId: cliente.id,
    fecha: entrada.fecha,
    observacion: entrada.observacion ?? observacionDelDetalle(entrada.detalle),
    moneda: entrada.detalle?.moneda ?? 'PEN',
    tipoCambio: entrada.detalle?.tipoCambio ?? 1,
    detraccionCodigo: entrada.detraccionCodigo,
    items,
  })
}
