# Mueblería José · Backend

API Express 5 + TypeScript + Prisma 6 + PostgreSQL (Neon) para facturación electrónica.
El frontend vive en el proyecto hermano `../muebleria-jose-frontend`.

## Puesta en marcha

```powershell
cd muebleria-jose-backend
npm install
Copy-Item .env.example .env   # si aún no existe; completa DATABASE_URL

npm run db:generate           # generar cliente Prisma
npm run db:push               # crear tablas en Neon
npm run db:seed               # empresa, series, clientes, productos, admin y maestro
npm run dev                   # http://localhost:3001
```

El archivo `.env` no se versiona: contiene la cadena pooled de Neon y las credenciales del servidor.

## Comandos

| Comando | Qué hace |
| --- | --- |
| `npm run dev` | API con recarga automática |
| `npm run typecheck` | Verificación de tipos |
| `npm test` | Autenticación, permisos, auditoría, IGV, XML UBL, firma XAdES-BES, ZIP, CDR, QR, PDF, reportes y validaciones de documentos/guías |
| `npm run db:push` | Sincroniza el esquema (sin migraciones versionadas todavía) |
| `npm run db:seed` | Datos base, de demostración y usuarios `admin` y `maestro` |
| `npm run dbf:inspect -- "C:\ruta\a\VENTAS" --rows 5` | Inventaria los DBF de SICAP sin modificarlos |
| `npx tsx scripts/actualizar-empresa-sicap.ts` | Actualiza la empresa con los datos reales de SICAP sin volver a sembrar |
| `npx tsx scripts/beta-local.ts` | Genera XML/ZIP firmados con `firmabeta.pfx` sin red; requiere `BETA_PFX_PASSWORD` o `BETA_PFX_PASSWORD_FILE` |

## Endpoints

- `GET /api/salud`
- `POST /api/autenticacion/login`: credenciales reales contra la tabla `Usuario`. Acepta `password`
  (o `contraseña` por compatibilidad) y devuelve JWT HS256 de 8 h, `expiresAt` y el usuario público.
  5 fallos dentro de 15 min bloquean la cuenta 5 min (`423 ACCOUNT_LOCKED`); una cuenta inactiva
  responde `403 ACCOUNT_INACTIVE` sin consumir intentos.
- `GET /api/autenticacion/me`, `POST /api/autenticacion/logout`: requieren `Authorization: Bearer …`.
  El usuario devuelto incluye `puedeFacturar`.
- `GET/POST /api/usuarios`, `PATCH /api/usuarios/:id`: solo `ADMIN` o `MAESTRO`. Crea cuentas y cambia
  `puedeFacturar` / `activo`. El maestro siempre crea `VENDEDOR` y no puede modificar admins ni maestros.
- `GET /api/auditoria`: solo `ADMIN`. Devuelve la bitácora `Auditoria` con `data` y `pagination`.
  Acepta `usuario`, `modulo`, `accion`, `resultado=OK|ERROR`, `desde`, `hasta` (`AAAA-MM-DD` en hora
  de Lima), `limite` (1–100) y `offset`. El middleware global registra `POST`/`PATCH`/`PUT`/`DELETE`
  con módulo, acción legible, entidad, identificador, método, ruta sin query, HTTP, IP y usuario;
  el login y logout se registran en la ruta pública porque no pasan por ese middleware. Una foto del
  usuario queda en la fila aunque la cuenta se desactive. El campo `detalle` guarda texto JSON con
  solicitud, consulta y respuesta saneadas: `sanitizarDetalle` oculta contraseñas/tokens anidados,
  corta textos largos y evita ciclos. No se guardan contraseñas ni tokens.
- **Todas las rutas `/api/*` requieren el token**; sin él responden `401 UNAUTHORIZED`. Además, salvo
  autenticación, salud y usuarios, exigen acceso a facturación: el maestro y los vendedores sin el flag
  reciben `403 ACCESO_DENEGADO`.
