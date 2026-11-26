import { createHash, X509Certificate } from 'node:crypto'
import { readFileSync } from 'node:fs'
import forge from 'node-forge'
import { SignedXml } from 'xml-crypto'
import { NAMESPACES } from './xml.ts'

const C14N_EXCLUSIVA = 'http://www.w3.org/2001/10/xml-exc-c14n#'
const C14N_INCLUSIVA = 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315'
const SHA256 = 'http://www.w3.org/2001/04/xmlenc#sha256'
const RSA_SHA256 = 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256'
const ENVELOPED = 'http://www.w3.org/2000/09/xmldsig#enveloped-signature'

export interface CertificadoFirma {
  certificadoPem: string
  clavePrivadaPem: string
}

export interface OpcionesCertificado {
  pfxPath?: string
  pfxBase64?: string
  pfxPassword?: string
  certPath?: string
  certPem?: string
  certBase64?: string
  keyPath?: string
  keyPem?: string
  keyBase64?: string
}

/** Acepta PEM literal (con \n escapados) o contenido base64 de un PEM. */
function textoDeContenido(valor: string): string {
  if (!valor) return ''
  if (valor.includes('-----BEGIN')) return valor.replace(/\\n/g, '\n')
  return Buffer.from(valor, 'base64').toString('utf8')
}

/**
 * Carga el certificado desde un PKCS#12 (.pfx) o desde un par de archivos PEM.
 * Se prefiere el .pfx cuando ambos están configurados.
 */
export function cargarCertificado(opciones: OpcionesCertificado): CertificadoFirma {
  if (opciones.pfxPath || opciones.pfxBase64) {
    const archivo = opciones.pfxPath ? readFileSync(opciones.pfxPath) : Buffer.from(opciones.pfxBase64 ?? '', 'base64')
    const pkcs12 = forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(archivo.toString('binary')), opciones.pfxPassword ?? '')
    const bolsas = pkcs12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })
    const llavesCifradas = bolsas[forge.pki.oids.pkcs8ShroudedKeyBag] ?? []
    const llavesPlanas = pkcs12.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag] ?? []
    const llave = llavesCifradas[0]?.key ?? llavesPlanas[0]?.key
    const certificados = pkcs12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] ?? []
    const certificado = certificados.find((bolsa) => bolsa.cert)?.cert

    if (!llave || !certificado) {
      throw new Error('El archivo .pfx no contiene una llave privada y un certificado válidos.')
    }

    return {
      certificadoPem: forge.pki.certificateToPem(certificado),
      clavePrivadaPem: forge.pki.privateKeyToPem(llave as forge.pki.PrivateKey),
    }
  }

  const certificadoPem = opciones.certPath
    ? readFileSync(opciones.certPath, 'utf8')
    : textoDeContenido(opciones.certPem ?? opciones.certBase64 ?? '')
  const clavePrivadaPem = opciones.keyPath
    ? readFileSync(opciones.keyPath, 'utf8')
    : textoDeContenido(opciones.keyPem ?? opciones.keyBase64 ?? '')

  if (!certificadoPem.includes('-----BEGIN CERTIFICATE-----')) {
    throw new Error('Falta el certificado X.509 (SUNAT_CERTIFICATE_PEM_PATH / _PEM / _BASE64).')
  }
  if (!clavePrivadaPem.includes('PRIVATE KEY-----')) {
    throw new Error('Falta la llave privada (SUNAT_PRIVATE_KEY_PEM_PATH / _PEM / _BASE64).')
  }

  return { certificadoPem, clavePrivadaPem }
}

const escapar = (valor: string): string =>
  valor
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')

/**
 * Firma el XML UBL con XAdES-BES: referencia al documento (URI vacía, transform
 * enveloped-signature) y referencia a las SignedProperties del certificado.
 * El resultado sigue siendo un XMLDSig válido, que es lo que valida SUNAT.
 */
export function firmarXmlXades(
  xml: string,
  certificado: CertificadoFirma,
  fecha: Date = new Date(),
): string {
  const x509 = new X509Certificate(certificado.certificadoPem)
  const huella = createHash('sha256').update(x509.raw).digest('base64')
  const emisor = escapar(x509.issuer.replace(/[\r\n]+/g, ', '))
  const serie = BigInt(`0x${x509.serialNumber}`).toString()

  const signedProperties = [
    `<xades:QualifyingProperties xmlns:xades="${NAMESPACES.xades}" xmlns:ds="${NAMESPACES.ds}" Target="#SignatureSP">`,
    '  <xades:SignedProperties Id="SignedProperties">',
    '    <xades:SignedSignatureProperties>',
    `      <xades:SigningTime>${fecha.toISOString()}</xades:SigningTime>`,
    '      <xades:SigningCertificate>',
    '        <xades:Cert>',
    '          <xades:CertDigest>',
    `            <ds:DigestMethod Algorithm="${SHA256}"/>`,
    `            <ds:DigestValue>${huella}</ds:DigestValue>`,
    '          </xades:CertDigest>',
    '          <xades:IssuerSerial>',
    `            <ds:X509IssuerName>${emisor}</ds:X509IssuerName>`,
    `            <ds:X509SerialNumber>${serie}</ds:X509SerialNumber>`,
    '          </xades:IssuerSerial>',
    '        </xades:Cert>',
    '      </xades:SigningCertificate>',
    '    </xades:SignedSignatureProperties>',
    '  </xades:SignedProperties>',
    '</xades:QualifyingProperties>',
  ].join('')

  const firmador = new SignedXml({
    privateKey: certificado.clavePrivadaPem,
    publicCert: certificado.certificadoPem,
    signatureAlgorithm: RSA_SHA256,
    canonicalizationAlgorithm: C14N_EXCLUSIVA,
    objects: [{ content: signedProperties, attributes: { Id: 'XadesObject' } }],
  })

  firmador.addReference({
    xpath: '/*',
    uri: '',
    isEmptyUri: true,
    digestAlgorithm: SHA256,
    transforms: [ENVELOPED, C14N_INCLUSIVA],
  })
  firmador.addReference({
    xpath: "//*[@Id='SignedProperties']",
    uri: '#SignedProperties',
    type: 'http://uri.etsi.org/01903#SignedProperties',
    digestAlgorithm: SHA256,
    transforms: [C14N_EXCLUSIVA],
  })

  firmador.computeSignature(xml, {
    prefix: 'ds',
    attrs: { Id: 'SignatureSP' },
    existingPrefixes: {
      ds: NAMESPACES.ds,
      xades: NAMESPACES.xades,
      ext: NAMESPACES.ext,
    },
    location: { reference: "//*[local-name(.)='ExtensionContent']", action: 'append' },
  })

  return firmador.getSignedXml()
}
