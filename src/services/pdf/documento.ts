import zlib from 'node:zlib'

/** Generador mínimo de PDF 1.4 en memoria: texto Helvetica, líneas e imágenes 1 bit. */
const fijo = (valor: number) => valor.toFixed(2)
const escaparTexto = (valor: string) =>
  valor
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    .replace(/[\r\n]+/g, ' ')

/** Ancho aproximado de Helvetica en puntos; alcanza para alinear columnas. */
export function anchoTexto(valor: string, tamano: number): number {
  let unidades = 0
  for (const caracter of valor) {
    if (/[0-9]/.test(caracter)) unidades += 0.556
    else if (caracter === ' ') unidades += 0.278
    else if (caracter === 'i' || caracter === 'l' || caracter === '.' || caracter === ',') {
      unidades += 0.24
    } else if (caracter === 'M' || caracter === 'W') unidades += 0.85
    else unidades += 0.52
  }
  return unidades * tamano
}

export interface OpcionesTexto {
  tamano?: number
  negrita?: boolean
  color?: string
  alineacion?: 'izquierda' | 'centro' | 'derecha'
}

export class Lienzo {
  readonly instrucciones: string[] = []
  readonly imagenes: { nombre: string; id: number }[] = []
  private contadorImagenes = 0

  constructor(
    readonly ancho: number,
    readonly alto: number,
  ) {}

  texto(x: number, y: number, valor: string, opciones: OpcionesTexto = {}): void {
    const tamano = opciones.tamano ?? 9
    const contenido = String(valor)
    const ancho = anchoTexto(contenido, tamano)
    const posicion =
      opciones.alineacion === 'derecha'
        ? x - ancho
        : opciones.alineacion === 'centro'
          ? x - ancho / 2
          : x
    const fuente = opciones.negrita ? 'F2' : 'F1'
    this.instrucciones.push(
      `BT ${opciones.color ?? '0 0 0'} rg /${fuente} ${fijo(tamano)} Tf ${fijo(posicion)} ${fijo(y)} Td (${escaparTexto(contenido)}) Tj ET`,
    )
  }

  linea(x1: number, y1: number, x2: number, y2: number, color = '0.75 0.75 0.75', grosor = 0.4): void {
    this.instrucciones.push(
      `${color} RG ${fijo(grosor)} w ${fijo(x1)} ${fijo(y1)} m ${fijo(x2)} ${fijo(y2)} l S`,
    )
  }

  rectangulo(x: number, y: number, ancho: number, alto: number, color = '0.93 0.95 0.98'): void {
    this.instrucciones.push(
      `${color} rg ${fijo(x)} ${fijo(y)} ${fijo(ancho)} ${fijo(alto)} re f`,
    )
  }

  imagen(x: number, y: number, ancho: number, alto: number, idXobject: number): void {
    const nombre = `/X${++this.contadorImagenes}`
    this.imagenes.push({ nombre, id: idXobject })
    this.instrucciones.push(`q ${fijo(ancho)} 0 0 ${fijo(alto)} ${fijo(x)} ${fijo(y)} cm ${nombre} Do Q`)
  }
}

export class PdfDocumento {
  private readonly objetos = new Map<number, Buffer>()
  readonly paginas: Lienzo[] = []
  private readonly idPaginas: number
  private readonly idRegular: number
  private readonly idNegrita: number
  private siguiente = 1

  constructor() {
    this.idPaginas = this.reservar()
    this.idRegular = this.agregar(
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    )
    this.idNegrita = this.agregar(
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
    )
  }

  private reservar(): number {
    return this.siguiente++
  }

  agregar(contenido: string | Buffer): number {
    const id = this.reservar()
    const bytes = typeof contenido === 'string' ? Buffer.from(contenido, 'latin1') : contenido
    this.objetos.set(id, bytes)
    return id
  }

