import { Router } from 'express'
import { z } from 'zod'
import { emitirVenta, type DetalleVenta } from '../services/ventas/emitir.ts'

const PESOS_RUC = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2]
const DOS_DECIMALES = (valor: number) => Math.abs(valor * 100 - Math.round(valor * 100)) < 1e-6

function fechaValida(valor: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(valor)) return false
  const fecha = new Date(`${valor}T00:00:00Z`)
  return !Number.isNaN(fecha.getTime()) && fecha.toISOString().slice(0, 10) === valor
}

function documentoValido(tipo: string, numero: string): boolean {
  if (tipo === 'DNI') return /^\d{8}$/.test(numero)
  if (tipo === 'CE') return /^[A-Z0-9]{8,12}$/.test(numero)
  if (tipo === 'RUC') {
    if (!/^(10|15|16|17|20)\d{9}$/.test(numero)) return false
    const suma = PESOS_RUC.reduce((total, peso, i) => total + peso * Number(numero[i]), 0)
    return (11 - (suma % 11)) % 10 === Number(numero[10])
  }
  return false
}

const fechaOpcional = z
  .string()
  .refine((valor) => valor === '' || fechaValida(valor), 'Usa el formato AAAA-MM-DD.')

const detalleSchema = z.object({
  tipoCotizacion: z.enum(['COTIZACION', 'PEDIDO', 'VENTA']).optional(),
  numeroGuia: z.string().trim().max(20).optional(),
  ordenCompra: z.string().trim().max(40).optional(),
  solicitadoPor: z.string().trim().max(100).optional(),
  fechaEntrega: fechaOpcional.optional(),
  formaPago: z.enum(['EFECTIVO', 'TARJETA', 'TRANSFERENCIA', 'CHEQUE', 'CREDITO', 'OTRO']).optional(),
  fechaPago: fechaOpcional.optional(),
  condicionesPago: z.string().trim().max(100).optional(),
  moneda: z.enum(['PEN', 'USD']).optional(),
  tipoCambio: z.number().positive().max(1000).optional(),
}) satisfies z.ZodType<DetalleVenta>

export const emitirSchema = z
  .object({
    tipo: z.enum(['BOLETA', 'FACTURA']).default('BOLETA'),
    cliente: z.object({
      tipoDocumento: z.enum(['DNI', 'RUC', 'CE']),
      numeroDocumento: z.string().trim().min(6).max(20),
      razonSocial: z.string().trim().min(2).max(200),
      direccion: z.string().trim().max(300).nullish(),
      email: z
        .string()
        .trim()
        .max(120)
        .refine((valor) => !valor || /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(valor), 'Correo electrónico inválido.')
        .nullish(),
      telefono: z
        .string()
        .trim()
        .max(30)
        .refine(
          (valor) => !valor || (/^[+]?[\d\s()-]+$/.test(valor) && valor.replace(/\D/g, '').length >= 7),
          'Teléfono inválido (mínimo 7 dígitos).',
        )
        .nullish(),
      distrito: z.string().trim().max(100).nullish(),
      provincia: z.string().trim().max(100).nullish(),
      departamento: z.string().trim().max(100).nullish(),
      ubigeo: z
        .string()
        .trim()
        .refine((valor) => !valor || /^\d{6}$/.test(valor), 'El ubigeo tiene 6 dígitos.')
        .nullish(),
    }),
    fecha: z.string().refine(fechaValida, 'La fecha debe ser una fecha válida AAAA-MM-DD.'),
    observacion: z.string().trim().max(500).optional(),
    detraccionCodigo: z
      .string()
      .regex(/^\d{3}$/, 'El código de detracción tiene 3 dígitos.')
      .optional(),
    detalle: detalleSchema.optional(),
    items: z
      .array(
        z.object({
          codigo: z.string().trim().min(1).max(40),
          descripcion: z.string().trim().min(2).max(300),
          unidad: z.string().trim().min(1).max(10),
          precioUnitario: z
            .number()
            .positive()
            .max(1_000_000_000)
            .refine(DOS_DECIMALES, 'Máximo 2 decimales.'),
          igv: z.number().min(0).max(100),
          cantidad: z.number().positive().max(100_000).refine(DOS_DECIMALES, 'Máximo 2 decimales.'),
        }),
      )
      .min(1, 'Agrega al menos un producto.')
      .max(100, 'Máximo 100 ítems por comprobante.'),
  })
  .superRefine((datos, ctx) => {
    const { cliente, detalle, tipo } = datos

    if (tipo === 'FACTURA' && cliente.tipoDocumento !== 'RUC') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['cliente', 'tipoDocumento'],
        message: 'La factura exige un cliente con RUC.',
      })
    }
    if (!documentoValido(cliente.tipoDocumento, cliente.numeroDocumento)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['cliente', 'numeroDocumento'],
        message: 'El número de documento no es válido para el tipo elegido.',
      })
    }
    if (detalle?.fechaEntrega && detalle.fechaEntrega < datos.fecha) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['detalle', 'fechaEntrega'],
        message: 'La fecha de entrega no puede ser anterior a la emisión.',
      })
    }
    if (detalle?.formaPago === 'CREDITO' && !detalle.fechaPago) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['detalle', 'fechaPago'],
        message: 'La forma de pago crédito requiere una fecha de pago.',
      })
    }
    if (detalle?.moneda === 'USD' && detalle.tipoCambio === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['detalle', 'tipoCambio'],
        message: 'Indica el tipo de cambio cuando la moneda es USD.',
      })
    }
    if (detalle?.moneda === 'PEN' && detalle.tipoCambio !== undefined && detalle.tipoCambio !== 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['detalle', 'tipoCambio'],
        message: 'En soles el tipo de cambio debe ser 1.',
      })
    }
  })

export const ventasRouter = Router()

ventasRouter.post('/emitir', async (req, res) => {
  res.status(201).json(await emitirVenta(emitirSchema.parse(req.body)))
})
