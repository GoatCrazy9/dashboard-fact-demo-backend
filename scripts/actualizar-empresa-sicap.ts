import 'dotenv/config'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

// Datos reales tomados de los JSON de emisión de SICAP (CPE/PRODUCCION).
const datos = {
  ruc: '10101222221',
  razonSocial: 'MUEBLERIA JOSE',
  nombreComercial: 'MUEBLERIA JOSE',
  direccion:
    'Av. Angamos Este Nro. 1551 Block 2, 1 Piso Tda 79 C.C. Plaza Hogar - Lima - Lima - Surquillo',
  ubigeo: '150101',
  distrito: 'SAN BORJA',
  provincia: 'LIMA',
  departamento: 'LIMA',
}

const empresa =
  (await prisma.empresa.findUnique({ where: { ruc: datos.ruc } })) ??
  (await prisma.empresa.findFirst())

if (!empresa) throw new Error('No hay empresa en la base de datos; ejecuta db:seed primero.')

await prisma.empresa.update({ where: { id: empresa.id }, data: datos })
console.log(`Empresa ${empresa.ruc} -> ${datos.ruc} (${datos.razonSocial})`)

await prisma.$disconnect()
