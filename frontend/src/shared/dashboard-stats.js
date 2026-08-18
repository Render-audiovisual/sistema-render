const normalizeName = (value) => String(value || "")
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .trim()
  .toLowerCase();

export function calculateActiveClientsCompliance(clients = []) {
  const eligible = clients.filter((client) => client.activo !== false && client.porcentajes);
  if (eligible.length === 0) return 0;
  return Math.round(
    eligible.reduce((sum, client) => sum + Number(client.porcentajes.objetivo || 0), 0)
      / eligible.length,
  );
}

export function isTaskAssignedToPerson(task = {}, person = "") {
  return normalizeName(task.asignado_a).split(" ")[0] === normalizeName(person).split(" ")[0];
}
