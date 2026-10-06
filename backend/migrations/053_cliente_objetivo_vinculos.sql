-- Auditoría de reemplazos manuales. No elimina ni modifica ninguna tarea.
CREATE TABLE IF NOT EXISTS cliente_objetivo_vinculos (
  id BIGSERIAL PRIMARY KEY,
  pieza_id INTEGER NOT NULL REFERENCES cliente_objetivo_piezas(id),
  tarea_anterior_id INTEGER,
  tarea_nueva_id INTEGER NOT NULL,
  registro_anterior JSONB NOT NULL,
  actualizado_por TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cliente_objetivo_vinculos_pieza ON cliente_objetivo_vinculos(pieza_id);