  private flujo(diccionario: string, datos: Buffer): number {
    const comprimido = zlib.deflateSync(datos)
    return this.agregar(
      Buffer.concat([
        Buffer.from(`<< ${diccionario} /Length ${comprimido.length} >>\nstream\n`, 'latin1'),
        comprimido,
        Buffer.from('\nendstream', 'latin1'),
      ]),
    )
  }

  /** Matriz `qrcode` (1 = módulo oscuro) a imagen PDF en blanco y negro con zona tranquila. */
  imagenDeMatriz(size: number, datos: Uint8Array): number {
    const borde = 4
    const lado = size + borde * 2
    const bytesPorFila = Math.ceil(lado / 8)
    const mapaBits = Buffer.alloc(bytesPorFila * lado, 0xff)
    for (let fila = 0; fila < lado; fila += 1) {
      for (let columna = 0; columna < lado; columna += 1) {
        const x = columna - borde
        const y = fila - borde
        const oscuro = x >= 0 && y >= 0 && x < size && y < size && datos[y * size + x] === 1
        if (oscuro) {
          mapaBits[fila * bytesPorFila + (columna >> 3)] &= ~(0x80 >> (columna & 7))
        }
      }
    }
    return this.flujo(
      `/Type /XObject /Subtype /Image /Width ${lado} /Height ${lado} /ColorSpace /DeviceGray /BitsPerComponent 1 /Filter /FlateDecode`,
      mapaBits,
    )
  }

  nuevaPagina(ancho: number, alto: number): Lienzo {
    const lienzo = new Lienzo(ancho, alto)
    this.paginas.push(lienzo)
    return lienzo
  }

  serializar(): Buffer {
    const idsPaginas: number[] = []
    for (const lienzo of this.paginas) {
      const idContenido = this.flujo(
        '/Filter /FlateDecode',
        Buffer.from(lienzo.instrucciones.join('\n'), 'latin1'),
      )
      const xobjetos = lienzo.imagenes
        .map(({ nombre, id }) => `${nombre} ${id} 0 R`)
        .join(' ')
      const recursos =
        `/ProcSet [/PDF /Text /ImageB /ImageC] /Font << /F1 ${this.idRegular} 0 R /F2 ${this.idNegrita} 0 R >>` +
        (xobjetos ? ` /XObject << ${xobjetos} >>` : '')
      idsPaginas.push(
        this.agregar(
          `<< /Type /Page /Parent ${this.idPaginas} 0 R /MediaBox [0 0 ${fijo(lienzo.ancho)} ${fijo(lienzo.alto)}] /Resources << ${recursos} >> /Contents ${idContenido} 0 R >>`,
        ),
      )
    }

    this.objetos.set(
      this.idPaginas,
      Buffer.from(
        `<< /Type /Pages /Kids [${idsPaginas.map((id) => `${id} 0 R`).join(' ')}] /Count ${idsPaginas.length} >>`,
        'latin1',
      ),
    )
    const idCatalogo = this.agregar(`<< /Type /Catalog /Pages ${this.idPaginas} 0 R >>`)

    const ultimateId = this.siguiente - 1
    let salida = Buffer.from('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n', 'binary')
    const desplazamientos: number[] = []
    for (let id = 1; id <= ultimateId; id += 1) {
      desplazamientos[id] = salida.length
      const objeto = this.objetos.get(id) ?? Buffer.from('null', 'latin1')
      salida = Buffer.concat([
        salida,
        Buffer.from(`${id} 0 obj\n`, 'latin1'),
        objeto,
        Buffer.from('\nendobj\n', 'latin1'),
      ])
    }

    const inicioXref = salida.length
    let xref = `xref\n0 ${ultimateId + 1}\n0000000000 65535 f \n`
    for (let id = 1; id <= ultimateId; id += 1) {
      xref += `${String(desplazamientos[id]).padStart(10, '0')} 00000 n \n`
    }
    xref += `trailer\n<< /Size ${ultimateId + 1} /Root ${idCatalogo} 0 R >>\nstartxref\n${inicioXref}\n%%EOF\n`
    return Buffer.concat([salida, Buffer.from(xref, 'latin1')])
  }
}
