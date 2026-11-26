# Proveedor SUNAT en modo local

La demo usa `SUNAT_PROVEEDOR=local` y `SUNAT_MODO=local`. El proveedor simulado no abre conexiones
externas, no lee credenciales SOL y no carga certificados.

## Qué genera

1. XML UBL 2.1 de factura o boleta, con una marca explícita de demostración y sin firma digital.
2. ZIP con un único XML, con el nombre `RUC-TT-SERIE-NUMERO.xml`.
3. CDR simulado en ZIP, con código `0` y un aviso de que no tiene validez tributaria.

El XML, el ZIP y el CDR se archivan en el storage compatible con S3 configurado en el entorno y sus
llaves se guardan en el comprobante. El frontend las ofrece en el detalle:

- `GET /api/comprobantes/:id/archivo/xml`
- `GET /api/comprobantes/:id/archivo/zip`
- `GET /api/comprobantes/:id/archivo/cdr`

## Resúmenes, bajas y guías

- Resumen diario: `LOCAL-RESUMEN`.
- Comunicación de baja: `LOCAL-BAJA`.
- Guías de remisión: desactivadas con `SUNAT_GRE_MODO=desactivado`.

Ninguno de estos flujos envía datos a SUNAT ni genera CDR oficial.

## Otros proveedores

El código conserva las implementaciones `apisperu` y `direct` como referencia técnica, pero no están
activadas en esta demo. Activar `direct` exigiría autorización explícita, credenciales SOL reales,
certificado vigente y series/correlativos verificados; no forma parte de este despliegue.
