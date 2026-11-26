import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { test } from 'node:test'
import JSZip from 'jszip'
import { configuracionGre, ClienteGre, reiniciarCacheGre } from '../src/services/sunat/sunat-gre/cliente.ts'

const configuracion = {
  ruc: '20123456789',
  usuarioSol: '20123456789USUARIO',
  password: 'solo-prueba',
  clientId: 'cliente-prueba',
  clientSecret: 'secreto-prueba',
  tokenEndpoint: 'https://seguridad.test/v1',
  apiBase: 'https://gre.test/v1',
  timeoutMs: 1000,
  intentos: 3,
  intervaloMs: 0,
}

const guia = {
  id: 'guia-1',
  serie: 'T001',
  numero: 3,
  fechaEmision: new Date('2026-11-26T17:00:00.000Z'),
  fechaTraslado: new Date('2026-11-26T17:00:00.000Z'),
  creadoEn: new Date('2026-11-26T17:00:00.000Z'),
  motivo: 'VENTA' as const,
  modalidad: 'PRIVADO' as const,
  pesoKg: 12.5,
  direccionPartida: 'Av. Demostracion 123, Lima',
  direccionLlegada: 'Jr. Secundario 456, Arequipa',
  ubigeoPartida: '150101',
  ubigeoLlegada: '040101',
  placa: '',
  conductor: '',
  conductorDocumento: '',
  conductorLicencia: '',
  transportistaRuc: null,
  transportistaRazonSocial: null,
  transportistaRegistroMtc: null,
  notas: null,
  comprobante: null,
  emisor: {
    ruc: configuracion.ruc,
    razonSocial: 'Demo Comercial S.A.C.',
    direccion: 'Av. Demostracion 123, Lima',
    ubigeo: '150101',
  },
  receptor: {
    tipoDocumento: 'RUC',
    numeroDocumento: '20987654321',
    razonSocial: 'Cliente S.A.C.',
    direccion: null,
  },
  items: [{ descripcion: 'Mesa', cantidad: 1, unidad: 'NIU' }],
}

interface Llamada {
  url: string
  init: RequestInit
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

async function cdrBase64(): Promise<string> {
  const zip = new JSZip()
  zip.file(
    'cdr.xml',
    '<?xml version="1.0" encoding="UTF-8"?><ApplicationResponse><cac:DocumentResponse xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"><cac:Response><cbc:ResponseCode xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">0</cbc:ResponseCode><cbc:Description xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">Aceptado</cbc:Description></cac:Response></cac:DocumentResponse></ApplicationResponse>',
  )
  return zip.generateAsync({ type: 'base64' })
}

test('la configuración de GRE exige activación explícita de producción', () => {
  assert.throws(() => configuracionGre(), /SUNAT_GRE_MODO=produccion/)
})

test('el envío usa OAuth, SHA-256 del ZIP y devuelve el ticket', async () => {
  reiniciarCacheGre()
  const llamadas: Llamada[] = []
  const zip = Buffer.from('zip-de-prueba')
  const cliente = new ClienteGre(configuracion, {
    clienteFetch: async (url, init) => {
      llamadas.push({ url: String(url), init: init ?? {} })
      if (String(url).includes('/oauth2/token/')) {
        return json({ access_token: 'token-prueba', token_type: 'Bearer', expires_in: 3600 })
      }
      if (String(url).includes('/envios/')) return json({ codRespuesta: '98' })
      return json({ numTicket: 'ticket-123', fecRecepcion: '2026-11-26T17:00:00Z' })
    },
    esperar: async () => undefined,
  })

  const enviado = await cliente.enviar(guia, {
    nombreXml: '20123456789-09-T001-3.xml',
    nombreZip: '20123456789-09-T001-3.zip',
    xmlFirmado: '<xml />',
    zip,
  })

  assert.equal(enviado.ticket, 'ticket-123')
  assert.equal(llamadas.length, 2)
  const tokenBody = new URLSearchParams(String(llamadas[0]!.init.body))
  assert.equal(tokenBody.get('grant_type'), 'password')
  assert.equal(tokenBody.get('scope'), 'https://api-cpe.sunat.gob.pe')
  assert.equal(tokenBody.get('username'), configuracion.usuarioSol)
  assert.match(String(llamadas[0]!.url), /\/clientessol\/cliente-prueba\/oauth2\/token\/$/)

  const envio = JSON.parse(String(llamadas[1]!.init.body)) as {
    archivo: { nomArchivo: string; arcGreZip: string; hashZip: string }
  }
  assert.equal(envio.archivo.nomArchivo, '20123456789-09-T001-3.zip')
  assert.equal(envio.archivo.arcGreZip, zip.toString('base64'))
  assert.equal(envio.archivo.hashZip, createHash('sha256').update(zip).digest('hex'))
  assert.match(String(llamadas[1]!.url), /comprobantes\/20123456789-09-T001-3$/)
  const headers = llamadas[1]!.init.headers as Record<string, string>
  assert.equal(headers.Authorization, 'Bearer token-prueba')
})

test('el ticket en proceso no se considera CDR y agota los intentos sin reenviar', async () => {
  reiniciarCacheGre()
  let consultas = 0
  const cliente = new ClienteGre(configuracion, {
    clienteFetch: async (url) => {
      if (String(url).includes('/oauth2/token/')) return json({ access_token: 't', expires_in: 3600 })
      consultas += 1
      return json({ codRespuesta: '98' })
    },
    esperar: async () => undefined,
  })

  const resultado = await cliente.esperarTicket('ticket-123')
  assert.equal(resultado.estado, 'PENDIENTE')
  assert.equal(resultado.cdrBase64, null)
  assert.equal(consultas, configuracion.intentos)
})

test('un ticket con CDR aceptado devuelve el código y la constancia', async () => {
  reiniciarCacheGre()
  const cdr = await cdrBase64()
  const cliente = new ClienteGre(configuracion, {
    clienteFetch: async (url) => {
      if (String(url).includes('/oauth2/token/')) return json({ access_token: 't', expires_in: 3600 })
      return json({ codRespuesta: '0', indCdrGenerado: '1', arcCdr: cdr })
    },
    esperar: async () => undefined,
  })

  const resultado = await cliente.consultar('ticket-123')
  assert.equal(resultado.estado, 'ACEPTADO')
  assert.equal(resultado.codigo, '0')
  assert.equal(resultado.cdrBase64, cdr)
})

test('los errores de validación de SUNAT muestran código y detalle sin traza', async () => {
  reiniciarCacheGre()
  const cliente = new ClienteGre(configuracion, {
    clienteFetch: async () =>
      json(
        {
          cod: '422',
          msg: 'Errores de validación',
          exc: 'java.lang.NullPointerException at ...',
          errors: [{ codError: '507', desError: 'El hash no coincide con el ZIP' }],
        },
        422,
      ),
  })

  await assert.rejects(
    () => cliente.consultar('ticket-invalido'),
    (error: unknown) => {
      const mensaje = error instanceof Error ? error.message : String(error)
      assert.match(mensaje, /SUNAT GRE 422/)
      assert.match(mensaje, /507 - El hash no coincide con el ZIP/)
      assert.doesNotMatch(mensaje, /NullPointerException/)
      return true
    },
  )
})
