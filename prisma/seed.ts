import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { env } from '../src/config/env.ts'
import { hashContrasena } from '../src/lib/auth.ts'
import { DETRACCIONES } from '../src/services/detracciones/catalogo.ts'

const prisma = new PrismaClient()

// Datos ficticios exclusivos del demo público; sin relación con DEMO.
const empresa = {
  ruc: process.env.EMPRESA_RUC ?? '20000000001',
  razonSocial: process.env.EMPRESA_RAZON_SOCIAL ?? 'DEMO COMERCIAL SAC',
  nombreComercial: process.env.EMPRESA_NOMBRE_COMERCIAL ?? 'DEMO COMERCIAL',
  direccion:
    process.env.EMPRESA_DIRECCION ??
    'Av. Demostracion 123, Lima - Lima - Lima',
  ubigeo: process.env.EMPRESA_UBIGEO ?? '150101',
  distrito: 'LIMA',
  provincia: 'LIMA',
  departamento: 'LIMA',
}

const clientes = [
  {
    tipoDocumento: 'DNI',
    numeroDocumento: '00000001',
    razonSocial: 'CLIENTE DEMO UNO',
    direccion: 'Av. Demo 100, Lima',
    telefono: '900000001',
  },
  {
    tipoDocumento: 'RUC',
    numeroDocumento: '20000000002',
    razonSocial: 'EMPRESA DEMO DOS SAC',
    direccion: 'Av. Demo 200, Lima',
    telefono: '900000002',
  },
  {
    tipoDocumento: 'DNI',
    numeroDocumento: '00000003',
    razonSocial: 'CLIENTE DEMO TRES',
    direccion: 'Av. Demo 300, Lima',
    telefono: '900000003',
  },
]

const productos = [
  {
    codigo: 'DEM-001',
    descripcion: 'Producto de demostración A',
    unidad: 'NIU',
    precioUnitario: '100.00',
    afectoIgv: true,
    stock: 20,
  },
  {
    codigo: 'DEM-002',
    descripcion: 'Producto de demostración B',
    unidad: 'NIU',
    precioUnitario: '250.00',
    afectoIgv: true,
    stock: 15,
  },
  {
    codigo: 'DEM-003',
    descripcion: 'Servicio de demostración',
    unidad: 'ZZ',
    precioUnitario: '50.00',
    afectoIgv: true,
    stock: 0,
  },
]

async function main() {
  const existente = await prisma.empresa.findFirst()
  if (existente) {
    await prisma.empresa.update({ where: { id: existente.id }, data: empresa })
  } else {
    await prisma.empresa.create({ data: empresa })
  }

  const usuarioAdmin = (process.env.ADMIN_USUARIO ?? 'admin').trim().toLowerCase()
  const contrasenaAdmin = process.env.ADMIN_CONTRASENA ?? ''
  if (!contrasenaAdmin || contrasenaAdmin.length < 8) {
    throw new Error('ADMIN_CONTRASENA debe tener al menos 8 caracteres.')
  }
  const admin = await prisma.usuario.findUnique({ where: { usuario: usuarioAdmin } })
  if (!admin) {
    await prisma.usuario.create({
      data: {
        usuario: usuarioAdmin,
        nombre: 'Administrador',
        passwordHash: await hashContrasena(contrasenaAdmin, env.authPasswordPepper),
        rol: 'ADMIN',
        puedeFacturar: true,
      },
    })
  }

  const usuarioMaestro = (process.env.MAESTRO_USUARIO ?? 'maestro').trim().toLowerCase()
  const contrasenaMaestro = process.env.MAESTRO_CONTRASENA ?? ''
  if (!contrasenaMaestro || contrasenaMaestro.length < 8) {
    throw new Error('MAESTRO_CONTRASENA debe tener al menos 8 caracteres.')
  }
  const maestro = await prisma.usuario.findUnique({ where: { usuario: usuarioMaestro } })
  if (!maestro) {
    await prisma.usuario.create({
      data: {
        usuario: usuarioMaestro,
        nombre: 'Maestro',
        passwordHash: await hashContrasena(contrasenaMaestro, env.authPasswordPepper),
        rol: 'MAESTRO',
        puedeFacturar: false,
      },
    })
  }

  for (const [tipo, serie] of [
    ['FACTURA', 'F001'],
    ['BOLETA', 'B001'],
  ] as const) {
    await prisma.serie.upsert({
      where: { tipo_serie: { tipo, serie } },
      update: {},
      create: { tipo, serie, siguiente: 1 },
    })
  }

  for (const cliente of clientes) {
    await prisma.cliente.upsert({
      where: { numeroDocumento: cliente.numeroDocumento },
      update: { razonSocial: cliente.razonSocial, direccion: cliente.direccion },
      create: cliente,
    })
  }

  for (const producto of productos) {
    await prisma.producto.upsert({
      where: { codigo: producto.codigo },
      update: { descripcion: producto.descripcion, precioUnitario: producto.precioUnitario },
      create: producto,
    })
  }

  for (const detraccion of DETRACCIONES) {
    await prisma.detraccion.upsert({
      where: { codigo: detraccion.codigo },
      update: { nombre: detraccion.nombre, tasa: detraccion.tasa.toFixed(2), activo: true },
      create: {
        codigo: detraccion.codigo,
        nombre: detraccion.nombre,
        tasa: detraccion.tasa.toFixed(2),
      },
    })
  }

  console.log(
    `Seed listo: empresa ${empresa.ruc}, ${clientes.length} clientes, ${productos.length} productos, ${DETRACCIONES.length} detracciones, usuarios ${usuarioAdmin} y ${usuarioMaestro}.`,
  )
}

main()
  .catch((error) => {
    console.error('Falló el seed:', error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
