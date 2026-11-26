# SUNAT directo (UBL 2.1 + SOAP)

La operación actual usa `SUNAT_PROVEEDOR=local`: no hay envíos reales ni credenciales SUNAT cargadas.
La integración directa quedó implementada y aislada como referencia; el proveedor `apisperu` se
conserva como alternativa, pero no se usa en el despliegue actual.

## Lo que ya usa SICAP

- Certificados en `C:\Users\mauri\Desktop\SICAP\CERTIFICADO DIGITAL MUEBLES JOSE 2025-2028\`
  (`FIRMA.pfx` / `certificado.p12`, con contraseña en `contraseña.txt`). No copiar al repo.
- Respuestas (CDR) en `MUEBLEJO\CPE\PRODUCCION\R-<RUC>-<TT>-<SERIE>-<NUMERO>.XML`.
- Los XML emitidos son UBL 2.1 con `UBLExtensions/UBLExtension/ExtensionContent/Signature`,
  firma XMLDSig con `rsa-sha256` y `exclusive c14n`, `Reference URI=""`, transform
  `enveloped-signature`. El<SUNAT/> firmante es el RUC del emisor (no el de SUNAT).
- El RUC real del emisor en los CDR es `10101222221`; empresa `MUEBLERIA JOSE`, dirección
  `Av. Angamos Este Nro. 1551 Block 2, 1 Piso Tda 79 C.C. Plaza Hogar - Lima - Lima - Surquillo`,
  ubigeo `150101`, distrito `SAN BORJA`.
- El correlativo de SICAP tiene 8 dígitos (`F001-00000111`, `B001-00000667`). La app usa
  números cortos (`F001-1`, `B001-1`) y SUNAT acepta de 1 a 8.
- SICAP calcula `PRECIO_DET` con IGV incluido (`367.500000`) y `PRECIO_SIN_IGV_DET` derivado
  (`311.440678`), con redondeo por línea: coincide con la regla ya implementada en la API.
- Operación `0101` (VENTA INTERNA), código de producto `NIU`, tipo de precio `01`,
  moneda `PEN`, detracción `000`, guía `4` (sin guía).
- En el JSON de SICAP aparecen credenciales Clave SOL en texto plano. No se copiarán; se
  leerán de variables de entorno.

## Servicios (Manual del Programador SUNAT 2.1)

| Documento | Beta | Producción |
| --- | --- | --- |
| Factura, boleta, notas, resumen, bajas | `https://e-beta.sunat.gob.pe/ol-ti-itcpfegem-beta/billService` | `https://e-factura.sunat.gob.pe/ol-ti-itcpfegem/billService` |
| Guías de remisión | `https://e-beta.sunat.gob.pe/ol-ti-itemision-guia-gem-beta/billService` | `https://e-guiaremision.sunat.gob.pe/ol-ti-itemision-guia-gem/billService` |
| Retenciones/percepciones | `https://e-beta.sunat.gob.pe/ol-ti-itemision-otroscpe-gem-beta/billService` | `https://e-factura.sunat.gob.pe/ol-ti-itemision-otroscpe-gem/billService` |

Método `sendBill(fileName, contentFile)`: recibe un ZIP con un único XML y devuelve un ZIP con
el CDR (`ApplicationResponse`). Autenticación WS-Security `UsernameToken`: usuario
`<RUC><USUARIO_SOL>`, password `<CLAVE_SOL>` (clave secundaria con perfil de emisión). En beta,
usuario `<RUC><USUARIO_SOL>`, password `<CLAVE_SOL>`, sin certificado registrado.

El nombre del ZIP/XML es `RUC-TT-SERIE-NUMERO.zip` / `.xml` (ej. `10101222221-01-F001-111.zip`).

## Variables de entorno (backend)

```dotenv
SUNAT_PROVEEDOR=direct             # auto | local | apisperu | direct
SUNAT_MODO=beta                    # beta | produccion | local
SUNAT_RUC=10101222221
SUNAT_SOL_USUARIO=                 # usuario SOL secundario
SUNAT_SOL_PASSWORD=            # definir solo en .env del servidor
SUNAT_CERTIFICATE_PFX_PATH=        # ruta al .pfx/.p12 (fuera del repo)
SUNAT_CERTIFICATE_PFX_PASSWORD=    # contraseña del certificado
```

La lista completa de opciones (PEM, base64, endpoints y timeout) está en `.env.example`.

## Alcance del primer corte

- Factura (01) y boleta (03) con firma, ZIP y `sendBill`.
- CDR guardado en la columna de respuesta y estado `ACEPTADO`/`RECHAZADO` según
  `cbc:ResponseCode`.
- Sin envíos reales todavía: las pruebas son unitarias y, si se quiere, contra beta con
  credenciales de prueba. Producción queda bloqueada hasta cargar certificado y Clave SOL reales.

## Funcionalidades de SICAP replicadas y pendientes

1. ✅ Notas de crédito (07) y débito (08): se gestionan localmente desde el detalle del comprobante.
2. ✅ Resumen diario (`RC001`) y comunicaciones de baja (`RA001`): se registran localmente, sin envío
   a SUNAT ni credenciales SOL.
3. ✅ Guías de remisión (`T001`) y detracciones: catálogo de 35 códigos/tasas importado de
   `DETRACCIONES.DBF`, con cálculo local y anotación en el XML; sin pagos ni depósitos bancarios.
4. ✅ Reportes de ventas en Excel y PDF (A4 apaisado `842 × 595`); comprobantes con ticket POS 80 y
   QR de texto de SICAP. No se genera código de barras: los PDF reales muestran ese QR, no un Code128
   ni un código SUNAT.
5. ✅ Cotizaciones (`C001`) y pedidos (`P001`); siguen pendientes las cuentas por cobrar/pagar.
