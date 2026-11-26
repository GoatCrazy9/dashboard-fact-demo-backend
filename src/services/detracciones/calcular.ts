/** Calcula la detracción a partir de un total en centavos y una tasa porcentual del catálogo. */
export function calcularDetraccion(totalCentavos: number, tasaPorcentual: number): number {
  if (!Number.isFinite(totalCentavos) || totalCentavos <= 0) return 0
  if (!Number.isFinite(tasaPorcentual) || tasaPorcentual <= 0) return 0
  const puntos = Math.round(tasaPorcentual * 100)
  return Math.round((totalCentavos * puntos) / 10_000)
}
