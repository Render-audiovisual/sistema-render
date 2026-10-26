// Test-harness only: observe completion without intercepting or changing HTTP.
// Never retain headers, bodies, query strings, users, or arbitrary paths.
export function createFixtureHttpJournal(enabled) {
  const events = [];
  let dropped = 0;
  return {
    accept(message) {
      if (!enabled || message?.type !== 'render-fixture-http') return;
      const { sequence, method, path, status } = message.event ?? {};
      if (!Number.isSafeInteger(sequence) || sequence < 1 || !Number.isInteger(status) || status < 100 || status > 599
        || !((method === 'POST' && path === '/api/moodboards/boards/initialize')
          || (method === 'GET' && path === '/api/moodboards/boards'))) return;
      if (events.length === 256) { events.shift(); dropped++; }
      events.push({ sequence, method, path, status });
    },
    snapshot: () => ({ dropped, events: events.map(event => ({ ...event })) }),
  };
}

export function isFixtureReadyMessage(message) {
  return message !== null && typeof message === 'object'
    && (typeof message.error === 'string' || Object.hasOwn(message, 'base')
      && (message.base === null || typeof message.base === 'string'));
}

export function observeFixtureHttp(server, publish) {
  let sequence = 0;
  const listener = (req, res) => {
    const path = req.url;
    const method = req.method;
    if (!((method === 'POST' && path === '/api/moodboards/boards/initialize')
      || (method === 'GET' && path === '/api/moodboards/boards'))) return;
    res.once('finish', () => {
      // An observer failure must never change the application's response.
      try { publish({ sequence: ++sequence, method, path, status: res.statusCode }); } catch {}
    });
  };
  server.prependListener('request', listener);
  return () => server.removeListener('request', listener);
}
