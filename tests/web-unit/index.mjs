// Punto de entrada del directorio. En Node 26 `node --test` no admite un directorio como argumento
// (lo intenta cargar como módulo y falla con MODULE_NOT_FOUND). Con "main" en package.json,
// `node --test tests/web-unit/` ejecuta este fichero, que carga las cuatro suites en un único proceso.
// Las suites siguen ejecutables por separado: `node --test tests/web-unit/*.test.mjs`.
import './backup.test.mjs';
import './crypto.test.mjs';
import './schema.test.mjs';
import './store-logic.test.mjs';
