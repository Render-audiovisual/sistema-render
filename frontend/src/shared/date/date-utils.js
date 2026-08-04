export function getHoyLocalISO() {
  const hoy = new Date();
  const year = hoy.getFullYear();
  const month = String(hoy.getMonth() + 1).padStart(2, "0");
  const day = String(hoy.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function getMesActualISO() {
  const hoy = new Date();
  return `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, "0")}`;
}

export function esDelMesActual(fechaISO) {
  return typeof fechaISO === "string" && fechaISO.startsWith(getMesActualISO());
}

export function getInicioSemanaISO() {
  const hoy = new Date();
  const dia = hoy.getDay();
  const diffLunes = dia === 0 ? -6 : 1 - dia;
  const lunes = new Date(hoy);
  lunes.setDate(hoy.getDate() + diffLunes);
  const year = lunes.getFullYear();
  const month = String(lunes.getMonth() + 1).padStart(2, "0");
  const day = String(lunes.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function esDeEstaSemana(fechaISO) {
  return typeof fechaISO === "string" && fechaISO >= getInicioSemanaISO() && fechaISO <= getHoyLocalISO();
}

export function getGrillaMes(year, month) {
  const primerDia = new Date(year, month, 1);
  const totalDias = new Date(year, month + 1, 0).getDate();
  let offset = primerDia.getDay();
  offset = offset === 0 ? 6 : offset - 1;

  const celdas = [];
  for (let i = 0; i < offset; i += 1) celdas.push(null);
  for (let d = 1; d <= totalDias; d += 1) celdas.push(d);
  while (celdas.length % 7 !== 0) celdas.push(null);

  const semanas = [];
  for (let i = 0; i < celdas.length; i += 7) semanas.push(celdas.slice(i, i + 7));
  return semanas;
}

export function fechaISODesde(year, month, day) {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function sumarDiasISO(fechaISO, dias) {
  const fecha = new Date(`${fechaISO}T00:00:00`);
  fecha.setDate(fecha.getDate() + dias);
  const year = fecha.getFullYear();
  const month = String(fecha.getMonth() + 1).padStart(2, "0");
  const day = String(fecha.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
