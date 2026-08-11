import { cp, mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const output = resolve(root, "dist");
const validation = spawnSync(process.execPath, [resolve(root, "scripts/validate.mjs")], {
  cwd: root,
  encoding: "utf8",
  stdio: "inherit",
});

if (validation.status !== 0) process.exit(validation.status || 1);

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });

for (const entry of ["index.html", "tokens.css", ".nojekyll", "assets", "data"]) {
  await cp(resolve(root, entry), resolve(output, entry), { recursive: true });
}

console.log("Built a dependency-free GitHub Pages artifact in dist/.");
