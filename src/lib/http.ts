export class HttpError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

export const errores = {
  noEncontrado: (mensaje: string) => new HttpError(404, 'NO_ENCONTRADO', mensaje),
  invalido: (mensaje: string) => new HttpError(400, 'DATOS_INVALIDOS', mensaje),
  conflicto: (mensaje: string) => new HttpError(409, 'CONFLICTO', mensaje),
  sunat: (mensaje: string) => new HttpError(502, 'SUNAT_ERROR', mensaje),
}
