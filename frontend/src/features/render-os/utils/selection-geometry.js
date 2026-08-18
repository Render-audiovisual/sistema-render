export function normalizeSelectionRect(startX, startY, endX, endY) {
  return {
    left: Math.min(startX, endX),
    top: Math.min(startY, endY),
    right: Math.max(startX, endX),
    bottom: Math.max(startY, endY),
    width: Math.abs(endX - startX),
    height: Math.abs(endY - startY),
  };
}

export function selectionRectsIntersect(first, second) {
  return !(
    first.right < second.left
    || first.left > second.right
    || first.bottom < second.top
    || first.top > second.bottom
  );
}
