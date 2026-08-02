import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputRoot = path.join(projectRoot, "hostinger-dist");
const outputBackend = path.join(outputRoot, "backend");

rmSync(outputRoot, { recursive: true, force: true });
mkdirSync(outputBackend, { recursive: true });

for (const relativePath of [
  "backend/package.json",
  "backend/package-lock.json",
  "backend/src",
  "backend/scripts",
  "backend/migrations",
  "frontend/dist",
]) {
  cpSync(path.join(projectRoot, relativePath), path.join(outputRoot, relativePath), {
    recursive: true,
  });
}

execFileSync("npm", ["ci", "--omit=dev", "--prefix", outputBackend], {
  cwd: projectRoot,
  stdio: "inherit",
});

console.log("Hostinger output ready at hostinger-dist");
