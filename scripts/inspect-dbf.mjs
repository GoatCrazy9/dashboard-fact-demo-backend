#!/usr/bin/env node
// Inventario de los DBF de SICAP. No escribe nada: solo lee y resume.
// Uso: node api/scripts/inspect-dbf.mjs "C:\ruta\a\VENTAS" [--rows 5]
//
// Los DBF de Visual FoxPro incluyen el campo de sistema `_NullFlags` (tipo "0"),
// que dbffile no reconoce. Para esos archivos se arma una copia temporal sin
// ese campo; el original nunca se toca.
import { readdir, readFile, stat, unlink, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { tmpdir } from 'node:os'
import DBFFileModule from 'dbffile'

// dbffile es CommonJS: el default interop es el módulo, no la clase.
const DBFFile = DBFFileModule.DBFFile ?? DBFFileModule

const carpeta = process.argv[2]
const rowsIndex = process.argv.indexOf('--rows')
const maxRows = rowsIndex > 0 ? Number(process.argv[rowsIndex + 1] ?? 3) : 3

if (!carpeta) {
  console.error('Uso: node api/scripts/inspect-dbf.mjs "C:\\ruta\\a\\VENTAS" [--rows 5]')
  process.exit(1)
}

/** Devuelve los descriptores de campo de un DBF. */
function leerCampos(buffer) {
  const headerLen = buffer.readUInt16LE(8)
  const campos = []
  let base = 32
  // Los descriptores terminan en 0x0D; el header de VFP agrega un backlink después.
  while (base + 32 <= headerLen && buffer[base] !== 0x0d) {
    campos.push({
      nombre: buffer
        .subarray(base, base + 11)
        .toString('latin1')
        .replace(/\0.*$/s, '')
        .trim(),
      tipo: String.fromCharCode(buffer[base + 11]),
      largo: buffer[base + 16],
    })
    base += 32
  }
  return campos
}

async function abrirDbf(ruta) {
  const buffer = await readFile(ruta)
  const campos = leerCampos(buffer)
  const invalidos = campos.filter((campo) => !'CNDLMIFTYBGO@+'.includes(campo.tipo))
  if (invalidos.length === 0) return { dbf: await DBFFile.open(ruta, { encoding: 'cp1252' }), temporal: null }

  // Copia saneada: se eliminan los campos de sistema no soportados byte a byte.
  const headerLen = buffer.readUInt16LE(8)
  const registroLen = buffer.readUInt16LE(10)
  const cantidadRegistros = buffer.readUInt32LE(4)
  const totalCampos = campos.length

  const rangos = [{ inicio: 0, largo: 1, conservar: true }] // byte de borrado
  let desplazamiento = 1
  for (const campo of campos) {
    const invalido = invalidos.includes(campo)
    rangos.push({ inicio: desplazamiento, largo: campo.largo, conservar: !invalido })
    desplazamiento += campo.largo
  }

  const nuevoHeaderLen = headerLen - invalidos.length * 32
  const nuevoRegistroLen = registroLen - invalidos.reduce((suma, campo) => suma + campo.largo, 0)

  const cabecera = Buffer.from(buffer.subarray(0, 32))
  cabecera.writeUInt16LE(nuevoHeaderLen, 8)
  cabecera.writeUInt16LE(nuevoRegistroLen, 10)

  const descriptores = []
  for (const campo of campos) {
    if (invalidos.includes(campo)) continue
    const indice = campos.indexOf(campo)
    descriptores.push(buffer.subarray(32 + indice * 32, 32 + (indice + 1) * 32))
  }
  const cola = buffer.subarray(32 + totalCampos * 32, headerLen)

  const registros = []
  for (let i = 0; i < cantidadRegistros; i += 1) {
    const base = headerLen + i * registroLen
    const original = buffer.subarray(base, base + registroLen)
    const partes = rangos
      .filter((rango) => rango.conservar)
      .map((rango) => original.subarray(rango.inicio, rango.inicio + rango.largo))
    registros.push(Buffer.concat(partes))
  }

  const temporal = join(tmpdir(), `sicap-${basename(ruta)}-${Date.now()}.dbf`)
  await writeFile(temporal, Buffer.concat([cabecera, ...descriptores, cola, ...registros]))
  return { dbf: await DBFFile.open(temporal, { encoding: 'cp1252' }), temporal }
}

const entradas = await readdir(carpeta)
const archivos = entradas.filter((nombre) => nombre.toLowerCase().endsWith('.dbf'))

if (archivos.length === 0) {
  console.error(`No se encontraron archivos .DBF en ${carpeta}`)
  process.exit(1)
}

for (const nombre of archivos) {
  const ruta = join(carpeta, nombre)
  const info = await stat(ruta)
  let temporal = null
  try {
    const abierto = await abrirDbf(ruta)
    temporal = abierto.temporal
    const dbf = abierto.dbf

    console.log(`\n=== ${nombre} ===`)
    console.log(`${dbf.recordCount} registros · ${info.size} bytes`)
    console.log(
      'Campos:',
      dbf.fields.map((campo) => `${campo.name}:${campo.type}(${campo.size})`).join(', '),
    )

    const muestra = await dbf.readRecords(Math.min(maxRows, dbf.recordCount))
    for (const registro of muestra) {
      const plano = Object.fromEntries(
        Object.entries(registro).filter(([clave]) => !clave.startsWith('_')),
      )
      console.log(JSON.stringify(plano))
    }
  } catch (error) {
    console.warn(`\n=== ${nombre} === no se pudo leer: ${error.message}`)
  } finally {
    if (temporal) await unlink(temporal).catch(() => {})
  }
}
