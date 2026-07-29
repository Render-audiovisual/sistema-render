import jwt from "jsonwebtoken";

export function crearAutenticador(secret = process.env.JWT_SECRET) {
  return function autenticar(req, res, next) {
    const authorization = req.get("authorization") || "";
    const [, token] = authorization.match(/^Bearer\s+(.+)$/i) || [];

    if (!token) {
      return res.status(401).json({ error: "Falta token de acceso." });
    }

    if (!secret) {
      return res
        .status(503)
        .json({ error: "La seguridad del servidor no está configurada." });
    }

    try {
      req.usuario = jwt.verify(token, secret);
      return next();
    } catch {
      return res.status(401).json({ error: "Sesión inválida o vencida." });
    }
  };
}

export function requiereRoles(...rolesPermitidos) {
  return function autorizarRol(req, res, next) {
    if (!rolesPermitidos.includes(req.usuario?.rol)) {
      return res.status(403).json({ error: "No tenés permiso para esta acción." });
    }
    return next();
  };
}

export function autenticar(req, res, next) {
  return crearAutenticador(process.env.JWT_SECRET)(req, res, next);
}

export const requiereAdmin = requiereRoles("admin");
