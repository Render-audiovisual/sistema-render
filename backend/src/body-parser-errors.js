// Parser errors can carry the entire submitted body, including credentials.
// Known client errors need a safe response, not a raw Error/body log.
export function bodyParserErrorResponse(error) {
  if (error?.type === 'entity.parse.failed' && error.status === 400) {
    return { status:400, body:{error:'El cuerpo JSON no es válido.'} };
  }
  if (error?.type === 'entity.too.large' && error.status === 413) {
    return { status:413, body:{error:'La solicitud supera el tamaño permitido.'} };
  }
  return null;
}
