-- Ticket de la API REST de GRE. Necesario para recuperar el CDR sin reenviar la guía.
ALTER TABLE "GuiaRemision"
  ADD COLUMN IF NOT EXISTS "sunatTicket" TEXT;
