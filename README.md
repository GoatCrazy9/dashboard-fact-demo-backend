# Demo de facturación · Backend

API Express 5 + TypeScript + Prisma 6 + PostgreSQL. Atiende al frontend de `../dashboard-fact-demo-frontend`, desplegado por separado en Vercel.

> Demo pública. El proveedor SUNAT está en `local`: no hay envíos, credenciales SOL ni certificado. Los XML, ZIP y CDR son simulados y no tienen validez tributaria.

## Puesta en marcha

```powershell
cd dashboard-fact-demo-backend
npm install
Copy-Item .env.example .env   # si aún no existe; completa las variables
npm run db:generate
npm run db:push
npm run db:seed
npm run dev                   # http://localhost:3001
```

`.env` no se versiona. Ahí van la cadena de conexión, los secretos del servidor y las credenciales del storage compatible con S3 que guarda los archivos de la demo.

## Comandos

| Comando | Para qué sirve |
| --- | --- |
| `npm run dev` | Levanta la API con recarga automática |
| `npm run typecheck` | Revisa los tipos |
| `npm test` | Cubre autenticación, permisos, cálculo, XML, ZIP, CDR y validaciones |
| `npm run db:push` | Sincroniza el esquema con la base de datos |
| `npm run db:seed` | Carga datos de demostración, series, detracciones y usuarios `admin`/`maestro` |

El seed se puede repetir sin problemas: no sobrescribe contraseñas que ya se cambiaron. Las iniciales salen solo de `ADMIN_CONTRASENA` y `MAESTRO_CONTRASENA`, definidas en el entorno del servidor.

## Endpoints principales

- `GET /api/salud`: health check público.
- `POST /api/autenticacion/login`, `GET /api/autenticacion/me`, `POST /api/autenticacion/logout`.
- `GET/POST /api/usuarios`, `PATCH /api/usuarios/:id/password`: gestión exclusiva del `MAESTRO`. El `MAESTRO` no puede cambiar contraseñas de cuentas `MAESTRO`, incluida la propia.
- `GET /api/auditoria`: solo `ADMIN` o `MAESTRO`.
- `GET/POST /api/clientes`, `GET/POST /api/productos`, `GET /api/detracciones`.
- `GET/POST /api/comprobantes`, `GET /api/comprobantes/:id`, anulación, notas y reenvío.
- `GET /api/comprobantes/:id/archivo/xml|zip|cdr`: descarga del paquete generado en modo local.
- `GET/POST /api/documentos`: cotizaciones/proformas (`C001`) y pedidos/encargos (`P001`).
- `GET/POST /api/guias`: guías de remisión; desactivadas en el despliegue demo.
- `GET/POST /api/resumenes`: resumen diario (`RC001`) y bajas (`RA001`), siempre locales.
- `GET /api/reportes/ventas`, `/excel` y `/pdf`: respetan los mismos filtros y orden.
- `GET /api/panel/resumen`, `GET /api/configuracion`.
- `POST /api/ventas/emitir`: emite boletas o facturas al contado desde el formulario de Ventas.

Salud y login son públicos; el resto de `/api/*` pide token Bearer. Toda mutación se escribe en `Auditoria`, pero si falla esa escritura la operación sigue adelante.

## Roles

- `ADMIN`: acceso total excepto la gestión de usuarios.
- `MAESTRO`: usuarios, accesos y auditoría. No factura y no puede renovar contraseñas de maestros.
- `VENDEDOR`: factura solo si `puedeFacturar = true`.

## SUNAT en modo local

Con `SUNAT_PROVEEDOR=local` y `SUNAT_MODO=local` entra el proveedor simulado. Genera:

- XML UBL 2.1 sin firma digital, marcado como demostración.
- ZIP con ese XML.
- CDR simulado con código `0` y aviso de que no tiene validez tributaria.

Los resúmenes y bajas quedan como `LOCAL-RESUMEN` / `LOCAL-BAJA`. No se contacta a SUNAT.

## Archivado

El paquete se guarda en un bucket privado compatible con S3. Si falta alguna variable de storage, la emisión continúa pero no habrá descargas. Las llaves quedan registradas en el comprobante:

```ini
NEON_OBJECT_BUCKET=...
AWS_ENDPOINT_URL_S3=...
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
```

Estas credenciales se leen solo en el backend y nunca llegan al navegador. Las llaves son deterministas: `cpe/{ruc}/{anio}/{mes}/{serie}-{numero[8]}.xml`, `.zip` y `-cdr.xml`.

## Variables relevantes

```ini
DATABASE_URL="..."              # cadena pooling, solo en el entorno del servidor
AUTH_JWT_SECRET="..."
AUTH_PASSWORD_PEPPER="..."
ADMIN_USUARIO=admin
MAESTRO_USUARIO=maestro
SUNAT_PROVEEDOR=local
SUNAT_MODO=local
SUNAT_GRE_MODO=desactivado
```

La lista completa está en `.env.example`. Ningún secreto debe copiarse al repositorio.
