/**
 * Catálogo tomado de SICAP `VENTAS\DETRACCIONES.DBF` (35 registros).
 * `008 MADERA` es el código propio de la mueblería; `000` significa "no aplica".
 */
export interface DetraccionCatalogo {
  codigo: string
  nombre: string
  tasa: number
}

export const DETRACCIONES: DetraccionCatalogo[] = [
  { codigo: '000', nombre: 'NO APLICA', tasa: 0 },
  { codigo: '001', nombre: 'AZUCAR Y MELAZA DE CAÑA', tasa: 10 },
  { codigo: '002', nombre: 'ARROZ', tasa: 4 },
  { codigo: '003', nombre: 'ALCOHOL ETILICO', tasa: 10 },
  { codigo: '004', nombre: 'RECURSOS HIDROBIOLOGICOS', tasa: 4 },
  { codigo: '005', nombre: 'MAIZ AMARILLO DURO', tasa: 4 },
  { codigo: '007', nombre: 'CAÑA DE AZUCAR', tasa: 10 },
  { codigo: '008', nombre: 'MADERA', tasa: 4 },
  { codigo: '009', nombre: 'ARENA Y PIEDRA', tasa: 10 },
  {
    codigo: '010',
    nombre: 'RESIDUOS, SUBPRODUCTOS, DESECHOS, RECORTES Y DESPERDICIOS',
    tasa: 15,
  },
  {
    codigo: '011',
    nombre: 'BIENES GRAVADOS CON EL IGV, O RENUNCIA A LA EXONERACION',
    tasa: 10,
  },
  { codigo: '012', nombre: 'INTERMEDIACION LABORAL Y TERCERIZACION', tasa: 10 },
  { codigo: '013', nombre: 'ANIMALES VIVOS', tasa: 10 },
  { codigo: '014', nombre: 'CARNES Y DESPOJOS COMESTIBLES', tasa: 4 },
  { codigo: '015', nombre: 'ABONOS, CUEROS Y PIELES DE ORIGEN ANIMAL', tasa: 10 },
  { codigo: '016', nombre: 'ACEITE DE PESCADO', tasa: 10 },
  {
    codigo: '017',
    nombre:
      'HARINA, POLVO Y PELLET DE PESCADO, CRUSTACEOS, MOLUSCOS Y DEMAS INVERTEBRADOS ACUATICOS',
    tasa: 4,
  },
  { codigo: '019', nombre: 'ARRENDAMIENTO DE BIENES MUEBLES', tasa: 10 },
  { codigo: '020', nombre: 'MANTENIMIENTO Y REPARACION DE BIENES MUEBLES', tasa: 12 },
  { codigo: '021', nombre: 'MOVIMIENTO DE CARGA', tasa: 10 },
  { codigo: '022', nombre: 'OTROS SERVICIOS EMPRESARIALES', tasa: 12 },
  { codigo: '023', nombre: 'LECHE', tasa: 4 },
  { codigo: '024', nombre: 'COMISION MERCANTIL', tasa: 10 },
  { codigo: '025', nombre: 'FABRICACION DE BIENES POR ENCARGO', tasa: 10 },
  { codigo: '026', nombre: 'SERVICIO DE TRANSPORTE DE PERSONAS', tasa: 10 },
  { codigo: '027', nombre: 'SERVICIO DE TRANSPORTE DE CARGA', tasa: 4 },
  { codigo: '028', nombre: 'TRANSPORTE DE PASAJEROS', tasa: 4 },
  { codigo: '030', nombre: 'CONTRATOS DE CONSTRUCCION', tasa: 4 },
  { codigo: '031', nombre: 'ORO GRAVADO CON EL IGV', tasa: 10 },
  { codigo: '034', nombre: 'MINERALES METALICOS NO AURIFEROS', tasa: 10 },
  { codigo: '035', nombre: 'BIENES EXONERADOS DEL IGV', tasa: 1.5 },
  {
    codigo: '036',
    nombre: 'ORO Y DEMAS MINERALES METALICOS EXONERADOS DEL IGV',
    tasa: 1.5,
  },
  { codigo: '037', nombre: 'DEMAS SERVICIOS GRAVADOS CON EL IGV', tasa: 10 },
  { codigo: '039', nombre: 'MINERALES NO METALICOS', tasa: 10 },
  { codigo: '040', nombre: 'BIEN INMUEBLE GRAVADO CON IGV', tasa: 4 },
]

const POR_CODIGO = new Map(DETRACCIONES.map((detraccion) => [detraccion.codigo, detraccion]))

export function buscarDetraccion(codigo: string | null | undefined): DetraccionCatalogo | null {
  return (codigo && POR_CODIGO.get(codigo.trim())) || null
}
