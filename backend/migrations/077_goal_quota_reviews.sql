-- Operational quota audit only. Existing slots/tasks/links/history are retained.
CREATE TABLE cliente_objetivo_cuota_revisiones (
  id BIGSERIAL PRIMARY KEY,
  objetivo_id INTEGER NOT NULL REFERENCES cliente_objetivos_mensuales(id) ON DELETE RESTRICT,
  actor_user_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
  reels_antes INTEGER NOT NULL CHECK(reels_antes BETWEEN 0 AND 100),
  carruseles_antes INTEGER NOT NULL CHECK(carruseles_antes BETWEEN 0 AND 100),
  reels_despues INTEGER NOT NULL CHECK(reels_despues BETWEEN 0 AND 100),
  carruseles_despues INTEGER NOT NULL CHECK(carruseles_despues BETWEEN 0 AND 100),
  source_fingerprint TEXT NOT NULL CHECK(length(source_fingerprint)=64 AND source_fingerprint ~ '^[a-f0-9]{64}$'),
  committed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX cliente_objetivo_cuota_revisiones_objetivo_idx ON cliente_objetivo_cuota_revisiones(objetivo_id);
CREATE INDEX cliente_objetivo_cuota_revisiones_actor_idx ON cliente_objetivo_cuota_revisiones(actor_user_id);
