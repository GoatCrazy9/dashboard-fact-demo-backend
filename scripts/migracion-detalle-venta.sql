-- Migración expansiva: agrega columnas sin borrar ni reescribir datos existentes.
-- Ejecutar con: psql "$DATABASE_URL" -f scripts/migracion-detalle-venta.sql
-- Prisma db push aplica el mismo cambio; este archivo queda como registro reversible.

-- Hacia adelante (idempotente)
ALTER TABLE "Cliente" ADD COLUMN IF NOT EXISTS "ubigeo" TEXT;
ALTER TABLE "Comprobante" ADD COLUMN IF NOT EXISTS "tipoCambio" DECIMAL(12, 4) NOT NULL DEFAULT 1;

-- Hacia atrás (solo con autorización explícita: elimina los valores guardados)
-- ALTER TABLE "Comprobante" DROP COLUMN IF EXISTS "tipoCambio";
-- ALTER TABLE "Cliente" DROP COLUMN IF EXISTS "ubigeo";
