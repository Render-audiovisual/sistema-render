export function readUrlContext(search, schema) {
  const params = new URLSearchParams(search || "");
  return Object.fromEntries(
    Object.entries(schema).map(([key, fallback]) => {
      const value = params.get(key);
      return [key, value === null || value === "" ? fallback : value];
    }),
  );
}

export function buildContextUrl(currentUrl, changes) {
  const url = new URL(currentUrl, "http://render.local");
  Object.entries(changes).forEach(([key, value]) => {
    if (value === null || value === undefined || value === "") {
      url.searchParams.delete(key);
    } else {
      url.searchParams.set(key, String(value));
    }
  });
  return `${url.pathname}${url.search}${url.hash}`;
}

export function replaceUrlContext(changes) {
  const nextUrl = buildContextUrl(window.location.href, changes);
  window.history.replaceState({}, "", nextUrl);
}

export function pushUrlContext(changes) {
  const nextUrl = buildContextUrl(window.location.href, changes);
  window.history.pushState({}, "", nextUrl);
}

export function readMonthContext(value, fallbackYear, fallbackMonth) {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(value || "");
  if (!match) return { year: fallbackYear, month: fallbackMonth };
  return { year: Number(match[1]), month: Number(match[2]) - 1 };
}

export function formatMonthContext(year, month) {
  return `${year}-${String(month + 1).padStart(2, "0")}`;
}
