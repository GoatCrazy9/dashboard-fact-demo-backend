-- Envío real de guías de remisión al beta de SUNAT. Expansivo: no toma datos existentes.
CREATE TYPE "EstadoGuiaSunat" AS ENUM ('PENDIENTE', 'ACEPTADO', 'RECHAZADO', 'ERROR_ENVIO');

ALTER TABLE "GuiaRemision"
  ADD COLUMN "conductorDocumento" TEXT,
  ADD COLUMN "conductorLicencia" TEXT,
  ADD COLUMN "transportistaRuc" TEXT,
  ADD COLUMN "transportistaRazonSocial" TEXT,
  ADD COLUMN "transportistaRegistroMtc" TEXT,
  ADD COLUMN "estadoSunat" "EstadoGuiaSunat",
  ADD COLUMN "sunatCodigo" TEXT,
  ADD COLUMN "sunatMensaje" TEXT,
  ADD COLUMN "archivoXmlKey" TEXT,
  ADD COLUMN "archivoZipKey" TEXT,
  ADD COLUMN "archivoCdrKey" TEXT,
  ADD COLUMN "enviadoEn" TIMESTAMP(3);

CREATE INDEX "GuiaRemision_estadoSunat_idx" ON "GuiaRemision"("estadoSunat");
