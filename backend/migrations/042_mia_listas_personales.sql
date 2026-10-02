ALTER TABLE usuarios
  ADD COLUMN IF NOT EXISTS whatsapp_id_hash CHAR(64),
  ADD COLUMN IF NOT EXISTS whatsapp_habilitado BOOLEAN NOT NULL DEFAULT TRUE;

CREATE UNIQUE INDEX IF NOT EXISTS idx_usuarios_whatsapp_id_hash
  ON usuarios (whatsapp_id_hash)
  WHERE whatsapp_id_hash IS NOT NULL;

-- Vincula las cuentas que Mía ya reconocía sin guardar teléfonos en texto plano.
UPDATE usuarios SET whatsapp_id_hash='778f6cd718a5c563208520131273c07812deaa72272a9d8a4503383a1eb4bfd2'
 WHERE whatsapp_id_hash IS NULL AND (lower(usuario) IN ('agus','agustin','líder','lider') OR lower(nombre) LIKE 'agustín%' OR lower(nombre) LIKE 'agustin%');
UPDATE usuarios SET whatsapp_id_hash='6dcb148275f19084819c4428ce778efde4141d5e42d16ce95aacbec52f88e36a'
 WHERE whatsapp_id_hash IS NULL AND (lower(usuario)='franco' OR lower(nombre) LIKE 'franco altamirano%');
UPDATE usuarios SET whatsapp_id_hash='919b2d579ce977f7814bf24d754e6fa9d561d25c61ee06e7683a372cd566ee7e'
 WHERE whatsapp_id_hash IS NULL AND (lower(usuario)='augusto' OR lower(nombre) LIKE 'augusto%');
UPDATE usuarios SET whatsapp_id_hash='5028709cf82d1cc48f174b565e3ca8bf07efb7ccc3e20d2a713dc88bd9957819'
 WHERE whatsapp_id_hash IS NULL AND (lower(usuario)='german' OR lower(nombre) LIKE 'germán%' OR lower(nombre) LIKE 'german%');
UPDATE usuarios SET whatsapp_id_hash='571fe5c68e0b986e380c466bffe5ec2e283c7d812a2717fe243fbff366a58a46'
 WHERE whatsapp_id_hash IS NULL AND (lower(usuario) IN ('luciano','milton') OR lower(nombre) LIKE 'luciano%');
UPDATE usuarios SET whatsapp_id_hash='f1e60232f9cb2d8abc631090c963c389fc46d83e1ffae025e1342182bdce29d1'
 WHERE whatsapp_id_hash IS NULL AND (lower(usuario)='mariano' OR lower(nombre) LIKE 'mariano%');
UPDATE usuarios SET whatsapp_id_hash='2e945d6cb00e0f5f616176c007825af691f1398ead3e12787800bd8e6c6968c6'
 WHERE whatsapp_id_hash IS NULL AND (lower(usuario)='oriana' OR lower(nombre) LIKE 'oriana%');
UPDATE usuarios SET whatsapp_id_hash='9047d18e25d15cdd650813a3f1c23bc3f84595be2bd91d1bc189d8f957d01a35'
 WHERE whatsapp_id_hash IS NULL AND (lower(usuario)='ana' OR lower(nombre) LIKE 'ana may%');

CREATE TABLE IF NOT EXISTS mia_lista_propuestas (
  token UUID PRIMARY KEY,
  actor_id_hash CHAR(64) NOT NULL,
  solicitante_usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  objetivo_usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  operacion TEXT NOT NULL CHECK (operacion IN ('crear','editar','completar','reabrir','eliminar','recordar','reprogramar_recordatorio','cancelar_recordatorio')),
  payload JSONB NOT NULL,
  resumen TEXT NOT NULL,
  used_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mia_lista_propuestas_pendientes
  ON mia_lista_propuestas (actor_id_hash, objetivo_usuario_id, created_at DESC)
  WHERE used_at IS NULL AND cancelled_at IS NULL;

CREATE TABLE IF NOT EXISTS lista_recordatorios_personales (
  id BIGSERIAL PRIMARY KEY,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  lista_id BIGINT NOT NULL REFERENCES listas_personales(id) ON DELETE CASCADE,
  bloque_id BIGINT NOT NULL REFERENCES lista_bloques(id) ON DELETE CASCADE,
  item_uid TEXT NOT NULL,
  texto TEXT NOT NULL,
  proximo_envio_at TIMESTAMPTZ NOT NULL,
  repeticion TEXT NOT NULL DEFAULT 'una_vez' CHECK (repeticion IN ('una_vez','diario','dias_habiles','semanal','cada_n_dias')),
  intervalo_dias INTEGER CHECK (intervalo_dias IS NULL OR intervalo_dias BETWEEN 1 AND 365),
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  ultimo_envio_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (usuario_id, bloque_id, item_uid)
);

CREATE INDEX IF NOT EXISTS idx_lista_recordatorios_vencidos
  ON lista_recordatorios_personales (proximo_envio_at)
  WHERE activo IS TRUE;

CREATE TABLE IF NOT EXISTS mia_lista_auditoria (
  id BIGSERIAL PRIMARY KEY,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  actor_usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  operacion TEXT NOT NULL,
  lista_id BIGINT,
  bloque_id BIGINT,
  item_uid TEXT,
  detalles JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