- `GET/POST /api/clientes`
- `GET/POST /api/productos`
- `GET /api/detracciones`: catálogo de 35 códigos y tasas tomado de `DETRACCIONES.DBF` de SICAP
  (`008 MADERA` al 4%, `000` = no aplica). El seed lo deja activo en Neon.
- `GET/POST /api/comprobantes`, `GET /api/comprobantes/:id`
- `GET /api/comprobantes/:id/qr`: devuelve `{ dataUrl }` con el QR PNG del comprobante. Reproduce el
  texto leído de los PDF reales de SICAP (razón social, dirección, RUC, `LIMA` y `Factura No.` con 8
  dígitos, también en boletas). No es un código SUNAT ni un Code128. Se entrega como JSON porque una
  etiqueta `<img>` no puede enviar el token Bearer.
- `GET /api/comprobantes/:id/pdf`: ticket POS 80 (`application/pdf`) con el mismo QR, total en letras,
  detracción cuando aplica y paginación de ítems. El nombre es `SERIE-NUMERO.pdf`; las guías de
  remisión devuelven `400 DATOS_INVALIDOS` porque usan formato A4.
- `GET/POST /api/documentos`, `GET /api/documentos/:id`, `PATCH /api/documentos/:id/estado` y
  `POST /api/documentos/:id/convertir`: cotizaciones (`C001`) y pedidos (`P001`) con importes
  calculados en centavos por el servidor. Los estados son `PENDIENTE`, `APROBADO`, `RECHAZADO` y
  `CONVERTIDO`; solo un documento aprobado se convierte, reutilizando `crearComprobante` y guardando
  la referencia al comprobante. Cada línea admite `productoId` del catálogo o, en su defecto,
  `descripcion` + `precioUnitario` escritos a mano (se guarda con `productoId` nulo) y ambos se
  calculan en centavos. Los documentos con líneas de texto no se pueden convertir: devuelven
  `409 CONFLICTO` con aviso explícito. No se envía nada a SUNAT.
- `GET/POST /api/guias`, `GET /api/guias/:id` y `POST /api/guias/:id/anular`: guías de remisión `T001`
  para traslado de mercadería, con motivo, modalidad, direcciones, ubigeos, peso y productos. Se emiten
  localmente; la anulación exige motivo y conserva `motivoAnulacion`/`anuladoEn`.
  Cotizaciones, pedidos y guías comparten la tabla `Secuencia` (incremento atómico por clave).
- `GET /api/resumenes?tipo=…`, `GET /api/resumenes/:id`, `POST /api/resumenes/diario`,
  `POST /api/resumenes/bajas` y `POST /api/resumenes/:id/reenviar`: resumen diario de boletas
  (`RC001`) y comunicaciones de baja (`RA001`). El resumen toma boletas emitidas/aceptadas del día y
  notas que afectan a boletas que aún no tienen resumen; la baja exige comprobantes anulados y no
  repetidos. Ambos quedan `ACEPTADO` con código `LOCAL-*`, registran `reenvios` y jamás contactan a
  SUNAT ni usan credenciales SOL.
- Emisión con detracción: `POST /api/comprobantes` y `POST /api/ventas/emitir` aceptan el campo
  opcional `detraccionCodigo` (3 dígitos, validado contra el catálogo). El servidor guarda código,
  tasa y monto calculado en centavos sobre el total, lo devuelve en el comprobante y lo anota en el XML
  local cuando el código no es `000`. No genera constancia de depósito ni pago bancario.
- `GET /api/reportes/ventas?desde=…&hasta=…`: totales netos del rango en JSON.
  `GET /api/reportes/ventas/excel?desde=…&hasta=…` descarga un `.xlsx` con cinco hojas y
  `GET /api/reportes/ventas/pdf?desde=…&hasta=…` un A4 apaisado (`842 × 595`) con resumen, por día,
  por tipo, por producto, detalle y pie de página. Ambos binarios usan los mismos filtros y nombre
  `reporte-ventas-DESDE-HASTA.<ext>`; el rango inválido devuelve 400.
