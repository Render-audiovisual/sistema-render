const validId = value => Number.isSafeInteger(value) && value > 0 && value <= 2147483647;
export function readMoodboardLocation(search = '') {
  if (typeof search !== 'string') throw new Error('El contexto del moodboard no es válido.');
  const params = new URLSearchParams(search);
  const id = key => {
    const values = params.getAll(key);
    if (!values.length) return null;
    if (values.length !== 1 || !/^[1-9]\d*$/.test(values[0]) || values[0].trim() !== values[0] || !validId(Number(values[0]))) throw new Error(`El parámetro ${key} no es válido.`);
    return Number(values[0]);
  };
  return {boardId:id('board'),clientId:id('cliente'),taskId:id('task')};
}
export function resolveMoodboardBoard(boards, location) {
  if (!Array.isArray(boards) || !location) throw new Error('No se pudo resolver el moodboard.');
  if (location.boardId !== null) {
    if (!validId(location.boardId) || !boards.some(board => board.id === location.boardId)) throw new Error('El moodboard solicitado no está disponible.');
    return location.boardId;
  }
  if (location.clientId !== null) {
    const found = boards.find(board => board.clientes.some(client => client.id === location.clientId));
    if (!found) throw new Error('No hay un moodboard disponible para el cliente solicitado.');
    return found.id;
  }
  return boards[0]?.id ?? null;
}
export function moodboardBoardUrl(currentUrl, boardId) {
  if (!validId(boardId)) throw new Error('El moodboard no es válido.');
  const url = new URL(currentUrl,'https://render.local');
  if (!['http:','https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/moodboards') throw new Error('La URL del moodboard no es válida.');
  url.searchParams.set('board',String(boardId));
  return `${url.pathname}${url.search}${url.hash}`;
}
export function moodboardTaskIntent(location, board, tasks) {
  if (!location || !board || !validId(location.taskId) || !Array.isArray(tasks)) return null;
  if (location.clientId !== null && !board.clientes.some(client => client.id === location.clientId)) return null;
  return tasks.some(task => task.id === location.taskId) ? location.taskId : null;
}
