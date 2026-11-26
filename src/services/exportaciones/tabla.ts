import { z } from 'zod'
import { PdfDocumento } from '../pdf/documento.ts'
import { generarXlsx, type CeldaExcel } from '../reportes/xlsx.ts'

const celdaSchema = z.union([z.string(), z.number(), z.null()])

export const tablaExportSchema = z.object({
  formato: z.enum(['pdf', 'excel']),
  titulo: z.string().min(1).max(120),
  nombreArchivo: z
    .string()
    .min(1)
    .max(120)
    .regex(/^[\w-]+$/, 'El nombre del archivo solo admite letras, números, guiones y guiones bajos.'),
  columnas: z
    .array(
      z.object({
        titulo: z.string().min(1).max(80),
        ancho: z.number().min(40).max(600),
        alineacion: z.enum(['izquierda', 'derecha']).optional(),
      }),
    )
    .min(1)
    .max(20),
  filas: z.array(z.array(celdaSchema).max(20)).max(2000),
})

export type TablaExport = z.infer<typeof tablaExportSchema>

const fechaHoy = () =>
  new Intl.DateTimeFormat('es-PE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'America/Lima',
  }).format(new Date())

const recortar = (valor: string, ancho: number, tamano = 8): string => {
  const maximo = Math.max(4, Math.floor(ancho / (tamano * 0.56)))
  return valor.length <= maximo ? valor : `${valor.slice(0, Math.max(1, maximo - 1))}…`
}

/** PDF apaisado con una tabla genérica, cabecera repetida y paginación. */
export function pdfTabla(datos: TablaExport): Buffer {
  const documento = new PdfDocumento()
  const ancho = 842
  const alto = 595
  const margen = 36
  const anchoUtil = ancho - margen * 2
  const total = datos.columnas.reduce((suma, columna) => suma + columna.ancho, 0)
  const escala = anchoUtil / total
  const anchos = datos.columnas.map((columna) => columna.ancho * escala)

  let pagina = documento.nuevaPagina(ancho, alto)
  let y = 0

  const cabecera = () => {
    pagina.rectangulo(margen, y - 16, anchoUtil, 18, '0.88 0.91 0.96')
    let x = margen
    datos.columnas.forEach((columna, indice) => {
      pagina.texto(x + 4, y - 11, recortar(columna.titulo, anchos[indice] - 8), {
        tamano: 8,
        negrita: true,
        alineacion: columna.alineacion ?? 'izquierda',
      })
      x += anchos[indice]
    })
    y -= 20
  }

  const abrirPagina = () => {
    pagina = documento.nuevaPagina(ancho, alto)
    y = alto - margen
    pagina.texto(margen, y, datos.titulo, { tamano: 16, negrita: true })
    y -= 18
    pagina.texto(
      margen,
      y,
      `Generado el ${fechaHoy()} · ${datos.filas.length} ${datos.filas.length === 1 ? 'registro' : 'registros'}`,
      { tamano: 8, color: '0.4 0.4 0.4' },
    )
    y -= 16
    cabecera()
  }

  abrirPagina()

  datos.filas.forEach((fila, indiceFila) => {
    if (y - 14 < 52) {
      abrirPagina()
    }
    if (indiceFila % 2 === 1) {
      pagina.rectangulo(margen, y - 14, anchoUtil, 14, '0.98 0.98 0.98')
    }
    let x = margen
    datos.columnas.forEach((columna, indiceColumna) => {
      const valor: CeldaExcel = fila[indiceColumna] ?? null
      pagina.texto(x + 4, y - 10, recortar(valor === null ? '' : String(valor), anchos[indiceColumna] - 8), {
        tamano: 8,
        alineacion: columna.alineacion ?? 'izquierda',
      })
      x += anchos[indiceColumna]
    })
    y -= 14
  })

  documento.paginas.forEach((hoja, indice) => {
    hoja.linea(margen, 34, margen + anchoUtil, 34, '0.85 0.85 0.85')
    hoja.texto(margen, 22, `DEMO · ${datos.titulo}`, { tamano: 7, color: '0.4 0.4 0.4' })
    hoja.texto(margen + anchoUtil, 22, `Página ${indice + 1} de ${documento.paginas.length}`, {
      tamano: 7,
      alineacion: 'derecha',
      color: '0.4 0.4 0.4',
    })
  })

  return documento.serializar()
}

export async function excelTabla(datos: TablaExport): Promise<Buffer> {
  return generarXlsx([
    {
      nombre: datos.titulo.slice(0, 31),
      columnas: datos.columnas.map((columna) => columna.titulo),
      filas: datos.filas,
      anchos: datos.columnas.map((columna) => Math.round(columna.ancho / 7)),
    },
  ])
}
