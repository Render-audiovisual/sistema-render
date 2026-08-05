import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("la concurrencia usa la precisión de milisegundos que conserva JavaScript", async () => {
  const source = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
  assert.match(
    source,
    /date_trunc\('milliseconds', t\.updated_at\) = date_trunc\('milliseconds', \$\$\{i\}::timestamptz\)/,
  );
});
