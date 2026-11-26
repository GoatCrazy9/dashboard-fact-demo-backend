/** Fechas de los formularios: AAAA-MM-DD, interpretadas como medianoche UTC. */
export const fechaValida = (valor: string): boolean => {
  const fecha = new Date(`${valor}T00:00:00.000Z`)
  return !Number.isNaN(fecha.getTime()) && fecha.toISOString().slice(0, 10) === valor
}

export const aFecha = (valor: string): Date => new Date(`${valor}T00:00:00.000Z`)
