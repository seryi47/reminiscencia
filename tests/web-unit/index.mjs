// Punto de entrada del directorio. En Node 26 `node --test` no admite un directorio como argumento
// (lo intenta cargar como módulo y falla con MODULE_NOT_FOUND). Con "main" en package.json,
// `node --test tests/web-unit/` ejecuta este fichero, que carga en un único proceso todas las
// suites tests/web-unit/*.test.mjs que existan. Las suites siguen ejecutables por separado:
// `node --test "tests/web-unit/*.test.mjs"`. Como las suites se descubren del directorio, una
// suite nueva entra sin tocar este fichero.
import { readdirSync } from 'node:fs';

const suites = readdirSync(new URL('.', import.meta.url))
  .filter((name) => name.endsWith('.test.mjs'))
  .sort();
for (const name of suites) {
  await import(new URL(name, import.meta.url).href);
}
