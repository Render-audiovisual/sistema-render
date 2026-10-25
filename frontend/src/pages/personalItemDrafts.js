// Page-instance memory only. Never shared across sessions or persisted in storage.
export function createPersonalItemDrafts() {
  const drafts = new Map();
  const submitting = new Set();
  const key = (listId, blockId) => JSON.stringify([String(listId), String(blockId)]);
  return {
    get dirty() { return drafts.size > 0; },
    get(listId, blockId) { return drafts.get(key(listId, blockId))?.text || ''; },
    token(listId, blockId) { return drafts.get(key(listId, blockId))?.token; },
    set(listId, blockId, text) {
      if (typeof text !== 'string') throw new TypeError('Invalid item draft.');
      if (text) drafts.set(key(listId, blockId), { listId: String(listId), text, token: Object.freeze({}) });
      else drafts.delete(key(listId, blockId));
    },
    consume(listId, blockId, text) {
      if (drafts.get(key(listId, blockId))?.text !== text) return false;
      drafts.delete(key(listId, blockId)); return true;
    },
    submit(listId, blockId, token, write) {
      const id = key(listId, blockId), draft = drafts.get(id);
      if (!draft || draft.token !== token || submitting.has(id) || !draft.text.trim()) return false;
      submitting.add(id);
      try {
        if (write(draft.text) !== true) return false;
        if (drafts.get(id) === draft) drafts.delete(id);
        return true;
      } finally { submitting.delete(id); }
    },
    removeBlock(listId, blockId) { drafts.delete(key(listId, blockId)); },
    removeList(listId) { for (const [id, draft] of drafts) if (draft.listId === String(listId)) drafts.delete(id); },
    clear() { drafts.clear(); },
  };
}
