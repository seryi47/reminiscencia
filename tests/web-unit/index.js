// Punto de entrada del conjunto web: `node --test tests/web-unit/` carga cada *.test.mjs de esta
// carpeta. El runner de Node no recorre un directorio pasado como argumento; en Node 26 lo trata
// como módulo y falla con MODULE_NOT_FOUND. Las formas `node --test tests/web-unit/offline-core.test.mjs`
// y `node --test 'tests/web-unit/*.test.mjs'` siguen funcionando igual.
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const suites = readdirSync(here)
  .filter((name) => name.endsWith('.test.mjs'))
  .sort();

if (suites.length === 0) {
  throw new Error(`No hay pruebas *.test.mjs en ${here}`);
}

for (const name of suites) {
  await import(pathToFileURL(join(here, name)).href);
}
