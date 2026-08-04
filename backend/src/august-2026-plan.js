const PERIOD = "2026-08";
const BATCH = "plan_agosto_2026";

const REELS = [
  [1, "RPM Chevrolet", 4], [2, "iPhone Shop", 8], [3, "Luzin", 8],
  [4, "Moketa", 4], [5, "Lavalle Hortícola", 8], [6, "Lavalle Market", 8],
  [7, "El Ángel Azul Turismo", 4], [8, "El Ángel Azul Estudiantil", 4],
  [9, "Litoral Maq", 8], [10, "Búnker Training", 4], [11, "Bendita", 4],
  [12, "Bohle", 6], [13, "Capital Motos", 6],
];

const REF = {
  eaat1: "https://www.instagram.com/p/DbHLfQJP_nl/?igsh=N3Bpc3lqb3N5eGgy",
  eaat2: "https://www.instagram.com/p/Da1eV2mljQg/?img_index=4&igsh=MWg5c2d5d3g5M3B2eg==",
  eaat3: "https://www.instagram.com/p/Da8D_iBjffZ/?img_index=2&igsh=MTlneXVwZDhocmNvZA==",
  eaat4: "https://www.instagram.com/p/Davn0D_CoOx/?igsh=Y29ocm92OXIzNHpj",
  bendita2: "https://www.instagram.com/p/DYaRdaWjugh/?img_index=2&igsh=ZjNtMWc0anhtMmo0",
  bendita3: "https://www.instagram.com/p/Da5Rn6KDMv7/?igsh=MTF4NHQ0bmp5bDJkcw==",
  bendita4: "https://www.instagram.com/p/DZZrmO-DniP/?igsh=dnludGh0MjNxeW0y",
  eaae1: "https://www.instagram.com/p/DbHHtIhD_-3/?img_index=9&igsh=ajh5djY5dmQ0MWM3",
  eaae2: "https://www.instagram.com/p/Da1BAMjD8Fr/?img_index=6&igsh=ZjdkZjFlaWpncTFl",
  eaae3: "https://www.instagram.com/p/DbB25TUkYO5/?img_index=5&igsh=MTcwZThlbzV6cTUzZA==",
};

const CARRUSELES = [
  { clientId: 7, client: "El Ángel Azul Turismo", assignee: "Augusto", ideas: [
    ["Portada con el meme de la referencia. Después, sumar 3 placas con 3 viajes diferentes. Total: 4 placas.", REF.eaat1],
    ["Adaptar esta idea usando los paquetes de la empresa. Cada destino debe mostrar una foto, el nombre y el precio. Cerrar con un CTA a WhatsApp.", REF.eaat2],
    ["Adaptar esta referencia con fotos de Juliana y mostrar 3 viajes diferentes.", REF.eaat3],
    ["Crear una portada y sumar 3 destinos. En cada destino debe aparecer una foto, el precio y el nombre.", REF.eaat4],
  ] },
  { clientId: 5, client: "Lavalle Hortícola", assignee: "Augusto", ideas: Array(4).fill(["", ""]) },
  { clientId: 9, client: "Litoral Maq", assignee: "Augusto", ideas: Array(2).fill(["", ""]) },
  { clientId: 11, client: "Bendita", assignee: "Augusto", ideas: [
    ["Slider de fotos con hamburguesa, personas comiendo, carne, plancha, mayonesa, pan, local y personas.", ""],
    ["Comunicar 15% OFF.", REF.bendita2],
    ["Adaptar la referencia indicada para el carrusel.", REF.bendita3],
    ["Adaptar la referencia indicada para el carrusel.", REF.bendita4],
  ] },
  { clientId: 4, client: "Moketa", assignee: "Augusto", ideas: Array(4).fill(["", ""]) },
  { clientId: 1, client: "RPM Chevrolet", assignee: "Mariano", ideas: [
    ["Entregas reales de PV.", ""],
    ["Slider de fotos del Sonic, con textos y CTA al final.", ""],
    ["", ""], ["", ""],
  ] },
  { clientId: 8, client: "El Ángel Azul Estudiantil", assignee: "Mariano", ideas: [
    ["Photo dump de primaria con diseño básico. Destacar Pekos.", REF.eaae1],
    ["Photo dump de secundaria con diseño básico. Destacar todas las excursiones con nieve.", REF.eaae2],
    ["La noche. Diseño básico con fotos de toda la noche, comunicando sus diferentes temáticas.", REF.eaae3],
    ["", ""],
  ] },
  { clientId: 10, client: "Búnker Training", assignee: "Mariano", ideas: [
    ["Slider con fotos de todas las clases. Buscar un enfoque artístico y jugar con fotos en blanco y negro.", ""],
    ["Slider de las sucursales. Incluir una foto de cada sucursal y otra de alguien entrenando allí. Total: 8 fotos.", ""],
  ] },
  { clientId: 3, client: "Luzin", assignee: "Mariano", ideas: Array(4).fill(["", ""]) },
  { clientId: 2, client: "iPhone Shop", assignee: "Mariano", ideas: Array(4).fill(["", ""]) },
];

