const position = (value, length) => Number.isFinite(value) && Number.isInteger(value)
  ? Math.min(length, Math.max(0, value)) : 0;
const separator = (left, right) => left && right && !/[\r\n]$/.test(left) && !/^[\r\n]/.test(right) ? '\n\n' : '';

// Offsets are textarea UTF-16 positions. Never trim or normalize existing text
// or the inserted block; delimit only boundaries which have no newline.
export function insertTaskContentBlock(current, template, start, end) {
  if (typeof current !== 'string' || typeof template !== 'string') throw new TypeError('Task content and template must be strings');
  const from = position(start, current.length);
  const to = Math.max(from, position(end, current.length));
  const prefix = current.slice(0, from), suffix = current.slice(to);
  const inserted = prefix + separator(prefix, template) + template;
  return { value: inserted + separator(template, suffix) + suffix, cursor: inserted.length };
}
