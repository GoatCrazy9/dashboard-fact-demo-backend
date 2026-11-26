import { PdfDocumento, type Lienzo } from '../pdf/documento.ts'
import { matrizQr } from '../pdf/qr.ts'
import { textoQrComprobante } from './qr.ts'

export interface DatosEmpresaPdf {
  razonSocial: string
  direccion: string
  ruc: string
  telefono?: string | null
}

export interface DatosComprobantePdf {
  tipo: 'FACTURA' | 'BOLETA' | 'NOTA_CREDITO' | 'NOTA_DEBITO'
  serie: string
  numero: number
  fecha: string
  cliente: string
  clienteDocumento: string
  clienteDireccion: string | null
  subtotal: number
  igv: number
  total: number
  moneda: string
  detraccionCodigo: string
  detraccionTasa: number
  detraccionMonto: number
  items: { descripcion: string; cantidad: number; precioUnitario: number; total: number }[]
}

const UNIDADES = [
  '', 'UNO', 'DOS', 'TRES', 'CUATRO', 'CINCO', 'SEIS', 'SIETE', 'OCHO', 'NUEVE',
]
const DECENAS = [
  'DIEZ', 'ONCE', 'DOCE', 'TRECE', 'CATORCE', 'QUINCE', 'DIECISÉIS', 'DIECISIETE',
  'DIECIOCHO', 'DIECINUEVE',
]
const DECENAS_ALTAS = [
  '', '', 'VEINTE', 'TREINTA', 'CUARENTA', 'CINCUENTA', 'SESENTA', 'SETENTA', 'OCHENTA', 'NOVENTA',
]
const VEINTI = [
  '', 'VEINTIUNO', 'VEINTIDÓS', 'VEINTITRÉS', 'VEINTICUATRO', 'VEINTICINCO', 'VEINTISÉIS',
  'VEINTISIETE', 'VEINTIOCHO', 'VEINTINUEVE',
]
const CENTENAS = [
  '', 'CIEN', 'DOSCIENTOS', 'TRESCIENTOS', 'CUATROCIENTOS', 'QUINIENTOS', 'SEISCIENTOS',
  'SETECIENTOS', 'OCHOCIENTOS', 'NOVECIENTOS',
]

function menosMil(valor: number): string {
  if (valor === 0) return ''
  if (valor < 10) return UNIDADES[valor]
  if (valor < 20) return DECENAS[valor - 10]
  if (valor < 100) {
    const decena = Math.floor(valor / 10)
    const unidad = valor % 10
    return decena === 2 ? VEINTI[unidad] : `${DECENAS_ALTAS[decena]}${unidad ? ` ${UNIDADES[unidad]}` : ''}`
  }
  const centena = Math.floor(valor / 100)
  const resto = valor % 100
  const prefijo = centena === 1 && resto > 0 ? 'CIENTO' : CENTENAS[centena]
  return `${prefijo}${resto ? ` ${menosMil(resto)}` : ''}`
}

/** Versión local del `numeroALetras` del frontend, para el PDF descargable. */
export function totalEnLetras(valor: number, moneda: string): string {
  const entero = Math.floor(valor + Number.EPSILON)
  const centavos = Math.round((valor - entero) * 100)
  const partes: string[] = []
  const millones = Math.floor(entero / 1_000_000)
  const miles = Math.floor((entero % 1_000_000) / 1_000)
  const unidades = entero % 1_000
  if (millones) partes.push(millones === 1 ? 'UN MILLÓN' : `${menosMil(millones)} MILLONES`)
  if (miles) partes.push(miles === 1 ? 'MIL' : `${menosMil(miles)} MIL`)
  if (unidades) partes.push(menosMil(unidades))
  const texto = partes.join(' ') || 'CERO'
  return `SON: ${texto} CON ${String(centavos).padStart(2, '0')}/100 ${moneda === 'USD' ? 'DÓLARES' : 'SOLES'}`
}

const dinero = (valor: number) =>
  new Intl.NumberFormat('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(valor)

const fechaTicket = (iso: string) =>
  new Intl.DateTimeFormat('es-PE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'America/Lima',
  }).format(new Date(iso))

