import jwt from "jsonwebtoken";

export function requireAuthentication(req, res, next) {
  const authorization = req.get?.("authorization") || req.headers?.authorization || "";
  const [scheme, token] = authorization.split(/\s+/, 2);

  if (scheme?.toLowerCase() !== "bearer" || !token) {
    return res.status(401).json({ error: "Necesitás iniciar sesión." });
  }
  if (!process.env.JWT_SECRET) {
    return res.status(503).json({ error: "La autenticación no está configurada." });
  }

  try {
    req.auth = jwt.verify(token, process.env.JWT_SECRET);
    return next();
  } catch {
    return res.status(401).json({ error: "La sesión venció o no es válida." });
  }
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.auth || !roles.includes(req.auth.rol)) {
      return res.status(403).json({ error: "No tenés permiso para realizar esta acción." });
    }
    return next();
  };
}
