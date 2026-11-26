import JSZip from 'jszip'

export type CeldaExcel = string | number | null

export interface HojaExcel {
  nombre: string
  columnas: string[]
  filas: CeldaExcel[][]
  anchos?: number[]
}

const encabezado = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'

const escapar = (valor: string) =>
  valor
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')

/** A -> Z, AA -> ... (Excel usa columnas en base 1). */
function letraColumna(indice: number): string {
  let resto = indice
  let resultado = ''
  do {
    resultado = String.fromCharCode(65 + (resto % 26)) + resultado
    resto = Math.floor(resto / 26) - 1
  } while (resto >= 0)
  return resultado
}

/** Estilo 1 = cabecera, estilo 2 = número con dos decimales. */
function celda(valor: CeldaExcel, referencia: string, estilo: number): string {
  if (valor === null || valor === '') return ''
  if (typeof valor === 'number' && Number.isFinite(valor)) {
    return `<c r="${referencia}" s="2"><v>${valor}</v></c>`
  }
  return `<c r="${referencia}" s="${estilo}" t="inlineStr"><is><t xml:space="preserve">${escapar(String(valor))}</t></is></c>`
}

function hojaXml(hoja: HojaExcel): string {
  const totalColumnas = Math.max(1, hoja.columnas.length)
  const ultimaColumna = letraColumna(totalColumnas - 1)
  const totalFilas = hoja.filas.length + 1
  const filas = hoja.filas
    .map((fila, indiceFila) => {
      const celdas = hoja.columnas
        .map((_, indiceColumna) => {
          const valor = fila[indiceColumna] ?? null
          const referencia = `${letraColumna(indiceColumna)}${indiceFila + 2}`
          return celda(valor, referencia, 0)
        })
        .join('')
      return `<row r="${indiceFila + 2}">${celdas}</row>`
    })
    .join('')
  const cabeceraCeldas = hoja.columnas
    .map((titulo, indice) =>
      celda(titulo, `${letraColumna(indice)}1`, 1),
    )
    .join('')
  const columnas = (hoja.anchos ?? [])
    .map(
      (ancho, indice) =>
        `<col min="${indice + 1}" max="${indice + 1}" width="${ancho}" customWidth="1"/>`,
    )
    .join('')

  return (
    `${encabezado}` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<dimension ref="A1:${ultimaColumna}${totalFilas}"/>` +
    `<sheetViews><sheetView workbookViewId="0"/></sheetViews>` +
    `<sheetFormatPr defaultRowHeight="15"/>` +
    (columnas ? `<cols>${columnas}</cols>` : '') +
    `<sheetData><row r="1">${cabeceraCeldas}</row>${filas}</sheetData>` +
    `</worksheet>`
  )
}

const ESTILOS = `${encabezado}
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.00"/></numFmts>
  <fonts count="2">
    <font><sz val="11"/><name val="Calibri"/></font>
    <font><b/><sz val="11"/><name val="Calibri"/></font>
  </fonts>
  <fills count="3">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFE8EEF7"/><bgColor indexed="64"/></patternFill></fill>
  </fills>
  <borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="3">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
    <xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
  </cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`

const RELACIONES_RAIZ = `${encabezado}
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`

/** Genera un .xlsx mínimo y válido reutilizando JSZip (ya usado por SUNAT). */
export async function generarXlsx(hojas: HojaExcel[]): Promise<Buffer> {
  if (!hojas.length) throw new Error('El libro Excel necesita al menos una hoja.')

  const zip = new JSZip()
  zip.file(
    '[Content_Types].xml',
    `${encabezado}
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  ${hojas
    .map(
      (_, indice) =>
        `<Override PartName="/xl/worksheets/sheet${indice + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
    )
    .join('')}
</Types>`,
  )
  zip.file('_rels/.rels', RELACIONES_RAIZ)

  zip.file(
    'xl/workbook.xml',
    `${encabezado}
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    ${hojas
      .map(
        (hoja, indice) =>
          `<sheet name="${escapar(hoja.nombre.slice(0, 31))}" sheetId="${indice + 1}" r:id="rId${indice + 1}"/>`,
      )
      .join('')}
  </sheets>
</workbook>`,
  )

  zip.file(
    'xl/_rels/workbook.xml.rels',
    `${encabezado}
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${hojas
    .map(
      (_, indice) =>
        `<Relationship Id="rId${indice + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${indice + 1}.xml"/>`,
    )
    .join('')}
  <Relationship Id="rId${hojas.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`,
  )

  zip.file('xl/styles.xml', ESTILOS)
  hojas.forEach((hoja, indice) => {
    zip.file(`xl/worksheets/sheet${indice + 1}.xml`, hojaXml(hoja))
  })

  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
}
