import type { ModalidadGuia } from '@prisma/client'

export const ubigeoValido = (valor?: string | null): boolean =>
  !valor || /^\d{6}$/.test(valor)

export const transportistaValido = (
  modalidad: ModalidadGuia,
  placa?: string | null,
  conductor?: string | null,
): boolean => modalidad !== 'PUBLICO' || Boolean(placa?.trim() && conductor?.trim())

/** El conductor debe identificarse con documento y licencia para una GRE pública. */
export const conductorGuiaValido = (
  modalidad: ModalidadGuia,
  documento?: string | null,
  licencia?: string | null,
): boolean => modalidad !== 'PUBLICO' || Boolean(documento?.trim() && licencia?.trim())

/** Si se declara transportista público, SUNAT exige razón social y registro MTC. */
export const datosTransportistaValidos = (
  ruc?: string | null,
  razonSocial?: string | null,
  registroMtc?: string | null,
): boolean => !ruc?.trim() || Boolean(razonSocial?.trim() && registroMtc?.trim())
