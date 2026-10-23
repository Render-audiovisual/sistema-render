export function normalizePublicationCalendarContext(value = {}) {
  return {
    view: value.view === 'semana' ? 'semana' : 'mes',
    type: ['video', 'carrusel'].includes(value.type) ? value.type : 'todos',
  };
}

export function readPublicationCalendarContext(search) {
  const params = new URLSearchParams(search || '');
  return normalizePublicationCalendarContext({ view: params.get('cal_vista'), type: params.get('cal_tipo') });
}

export function publicationCalendarUrlChanges(context) {
  const { view, type } = normalizePublicationCalendarContext(context);
  return { cal_vista: view === 'mes' ? null : view, cal_tipo: type === 'todos' ? null : type };
}