export function augustPublishingDates() {
  const dates = [];
  for (let day = 5; day <= 31; day += 1) {
    const date = new Date(Date.UTC(2026, 7, day));
    if (date.getUTCDay() !== 0) dates.push(`2026-08-${String(day).padStart(2, "0")}`);
  }
  return dates;
}

function distribute(groups) {
  const dates = augustPublishingDates();
  const totalLoad = new Map(dates.map((date) => [date, 0]));
  const assigneeLoad = new Map();
  const rows = [];
  for (const group of groups) {
    const usedByClient = new Set();
    for (let index = 0; index < group.count; index += 1) {
      const target = group.count === 1 ? Math.floor(dates.length / 2) : Math.round(index * (dates.length - 1) / (group.count - 1));
      const ranked = dates.map((date, dateIndex) => {
        const key = `${group.assignee}|${date}`;
        const capacityPenalty = totalLoad.get(date) >= 5 ? 1000 : 0;
        return { date, score: capacityPenalty + totalLoad.get(date) * 12 + (assigneeLoad.get(key) || 0) * 5 + Math.abs(dateIndex - target) };
      }).filter(({ date }) => !usedByClient.has(date)).sort((a, b) => a.score - b.score || a.date.localeCompare(b.date));
      const selected = ranked[0].date;
      usedByClient.add(selected);
      totalLoad.set(selected, totalLoad.get(selected) + 1);
      const key = `${group.assignee}|${selected}`;
      assigneeLoad.set(key, (assigneeLoad.get(key) || 0) + 1);
      rows.push({ ...group, number: index + 1, date: selected });
    }
  }
  return rows.sort((a, b) => a.date.localeCompare(b.date) || a.client.localeCompare(b.client) || a.number - b.number);
}

export function buildAugust2026Plan() {
  const groups = [
    ...REELS.map(([clientId, client, count]) => ({ clientId, client, count, type: "video", assignee: "Líder" })),
    ...CARRUSELES.map((item) => ({ ...item, count: item.ideas.length, type: "carrusel" })),
  ];
  return distribute(groups).map((row) => {
    const [idea = "", reference = ""] = row.type === "carrusel" ? row.ideas[row.number - 1] : ["", ""];
    return {
      batch: BATCH,
      period: PERIOD,
      clientId: row.clientId,
      client: row.client,
      type: row.type,
      number: row.number,
      label: row.type === "video" ? `Video ${row.number}` : `Carrusel ${row.number}`,
      date: row.date,
      assignee: row.assignee,
      idea,
      reference,
      status: "pendiente",
    };
  });
}

export function summarizeAugustPlan(plan = buildAugust2026Plan()) {
  const byDate = Object.groupBy(plan, (row) => row.date);
  return {
    total: plan.length,
    videos: plan.filter((row) => row.type === "video").length,
    carousels: plan.filter((row) => row.type === "carrusel").length,
    withIdea: plan.filter((row) => row.type === "carrusel" && row.idea).length,
    withoutIdea: plan.filter((row) => row.type === "carrusel" && !row.idea).length,
    maxPerDay: Math.max(...Object.values(byDate).map((rows) => rows.length)),
  };
}

export const AUGUST_PLAN_BATCH = BATCH;
