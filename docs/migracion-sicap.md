# Migración desde SICAP

## Origen

`C:\Users\mauri\Desktop\SICAP\MUEBLEJO\FACTURACIÓN\VENTAS`

| DBF | Destino |
| --- | --- |
| `Clientes.DBF` | `Cliente` |
| `facturas.dbf` / `BOLETAS.DBF` | `Comprobante` + `ComprobanteItem` |
| `pedidos.dbf` | `DocumentoVenta` (`COTIZACION` `C001` / `PEDIDO` `P001`, hoy local) |
| `GuiasRemision.DBF` | `GuiaRemision` (`T001`, hoy local) |
| `DETRACCIONES.DBF` | `Detraccion` (catálogo de 35 códigos y tasas) |
| `Operativo.DBF` | datos de configuración/operación a revisar |
| `USUARIO.DBF` | `Usuario` (hash y JWT propios; las contraseñas históricas no se migran) |
| `UseCodigoUbigeoInei.DBF` | catálogo de ubigeo para el emisor |

## Hallazgos tras inspeccionar los DBF

- Los archivos son Visual FoxPro y traen el campo de sistema `_NullFlags` (tipo `0`). El script
  arma una copia temporal sin ese campo porque `dbffile` no lo soporta; los originales no se
  modifican.
- `Clientes.DBF`: `IDE` (entero), `NOMBRE`, `RUC`, `DIRECCION`, `TELEFONO`, `EMAIL`,
  `DPTMNTO`/`PROVINCIA`/`DISTRITO`/`UBIGEO`, `TIPODOC` (vacío en la muestra). 162 registros.
- `facturas.dbf`: 72 registros; `BOLETAS.DBF`: 438. Campos clave: `FECHA`, `FACTURA` (número),
  `SERIE` (`F001`/`B001`), `RIF` (documento del cliente), `CLIENTE`, `TOTALVENTA`, `SUBTOTAL`,
  `IVA`, `DIRECCION`, `UBIGEO`, `HASHCDR`, `SUNATRESP`.
- **Los importes confirman la regla de precios:** en la muestra `SUBTOTAL = 1288.14`,
  `IVA = 231.86`, `TOTALVENTA = 1520.00`. `SUBTOTAL` es la base sin IGV y `TOTALVENTA` el precio
  final; la app guarda el precio final y deriva la base, tal como ya hace el cálculo.
- `TIPO`/`ESTATUS`/`SENDSUNAT`/`SENSUNAT` son enteros con códigos propios de SICAP; hay que
  levantarlos con el usuario antes de mapear estados.
- También existen `FACTURAS2`, `BOLETAS2`, `CLIENTES2`, `GUARDADAS`, `COTIZACIONES`,
  `DENOCOTIZA`, `DETRACCIONES`, `Empleados`, `EMPLEADOSCTAS`. Las `*2` están vacías; parecen
  respaldos/plantillas.
- El formato impreso de boleta sale de `VENTAS\cpet70.frx` / `cpet70.FRT`: contiene
  `BOLETA DE VENTA ELECTRÓNICA`, `_SerieCPE+" - "+_NroFactura`, condiciones de contado/crédito,
  URL de validación de SUNAT y el bloque de devoluciones. Es la referencia del ticket POS 80
  reproducido en el frontend. `VENTAS\CPEA4.FRX` cubre el formato A4 y `RESTAURANTE\FACTURA.FRX`
  el de restaurante; en `.NET` hay además `RPT_COMPROBANTE*.rpt` dentro de `DLL\Reportes.dll`.
- Los PDF reales en `MUEBLEJO\CPE\PDF` (`10101222221-B001-00000431.PDF`,
  `10101222221-F001-00000084.PDF` y `10101222221-B001-00000567.PDF`) llevan un **QR de texto**, no
  un código SUNAT ni un Code128. Decodificado: razón social, dirección, una línea de dos espacios,
  `RUC: 10101222221`, `LIMA`, otra línea de dos espacios y `Factura No. 00000431` con saltos `CR`.
  SICAP usa `Factura No.` incluso en boletas; `services/comprobantes/qr.ts` conserva esa etiqueta
  tal cual. No se inventó un código de barras porque no hay evidencia de uno en los comprobantes.

## Reglas

1. **No copiar claves internas.** Los `id` nuevos son `cuid()`; se conserva el número de
   documento del cliente y el par `serie + número` del comprobante.
2. **Precios.** Ya confirmado: `TOTALVENTA` incluye IGV y `SUBTOTAL` es la base. Importar
   `TOTALVENTA` como `precioUnitario` (precio final) y dejar que la app calcule base e IGV.
3. **Correlativos.** El `siguiente` de cada `Serie` debe quedar en el último `FACTURA` + 1
   (ej. `F001-40` → siguiente 41). No reiniciar la numeración ya declarada.
4. **Estados.** Los comprobantes históricos se importan como `ACEPTADO`; si `SUNATRESP` está
   vacío, dejar `sunatCodigo` vacío y anotar el caso en `observacion`.
5. **Fechas.** FoxPro guarda `Date` sin zona; interpretar como fecha local de Perú (UTC-5) y
   almacenar a medianoche UTC para no correr el día. `dbffile` ya devuelve `Date` a medianoche
   UTC en la muestra.
6. **Documentos.** `RIF` trae el número sin tipo. Si tiene 11 dígitos, es RUC; con 8, DNI.
   Normalizar a `numeroDocumento` y asignar `tipoDocumento` según la longitud.

## Pasos sugeridos

```powershell
npm run dbf:inspect -- "C:\Users\mauri\Desktop\SICAP\MUEBLEJO\FACTURACIÓN\VENTAS" --rows 5
```

Con el inventario de campos, escribir un importador (`scripts/import-sicap.mjs`) que lea
cada DBF con `dbffile`, normalice y haga `upsert` por documento. Importar clientes y productos
primero, comprobantes después, y verificar contra los totales mensuales de SICAP antes de dar
por cerrada la migración.

## Pendiente de confirmar

- Significado de los códigos `TIPO`, `ESTATUS`, `SENDSUNAT` y `SENSUNAT` con el usuario.
- Si `GuiasRemision.DBF` debe migrarse o solo conservarse como historial.
- Uso real de `Operativo.DBF` y `EMPLEADOSCTAS.DBF` en la operación diaria; el catálogo de
  `DETRACCIONES.DBF` ya se importó, pero falta confirmar si SICAP genera depósitos por comprobante.
- Qué hacer con `COTIZACIONES.DBF`: ya existe `DocumentoVenta` (`C001`/`P001`) para operar en la app,
  pero falta decidir si se importa el historial o solo se conserva como respaldo.
