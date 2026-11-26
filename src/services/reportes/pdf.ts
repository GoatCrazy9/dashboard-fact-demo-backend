import { anchoTexto, PdfDocumento, type Lienzo } from '../pdf/documento.ts'
import { ETIQUETAS_TIPO, type ReporteVentas } from './ventas.ts'

export interface DatosEmpresaReportePdf {
  razonSocial: string
  ruc: string
  direccion?: string | null
}

interface Columna<T> {
  titulo: string
  ancho: number
  valor: (fila: T) => string
  alineacion?: 'izquierda' | 'derecha'
}

const dinero = (valor: number) =>
  new Intl.NumberFormat('es-PE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(valor)

const fechaHora = (iso: string) => {
  const fecha = new Date(iso)
  if (Number.isNaN(fecha.getTime())) return iso
  return new Intl.DateTimeFormat('es-PE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Lima',
  }).format(fecha)
}

/** Recorta con la misma métrica aproximada que usa el lienzo para alinear. */
function recortar(valor: string, anchoDisponible: number, tamano = 8): string {
  let resultado = ''
  for (const caracter of valor) {
    if (anchoTexto(resultado + caracter, tamano) > anchoDisponible) break
    resultado += caracter
  }
  return resultado
}

/** Reporte de ventas A4 apaisado con las mismas cinco secciones que la pantalla y el Excel. */
export function pdfReporteVentas(
  reporte: ReporteVentas,
  empresa?: DatosEmpresaReportePdf | null,
): Buffer {
  const documento = new PdfDocumento()
  const anchoPagina = 842
  const altoPagina = 595
  const margen = 36
  const anchoUtil = anchoPagina - margen * 2
  const limiteInferior = 48
  let pagina!: Lienzo
  let y = 0

  const abrirPagina = (primera: boolean) => {
    pagina = documento.nuevaPagina(anchoPagina, altoPagina)
    if (primera) {
      pagina.texto(margen, 565, 'REPORTE DE VENTAS', { tamano: 15, negrita: true })
      pagina.texto(
        margen,
        548,
        `Del ${reporte.desde} al ${reporte.hasta} · Generado ${fechaHora(reporte.generadoEn)}`,
        { tamano: 8, color: '0.35 0.35 0.35' },
      )
      const datosEmpresa = [
        empresa?.razonSocial ? empresa.razonSocial.toUpperCase() : '',
        empresa?.ruc ? `RUC: ${empresa.ruc}` : '',
        empresa?.direccion ?? '',
      ]
        .filter((valor): valor is string => Boolean(valor))
        .join(' · ')
      if (datosEmpresa) {
        pagina.texto(margen, 534, recortar(datosEmpresa, anchoUtil, 8), {
          tamano: 8,
          negrita: true,
        })
        y = 516
      } else {
        y = 528
      }
      return
    }

    pagina.texto(margen, 568, 'REPORTE DE VENTAS (continuación)', {
      tamano: 9,
      negrita: true,
    })
    y = 550
  }

  const asegurar = (altura: number) => {
    if (y - altura < limiteInferior) abrirPagina(false)
  }

  const seccion = (titulo: string) => {
    asegurar(32)
    pagina.rectangulo(margen, y - 20, anchoUtil, 22, '0.90 0.93 0.98')
    pagina.texto(margen + 6, y - 13, titulo, { tamano: 9, negrita: true })
    y -= 28
  }

  function tabla<T>(columnas: Columna<T>[], filas: T[]): void {
    const anchoTabla = columnas.reduce((total, columna) => total + columna.ancho, 0)

    const cabecera = () => {
      asegurar(20)
      pagina.rectangulo(margen, y - 16, anchoTabla, 18, '0.86 0.90 0.96')
      let x = margen
      for (const columna of columnas) {
        pagina.texto(x + 4, y - 11, recortar(columna.titulo, columna.ancho - 8), {
          tamano: 8,
          negrita: true,
          alineacion: columna.alineacion ?? 'izquierda',
        })
        x += columna.ancho
      }
      y -= 20
    }

    cabecera()
    filas.forEach((fila, indice) => {
      if (y - 14 < limiteInferior) {
        abrirPagina(false)
        cabecera()
      }
      if (indice % 2 === 1) {
        pagina.rectangulo(margen, y - 14, anchoTabla, 14, '0.98 0.98 0.98')
      }
      let x = margen
      for (const columna of columnas) {
        pagina.texto(x + 4, y - 10, recortar(columna.valor(fila), columna.ancho - 8), {
          tamano: 8,
          alineacion: columna.alineacion ?? 'izquierda',
        })
        x += columna.ancho
      }
      y -= 14
    })
    y -= 8
  }

  abrirPagina(true)

  const { resumen } = reporte
  seccion('Resumen')
  tabla(
    [
      { titulo: 'Indicador', ancho: 420, valor: (fila) => fila.indicador },
      { titulo: 'Valor', ancho: 350, valor: (fila) => fila.valor, alineacion: 'derecha' },
    ],
    [
      { indicador: 'Desde', valor: reporte.desde },
      { indicador: 'Hasta', valor: reporte.hasta },
      { indicador: 'Comprobantes considerados', valor: String(resumen.comprobantes) },
      { indicador: 'Anulados excluidos', valor: String(resumen.anulados) },
      { indicador: 'Subtotal neto', valor: dinero(resumen.subtotal) },
      { indicador: 'IGV neto', valor: dinero(resumen.igv) },
      { indicador: 'Total neto', valor: dinero(resumen.total) },
      { indicador: 'Ventas netas (PEN)', valor: dinero(resumen.totalPEN) },
      { indicador: 'Ventas netas (USD)', valor: dinero(resumen.totalUSD) },
      { indicador: 'Ticket promedio (PEN)', valor: dinero(resumen.ticketPromedio) },
      { indicador: 'Facturas', valor: String(resumen.facturas) },
      { indicador: 'Boletas', valor: String(resumen.boletas) },
      { indicador: 'Notas de crédito', valor: String(resumen.notasCredito) },
      { indicador: 'Notas de débito', valor: String(resumen.notasDebito) },
    ],
  )

  seccion('Ventas por día')
  tabla(
    [
      { titulo: 'Fecha', ancho: 180, valor: (fila) => fila.fecha },
      { titulo: 'Comprobantes', ancho: 220, valor: (fila) => String(fila.comprobantes), alineacion: 'derecha' },
      { titulo: 'Total PEN', ancho: 370, valor: (fila) => dinero(fila.totalPEN), alineacion: 'derecha' },
    ],
    reporte.porDia,
  )

  seccion('Ventas por tipo de comprobante')
  tabla(
    [
      { titulo: 'Tipo', ancho: 300, valor: (fila) => ETIQUETAS_TIPO[fila.tipo] },
      { titulo: 'Comprobantes', ancho: 200, valor: (fila) => String(fila.comprobantes), alineacion: 'derecha' },
      { titulo: 'Total PEN', ancho: 270, valor: (fila) => dinero(fila.totalPEN), alineacion: 'derecha' },
    ],
    reporte.porTipo,
  )

  seccion('Ventas por producto')
  tabla(
    [
      { titulo: 'Producto', ancho: 420, valor: (fila) => fila.descripcion },
      { titulo: 'Cantidad', ancho: 140, valor: (fila) => String(fila.cantidad), alineacion: 'derecha' },
      { titulo: 'Total PEN', ancho: 210, valor: (fila) => dinero(fila.totalPEN), alineacion: 'derecha' },
    ],
    reporte.porProducto,
  )

  seccion('Detalle de comprobantes')
  tabla(
    [
      { titulo: 'Fecha', ancho: 62, valor: (fila) => fila.fecha },
      {
        titulo: 'Comprobante',
        ancho: 104,
        valor: (fila) => `${fila.serie}-${String(fila.numero).padStart(8, '0')}`,
      },
      { titulo: 'Cliente', ancho: 184, valor: (fila) => fila.cliente },
      { titulo: 'Tipo', ancho: 120, valor: (fila) => ETIQUETAS_TIPO[fila.tipo] },
      { titulo: 'Total', ancho: 88, valor: (fila) => dinero(fila.total), alineacion: 'derecha' },
      { titulo: 'Total PEN', ancho: 100, valor: (fila) => dinero(fila.totalPEN), alineacion: 'derecha' },
      { titulo: 'Estado', ancho: 112, valor: (fila) => fila.estado },
    ],
    reporte.detalle,
  )

  asegurar(20)
  pagina.texto(margen + anchoUtil, y, `Total general (PEN): ${dinero(resumen.totalPEN)}`, {
    tamano: 9,
    negrita: true,
    alineacion: 'derecha',
  })

  documento.paginas.forEach((paginaFooter, indice) => {
    paginaFooter.linea(margen, 36, margen + anchoUtil, 36, '0.85 0.85 0.85')
    paginaFooter.texto(
      margen,
      24,
      `DEMO · Reporte de ventas · ${reporte.desde} a ${reporte.hasta}`,
      { tamano: 7, color: '0.4 0.4 0.4' },
    )
    paginaFooter.texto(
      margen + anchoUtil,
      24,
      `Página ${indice + 1} de ${documento.paginas.length}`,
      { tamano: 7, alineacion: 'derecha', color: '0.4 0.4 0.4' },
    )
  })

  return documento.serializar()
}
