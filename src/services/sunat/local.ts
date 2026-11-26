import type { ProveedorSunat } from './types.ts'

/**
 * Proveedor de desarrollo: no sale a internet. Deja el comprobante como aceptado
 * para poder probar el flujo completo sin credenciales de SUNAT.
 */
export const proveedorLocal: ProveedorSunat = {
  nombre: 'local',

  async enviar() {
    return {
      estado: 'ACEPTADO' as const,
      codigo: 'LOCAL',
      mensaje: 'Modo de prueba: el comprobante no se envió a SUNAT.',
      uuid: null,
    }
  },
}
