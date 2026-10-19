// Read-only presentation of fields already supplied by the authorized task DTO.
// This does not infer identity, permissions, dates or production records.
function ownValue(record, key) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return undefined;
  return Object.getOwnPropertyDescriptor(record, key)?.value;
}

function textValues(value) {
  const entries = Array.isArray(value) ? value : [value];
  return entries.filter(entry => typeof entry === 'string')
    .map(entry => entry.trim()).filter(Boolean);
}

/** A complete absolute web URL, never an extracted link from prose or markup. */
export function safeMaterialUrl(value) {
  if (typeof value !== 'string' || !/^https?:\/\//i.test(value)
    || /[\s\u0000-\u001f\u007f-\u009f<>"'\\]/.test(value)
    || /%(?:0[0-9a-f]|1[0-9a-f]|7f)/i.test(value)) return null;
  try {
    const url = new URL(value);
    const authority = value.slice(value.indexOf('://') + 3).split(/[/?#]/, 1)[0];
    if (!authority || !['http:', 'https:'].includes(url.protocol) || !url.hostname
      || url.username || url.password || authority.includes('@')) return null;
    return url.href;
  } catch {
    return null;
  }
}

/** Returns closed, display-only rows, or null when no meaningful fields exist. */
export function getRecordedTaskContext(task) {
  const metadata = ownValue(task, 'propiedades_extra');
  const rows = [];
  const append = (key, label, values) => {
    const unique = [...new Set(values)];
    if (unique.length) rows.push({ key, label, values: unique });
  };
  append('material', 'Material registrado', [
    ...textValues(ownValue(metadata, 'material')),
    ...textValues(ownValue(metadata, 'Material')),
  ]);
  for (const [key, label] of [
    ['feedback', 'Feedback registrado'],
    ['motivo_bloqueo', 'Motivo de bloqueo registrado'],
    ['horario', 'Horario registrado'],
  ]) append(key, label, textValues(ownValue(metadata, key)));

  const coordinated = ownValue(metadata, 'coordinada');
  if (typeof coordinated === 'boolean') {
    append('coordinada', 'Coordinación registrada', [coordinated ? 'Sí' : 'No']);
  }
  return rows.length ? rows : null;
}
