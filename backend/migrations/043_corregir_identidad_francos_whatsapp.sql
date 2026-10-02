-- Franco Altamirano y Agustín representan la cuenta operativa "lider".
-- Franco Romero es otra persona y nunca debe heredar el hash del dueño por
-- coincidir su usuario con la palabra "franco".
UPDATE usuarios
SET whatsapp_id_hash=NULL
WHERE whatsapp_id_hash='6dcb148275f19084819c4428ce778efde4141d5e42d16ce95aacbec52f88e36a'
  AND lower(usuario) <> 'lider'
  AND rol <> 'admin';