- `GET /api/panel/resumen`: además de ventas/comprobantes/clientes del mes, devuelve `ticketPromedio`,
  `igvMes`, `facturasMes`, `boletasMes`, `montoFacturasMes`, `montoBoletasMes` y `montoPendiente`
  para los KPIs del panel.
- `GET /api/configuracion`
- `GET /api/reniec/dni/:dni`, `GET /api/reniec/cee/:cee`, `GET /api/reniec/ruc/:ruc`
- `POST /api/ventas/emitir`: emite una boleta o factura desde el formulario de Ventas; el campo
  `tipo` (`BOLETA` por defecto, o `FACTURA`) decide la serie (`B001` / `F001`). Da de alta el cliente
  (si no existe por número de documento) y los productos (si no existen por código), y reutiliza
  `crearComprobante` para el correlativo, el cálculo y el envío al proveedor configurado. Las facturas
  exigen cliente con RUC. El bloque opcional `detalle` valida tipo de cotización, guía, orden de
  compra, solicitado por, fecha de entrega, forma/fecha de pago y condiciones; se guarda como
  observación del comprobante. La moneda y el tipo de cambio se guardan en columnas propias
  (`Comprobante.moneda` y `Comprobante.tipoCambio`) y el ubigeo del cliente en `Cliente.ubigeo`.
  Cada ítem envía `precioUnitario` e `igv`: esos valores se aplican siempre, incluso si el producto
  ya existía en el catálogo; el catálogo no se modifica.
- Migración expansiva: `scripts/migracion-detalle-venta.sql` registra el `ALTER TABLE` idempotente y
  su rollback. `prisma db push` aplica el mismo cambio sin borrar datos; las filas antiguas quedan con
  `tipoCambio = 1`, `moneda = PEN` y `ubigeo = NULL`.
- Validaciones del endpoint: DNI/CEE/RUC con dígito verificador cuando aplica, correo y teléfono,
  ubigeo de 6 dígitos, fechas reales `AAAA-MM-DD`, entrega no anterior a la emisión, pago obligatorio
  forma de pago `CREDITO`, tipo de cambio en USD, máximo 100 ítems, importes con hasta 2 decimales y
  rangos de cantidad/precio/IGV. Los errores llegan como `DATOS_INVALIDOS` (HTTP 400).

## Autenticación

Las contraseñas se guardan como `scrypt$salt$hash` con HMAC-SHA256 previo (`AUTH_PASSWORD_PEPPER`).
El token es un JWT HS256 firmado con `AUTH_JWT_SECRET` (mínimo 32 caracteres) con issuer/audience
propios y `sub` = id del usuario. El middleware vuelve a consultar al usuario en cada petición, así
que desactivarlo invalida sus tokens vigentes. No se usa librería adicional: todo sale de `node:crypto`.

Roles: `ADMIN` (acceso total), `VENDEDOR` (facturación si `puedeFacturar = true`) y `MAESTRO`
(únicamente crear usuarios y otorgar/quitar acceso a facturación; nunca emite comprobantes). El flag
se consulta en cada petición, así que quitarlo surte efecto aunque el token siga vigente.

Variables del `.env` (ver `.env.example`):

```ini
AUTH_JWT_SECRET="…"          # ≥32 caracteres; rotarlo invalida los tokens
AUTH_PASSWORD_PEPPER="…"     # rotarlo obliga a resetear contraseñas
AUTH_TTL_SECONDS=28800
AUTH_MAX_INTENTOS=5
AUTH_BLOQUEO_MINUTOS=5
AUTH_VENTANA_MINUTOS=15
ADMIN_USUARIO=admin
MAESTRO_USUARIO=maestro
```

Las contraseñas iniciales (`ADMIN_CONTRASENA` y `MAESTRO_CONTRASENA`) se definen solo en el `.env`
del servidor; no se versionan. `npm run db:seed` crea el administrador y el maestro solo si no
existen; no sobrescribe contraseñas cambiadas. La migración equivalente queda registrada en `scripts/migracion-usuarios.sql`.

## Consulta RENIEC / RUC

