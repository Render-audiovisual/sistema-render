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
    req.auth = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ["HS256"] });
    return next();
  } catch {
    return res.status(401).json({ error: "La sesión venció o no es válida." });
  }
}

// JWT claims identify a session, never its current authority. All operational
// routes must reload the account so disabling it or revoking sessions is immediate.
export function requireCurrentIdentity(pool) {
  return async (req, res, next) => {
    const id = req.auth?.id;
    const version = req.auth?.session_version;
    if (!Number.isSafeInteger(id) || id < 1 || !Number.isSafeInteger(version) || version < 1
      || req.auth.iss !== "render" || req.auth.aud !== "render-api"
      || !Number.isSafeInteger(req.auth.exp) || req.auth.exp <= Math.floor(Date.now() / 1000)) {
      return res.status(401).json({ error: "Volvé a iniciar sesión para verificar tu identidad." });
    }
    try {
      const { rows } = await pool.query(
        "SELECT id, usuario, nombre, rol, activo, session_version FROM usuarios WHERE id=$1",
        [id],
      );
      const user = rows[0];
      if (!user || user.activo !== true || Number(user.session_version) !== version) {
        return res.status(401).json({ error: "La sesión fue revocada o el usuario está inactivo." });
      }
      req.auth = { id: user.id, usuario: user.usuario, nombre: user.nombre, rol: user.rol, session_version: version };
      return next();
    } catch (error) {
      // Fail closed: a database outage must not fall back to stale token roles.
      return next(error);
    }
  };
}

export function issueUserToken(user, secret = process.env.JWT_SECRET) {
  if (user?.activo !== true || !Number.isSafeInteger(Number(user.id)) || Number(user.id) < 1
    || !Number.isSafeInteger(Number(user.session_version)) || Number(user.session_version) < 1) {
    throw new Error("No se puede iniciar sesión con esta cuenta.");
  }
  return jwt.sign({ id: Number(user.id), session_version: Number(user.session_version) }, secret,
    { algorithm: "HS256", expiresIn: "8h", issuer: "render", audience: "render-api" });
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.auth || !roles.includes(req.auth.rol)) {
      return res.status(403).json({ error: "No tenés permiso para realizar esta acción." });
    }
    return next();
  };
}
