-- Asignación permanente por marca/feed y formato. No contiene datos financieros.
CREATE TABLE cliente_objetivo_responsables (
  clave TEXT NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('video','carrusel')),
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  actualizado_por TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(clave,tipo,usuario_id)
);