El formulario de **Ventas** autocompleta cliente, dirección, distrito, provincia, departamento y
ubigeo con `GET /api/reniec/*`. El proveedor es Factiliza y se configura con las mismas variables
que el backend de dojo: `URL_RENIEC`, `TOKEN_CONSULTA_RENIEC` y `TIMEOUT_RENIEC_MS` (30 s por
defecto). El token se lee del `.env` del servidor; nunca se envía al navegador.

- Si faltan variables: `503 RENIEC_NO_CONFIGURADO`.
- Si el documento no tiene formato válido: `400 DATOS_INVALIDOS` (validación local, sin gasto).
- Si el proveedor no devuelve datos: `404 NO_ENCONTRADO`.
- Si el proveedor falla o no responde: `503 RENIEC_ERROR`.

La respuesta se normaliza a un único contrato (`nombre_completo`/`razon_social`,
`direccion_completa`, ubigeo) para que DNI, CEE y RUC se consuman igual en el frontend.

## SUNAT

`src/services/sunat` define una interfaz (`ProveedorSunat`) con tres implementaciones seleccionables
por configuración:

| Proveedor | `SUNAT_PROVEEDOR` | Descripción |
| --- | --- | --- |
| `local.ts` | `local` | Simulador sin red: marca el comprobante como `ACEPTADO` con código `LOCAL`. |
| `apisperu.ts` | `apisperu` | Proveedor anterior: token (`POST /api/v1/auth/token`) y emisión (`POST /api/v2/cpe`). Se conserva intacto. |
| `sunat-direct/` | `direct` | Integración directa: UBL 2.1 + firma XAdES-BES + ZIP + SOAP `sendBill`. |

Con `SUNAT_PROVEEDOR=auto` (valor por defecto) se mantiene el comportamiento histórico: se usa
`apisperu` si tiene credenciales, después `direct` si tiene credenciales SOL y certificado, y si no,
`local`. `SUNAT_MODO=local` también fuerza el simulador mientras el proveedor sea `auto`. El
proveedor activo y su endpoint se ven en `GET /api/configuracion`.

### Integración directa

`src/services/sunat/sunat-direct` implementa el flujo completo:

1. `xml.ts`: Factura (01) y Boleta (03) en UBL 2.1 (`CustomizationID=2.0`), con catálogos SUNAT
   (tipos de documento, unidades e afectación al IGV). Cuando **todas** las líneas son gratuitas
   agrega `cbc:Note languageLocaleID="1002"` con la leyenda "TRANSFERENCIA GRATUITA DE UN BIEN
   Y/O SERVICIO PRESTADO GRATUITAMENTE" y tributa esas líneas con 9996/GRATUITO.
2. `dinero.ts`: recalcula base, IGV y totales en centavos desde las líneas guardadas, sin
   arrastrar decimales binarios. Las líneas gratuitas informan el valor referencial (catálogo 16,
   código 02) sin incluirlo en el importe a pagar.
3. `firma.ts`: firma XAdES-BES con `xml-crypto` + `node-forge` (SHA-256/RSA, referencia al
   documento con transform `enveloped-signature` y referencia a `SignedProperties`). Acepta
   certificado `.pfx` (ruta o base64) o X.509 + llave privada PEM. XAdES es un superconjunto de
   XMLDSig, por lo que la firma sigue siendo válida para SUNAT.
4. `zip.ts`: empaqueta un único `RUC-TT-SERIE-NUMERO.xml` en `RUC-TT-SERIE-NUMERO.zip`.
5. `soap.ts`: envía `sendBill` con WS-Security (UsernameToken) a beta o producción, interpreta
   faults SOAP y extrae/parsea el CDR para obtener código y mensaje.

