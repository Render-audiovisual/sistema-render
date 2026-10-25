// Page-instance memory only. Never shared across sessions or persisted in storage.
export function createPersonalItemDrafts() {
  const drafts = new Map();
  const key = (listId, blockId) => JSON.stringify([String(listId), String(blockId)]);
  return {
    get dirty() { return drafts.size > 0; },
    get(listId, blockId) { return drafts.get(key(listId, blockId))?.text || ''; },
    set(listId, blockId, text) {
      if (typeof text !== 'string') throw new TypeError('Invalid item draft.');
      if (text) drafts.set(key(listId, blockId), { listId: String(listId), text });
      else drafts.delete(key(listId, blockId));
    },
    consume(listId, blockId, text) {
      if (drafts.get(key(listId, blockId))?.text !== text) return false;
      drafts.delete(key(listId, blockId)); return true;
    },
    removeBlock(listId, blockId) { drafts.delete(key(listId, blockId)); },
    removeList(listId) { for (const [id, draft] of drafts) if (draft.listId === String(listId)) drafts.delete(id); },
    clear() { drafts.clear(); },
  };
}
