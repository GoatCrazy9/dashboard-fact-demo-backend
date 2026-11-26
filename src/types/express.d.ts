declare global {
  namespace Express {
    interface Request {
      authUser?: {
        id: string
        nombre: string
        usuario: string
        rol: string
        puedeFacturar: boolean
      }
    }
  }
}

export {}