function centrarEnvuelto(lienzo: Lienzo, yInicial: number, texto: string, ancho: number, tamano: number, salto: number): number {
  let y = yInicial
  let restante = texto.trim()
  while (restante.length > 0) {
    let corte = restante.length
    while (corte > 1 && anchoTextoAprox(restante.slice(0, corte), tamano) > ancho) corte -= 1
    const espacio = restante.lastIndexOf(' ', corte)
    const longitud = espacio > 0 ? espacio : corte
    lienzo.texto(102.15, y, restante.slice(0, longitud), { tamano, alineacion: 'centro' })
    restante = restante.slice(longitud).trim()
    y -= salto
  }
  return y
}

const anchoTextoAprox = (texto: string, tamano: number) => texto.length * tamano * 0.5

/** Ticket POS 80 en PDF, con el mismo QR que genera SICAP. */
export function pdfComprobante(comprobante: DatosComprobantePdf, empresa: DatosEmpresaPdf): Buffer {
  const documento = new PdfDocumento()
  let lienzo = documento.nuevaPagina(204.3, 842.02502)
  const simbolo = comprobante.moneda === 'USD' ? 'US$' : 'S/'
  const titulo =
    comprobante.tipo === 'FACTURA'
      ? 'FACTURA ELECTRÓNICA'
      : comprobante.tipo === 'BOLETA'
        ? 'BOLETA DE VENTA ELECTRÓNICA'
        : comprobante.tipo === 'NOTA_CREDITO'
          ? 'NOTA DE CRÉDITO ELECTRÓNICA'
          : 'NOTA DE DÉBITO ELECTRÓNICA'

  let y = 831
  const centro = (texto: string, tamano = 8, negrita = false, salto = 11) => {
    lienzo.texto(102.15, y, texto, { tamano, negrita, alineacion: 'centro' })
    y -= salto
  }
  const separador = () => {
    y -= 2
    lienzo.linea(2.5, y, 201.8, y)
    y -= 10
  }

  centro(empresa.razonSocial.toUpperCase(), 13, true, 13)
  centro('De: Urquiza Cabrera Jose Humberto', 7, false, 9)
  centro('FABRICANTE DE MUEBLES DE DORMITORIO', 7, true, 11)
  y = centrarEnvuelto(lienzo, y, empresa.direccion, 196, 7, 9)
  if (empresa.telefono) centro(`Cel.: ${empresa.telefono}`, 7, false, 9)
  centro(`RUC: ${empresa.ruc}`, 11, true, 10)
  centro('Venta de Colchones, Juego de Dormitorio, Camarote', 7, false, 9)
  centro('Tarimas, Comodas y Veladores, Cabezeras Tapizadas', 7, false, 9)
  centro('Modelos Exclusivos', 7, false, 11)
  separador()

  centro(titulo, 10, true, 12)
  centro(`${comprobante.serie}-${String(comprobante.numero).padStart(8, '0')}`, 10, true, 12)
  centro(fechaTicket(comprobante.fecha), 8, false, 10)
  separador()

  lienzo.texto(3, y, `CLIENTE: ${comprobante.cliente}`, { tamano: 7 })
  y -= 10
  lienzo.texto(3, y, `${comprobante.clienteDocumento.length === 11 ? 'RUC' : 'RUC/DNI'}: ${comprobante.clienteDocumento}`, { tamano: 7 })
  y -= 10
  if (comprobante.clienteDireccion) {
    lienzo.texto(3, y, `DIRECCIÓN: ${comprobante.clienteDireccion.slice(0, 62)}`, { tamano: 7 })
    y -= 10
  }
  separador()

  lienzo.texto(3, y, 'CANT', { tamano: 7 })
  lienzo.texto(48, y, 'DESCRIPCION', { tamano: 7 })
  lienzo.texto(155, y, 'IMPORTE', { tamano: 7, alineacion: 'derecha' })
  y -= 12
  lienzo.linea(2.5, y + 4, 201.8, y + 4)
  y -= 4

  for (const item of comprobante.items) {
    if (y < 230) {
      lienzo = documento.nuevaPagina(204.3, 842.02502)
      y = 820
      lienzo.texto(102.15, y, `${titulo} (continuación)`, {
        tamano: 8,
        negrita: true,
        alineacion: 'centro',
      })
      y -= 18
    }
    lienzo.texto(3, y, String(item.cantidad), { tamano: 7 })
    lienzo.texto(48, y, item.descripcion.slice(0, 52), { tamano: 7 })
    lienzo.texto(155, y, dinero(item.total), { tamano: 7, alineacion: 'derecha' })
    y -= 10
    lienzo.texto(48, y, `P.UNIT ${dinero(item.precioUnitario)}`, { tamano: 6, color: '0.4 0.4 0.4' })
    y -= 11
  }
  separador()

  lienzo.texto(100, y, 'Op/Grav.', { tamano: 7, alineacion: 'derecha' })
  lienzo.texto(155, y, dinero(comprobante.subtotal), { tamano: 7, alineacion: 'derecha' })
  y -= 10
  lienzo.texto(100, y, 'I.G.V 18%', { tamano: 7, alineacion: 'derecha' })
  lienzo.texto(155, y, dinero(comprobante.igv), { tamano: 7, alineacion: 'derecha' })
  y -= 12
  lienzo.texto(85, y, 'Importe Total', { tamano: 8, negrita: true, alineacion: 'derecha' })
  lienzo.texto(155, y, `${simbolo} ${dinero(comprobante.total)}`, { tamano: 8, negrita: true, alineacion: 'derecha' })
  y -= 14
  if (comprobante.detraccionCodigo !== '000') {
    centro(
      `DETRACCIÓN ${comprobante.detraccionCodigo} (${comprobante.detraccionTasa}%): ${simbolo} ${dinero(comprobante.detraccionMonto)}`,
      7,
      false,
      12,
    )
  }

  centro(totalEnLetras(comprobante.total, comprobante.moneda), 7, false, 12)
  centro(`(${comprobante.moneda}) - Forma de Pago: CONTADO · Efectivo=${simbolo}${dinero(comprobante.total)} · Cambio=${simbolo}0.00`, 6, false, 14)
  separador()

  centro('TODO CAMBIO O DEVOLUCION DEL PRODUCTO DEBE SER DENTRO DE LOS 3 DIAS', 6, false, 8)
  centro('CALENDARIOS CON SU RESPECTIVO COMPROBANTE SIEMPRE Y CUANDO EL', 6, false, 8)
  centro('PRODUCTO NO HAYA SIDO UTILIZADO Y CON EMPAQUES ORIGINALES', 6, false, 8)
  centro('GRACIAS POR SU PREFERENCIA, VUELVA PRONTO', 7, true, 12)
  centro('Autorizado mediante SOL para la Emisión de Comprobantes', 6, false, 8)
  centro('Electrónicos desde los Sistemas del Contribuyente (SEE-DSC)', 6, false, 8)
  centro('Puede consultar éste comprobante en www.sunat.gob.pe', 6, false, 10)

  const qr = matrizQr(
    textoQrComprobante({
      razonSocial: empresa.razonSocial,
      direccion: empresa.direccion,
      ruc: empresa.ruc,
      numero: comprobante.numero,
    }),
  )
  const idImagen = documento.imagenDeMatriz(qr.size, qr.datos)
  lienzo.imagen(76.15, 112, 52, 52, idImagen)
  lienzo.linea(2.5, 103, 201.8, 103, '0.85 0.85 0.85')
  lienzo.texto(102.15, 90, 'Sistema SICAP · emisión local', { tamano: 6, alineacion: 'centro', color: '0.4 0.4 0.4' })
  lienzo.texto(102.15, 80, `Generado ${fechaTicket(comprobante.fecha)} · sin envío a SUNAT`, {
    tamano: 6,
    alineacion: 'centro',
    color: '0.4 0.4 0.4',
  })

  return documento.serializar()
}