Variables nuevas (ver `.env.example`): `SUNAT_PROVEEDOR`, `SUNAT_RUC`, `SUNAT_SOL_USUARIO`,
`SUNAT_SOL_PASSWORD`, `SUNAT_CERTIFICATE_PFX_PATH`, `SUNAT_CERTIFICATE_PFX_PASSWORD`,
`SUNAT_CERTIFICATE_PFX_BASE64`, `SUNAT_CERTIFICATE_PEM_PATH`, `SUNAT_PRIVATE_KEY_PEM_PATH`,
`SUNAT_CERTIFICATE_PEM`, `SUNAT_PRIVATE_KEY_PEM`, `SUNAT_CERTIFICATE_PEM_BASE64`,
`SUNAT_PRIVATE_KEY_PEM_BASE64`, `SUNAT_ENDPOINT_BETA`, `SUNAT_ENDPOINT_PRODUCCION` y
`SUNAT_TIMEOUT_MS`.

Para probar sin red, deja `SUNAT_PROVEEDOR=local` y emite desde `POST /api/comprobantes`. Para
inspeccionar el XML/ZIP sin credenciales ni envíos, usa `prepararPaquete(cpe, certificado)` y
`generarXmlCpe(cpe)` exportados desde `src/services/sunat/sunat-direct/index.ts`. Los certificados
de prueba se generan dentro de `test/sunat-direct.test.ts`; no se realizan envíos reales a SUNAT.

El script `scripts/beta-local.ts` hace una prueba intermedia: abre
`MUEBLEJO\CPE\FIRMABETA\firmabeta.pfx`, genera una factura ficticia y deja el `.xml` firmado y el
`.zip` en `BETA_LOCAL_OUT` (por defecto una carpeta temporal). La contraseña se toma solo de
`BETA_PFX_PASSWORD` o `BETA_PFX_PASSWORD_FILE`; nunca se lee la clave del certificado de producción.
`prepararPaquete` no contacta a SUNAT. El `firmabeta.pfx` de SICAP es de 2016-2017; SUNAT beta no
exige certificado registrado ni vigente, así que sirve también para envíos beta reales. En producción
sí se requiere un certificado vigente y registrado en SOL.

Los precios de venta incluyen IGV; `src/services/comprobantes/calcular.ts` deriva la base por
línea trabajando en centavos. El correlativo se reserva con un incremento atómico por serie.

> Estado: la integración directa quedó verificada contra el entorno beta real de SUNAT (factura
> `F001-9` y boleta `B001-11` aceptadas con código `0`). Antes de operar en producción hay que
> validar el certificado vigente, el usuario SOL y las reglas de validación vigentes.

## Archivado de XML, ZIP y CDR

`src/services/almacenamiento/cpe.ts` guarda el paquete generado por el emisor directo en Object
Storage de Neon (API compatible con S3). El repositorio usa un bucket **privado** por defecto:

```ini
NEON_OBJECT_BUCKET=cpe
AWS_ENDPOINT_URL_S3=https://<branch>.storage.c-<n>.us-east-2.aws.neon.tech
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=<token_id de la credencial de Neon>
AWS_SECRET_ACCESS_KEY=<s3_secret_access_key de la credencial de Neon>
```

Las credenciales se leen solo en el backend; nunca se envían al navegador. Si falta alguna variable,
`archivarCpe` devuelve `null` y la emisión continúa sin archivar (se registra en consola si falla).

Llaves deterministas: `cpe/{ruc}/{anio}/{mes}/{serie}-{numero[8]}.xml`, `.zip` y `-cdr.xml`. Las
llaves se guardan en `Comprobante` (`archivoXmlKey`, `archivoZipKey`, `archivoCdrKey`) y el front
ofrece las descargas en el detalle del comprobante:

- `GET /api/comprobantes/:id/archivo/xml`
- `GET /api/comprobantes/:id/archivo/zip`
- `GET /api/comprobantes/:id/archivo/cdr`

La retención legal (5 años o prescripción, el que sea mayor) la controla la aplicación: Neon
guarda las reglas de ciclo de vida y versionado, pero no las ejecuta. Además, los buckets siguen las
ramas de Neon: un `reset` de rama también resetea los objetos, así que los archivos definitivos
deben estar en la rama de producción.

## Legacy

`docs/migracion-sicap.md` documenta el mapeo de los DBF y los hallazgos de la inspección
(campo `_NullFlags`, importes, series y estados).
