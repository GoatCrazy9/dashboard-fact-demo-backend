-- Migración expansiva: crea la tabla de usuarios sin tocar los datos existentes.
-- Ejecutar con: psql "$DATABASE_URL" -f scripts/migracion-usuarios.sql
-- Prisma db push aplica el mismo cambio; este archivo queda como registro reversible.

-- Hacia adelante (idempotente)
DO $$
BEGIN
  CREATE TYPE "RolUsuario" AS ENUM ('ADMIN', 'VENDEDOR');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

CREATE TABLE IF NOT EXISTS "Usuario" (
  "id" TEXT NOT NULL,
  "usuario" TEXT NOT NULL,
  "nombre" TEXT NOT NULL,
  "passwordHash" TEXT NOT NULL,
  "rol" "RolUsuario" NOT NULL DEFAULT 'VENDEDOR',
  "activo" BOOLEAN NOT NULL DEFAULT true,
  "intentosFallidos" INTEGER NOT NULL DEFAULT 0,
  "ultimoFalloEn" TIMESTAMP(3),
  "bloqueadoHasta" TIMESTAMP(3),
  "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Usuario_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Usuario_usuario_key" ON "Usuario"("usuario");

-- Segunda pasada: rol maestro y permiso de acceso a facturación.
ALTER TYPE "RolUsuario" ADD VALUE IF NOT EXISTS 'MAESTRO';
ALTER TABLE "Usuario" ADD COLUMN IF NOT EXISTS "puedeFacturar" BOOLEAN NOT NULL DEFAULT true;

-- Hacia atrás (solo con autorización explícita: elimina cuentas y su historial de intentos)
-- ALTER TABLE "Usuario" DROP COLUMN IF EXISTS "puedeFacturar";
-- DROP TABLE IF EXISTS "Usuario";
-- DROP TYPE IF EXISTS "RolUsuario";
