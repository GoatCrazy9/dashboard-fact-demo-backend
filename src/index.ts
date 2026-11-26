import { env } from './config/env.ts'
import { crearApp } from './app.ts'

const app = crearApp()

app.listen(env.port, () => {
  console.log(`[api] escuchando en http://localhost:${env.port}`)
  if (!env.databaseUrl) {
    console.warn('[api] falta DATABASE_URL en api/.env; Prisma fallará al consultar.')
  }
})
