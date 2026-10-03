// Runs every tests/*.test.js in one process. Used by `npm test` instead of a shell glob so it
// behaves the same on Windows, macOS and Linux and on any Node version with node:test (18+).
import { readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const dir = path.dirname(fileURLToPath(import.meta.url));
for (const file of readdirSync(dir).filter((f) => f.endsWith('.test.js')).sort()) {
  await import(pathToFileURL(path.join(dir, file)).href);
}
