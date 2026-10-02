import { readFileSync, readdirSync, statSync } from "node:fs";
import { gzipSync } from "node:zlib";
import assert from "node:assert/strict";

const manifest = JSON.parse(readFileSync("dist/.vite/manifest.json", "utf8"));
const initial = new Set();
function collect(key) {
  if (initial.has(key)) return;
  initial.add(key);
  for (const dependency of manifest[key].imports || []) collect(dependency);
}
collect("index.html");
const sizes = [...initial].map((key) => {
  const bytes = readFileSync(`dist/${manifest[key].file}`);
  return { file: manifest[key].file, bytes: bytes.length, gzip: gzipSync(bytes).length };
});
const initialBytes = sizes.reduce((sum, item) => sum + item.bytes, 0);
const initialGzip = sizes.reduce((sum, item) => sum + item.gzip, 0);
const assets = readdirSync("dist/assets");
const largestChunk = Math.max(
  ...assets.filter((file) => file.endsWith(".js")).map((file) => statSync(`dist/assets/${file}`).size),
);
const illustrations = readdirSync("dist/onboarding").reduce(
  (sum, file) => sum + statSync(`dist/onboarding/${file}`).size,
  0,
);
assert.ok(initialBytes <= 650_000, `Initial JavaScript graph exceeds 650 kB: ${initialBytes}`);
assert.ok(initialGzip <= 190_000, `Initial JavaScript gzip exceeds 190 kB: ${initialGzip}`);
assert.ok(largestChunk <= 500_000, `A JavaScript chunk exceeds 500 kB: ${largestChunk}`);
assert.ok(illustrations <= 300_000, `Published onboarding assets exceed 300 kB: ${illustrations}`);
console.log(JSON.stringify({ initialBytes, initialGzip, largestChunk, illustrations, initial: sizes }));
