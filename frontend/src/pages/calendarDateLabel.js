const formatters = new Map();
export function calendarDateLabel(day, options) {
  const key = JSON.stringify(Object.entries(options).sort(([a],[b])=>a.localeCompare(b)));
  if (!formatters.has(key)) {
    if (formatters.size >= 8) formatters.clear();
    formatters.set(key,new Intl.DateTimeFormat('es-AR',{timeZone:'UTC',...options}));
  }
  const label=formatters.get(key).format(new Date(`${day}T00:00:00Z`));
  return label.charAt(0).toLocaleUpperCase('es-AR')+label.slice(1);
}
