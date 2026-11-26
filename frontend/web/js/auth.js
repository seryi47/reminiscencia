// AUTH_PASSWORD del Worker (ADR-0052): se guarda una vez en localStorage y se añade como cabecera X-Auth a cada
// petición que escribe el catálogo. El usuario NO la escribe a mano: se provisiona por URL (desde la Mac) o se pega
// desde el portapapeles cuando falta. El actor (X-Actor) identifica quién manda el cambio en el historial.
//
// Canal oficial de provisionado: #auth=<base64> (fragmento, NUNCA viaja al servidor). Compat: si llega ?auth=<base64>
// en la query, lo consumimos igual y limpiamos la URL (ya quedó en logs CF, por eso se desaconseja). El fragmento se
// elige porque los navegadores NO lo envían en la petición HTTP; sólo vive en el cliente.
//
// No usa el DOM directamente en su lógica pura (readParamAuth, encodeAuth, decodeAuth, buildHeaders): se prueban en
// node (tests/web-unit/auth.test.mjs). La parte interactiva (dialog y clipboard) vive en ensureAuth().

export const STORAGE_KEY = 'reminiscencia.auth';
export const ACTOR_KEY = 'reminiscencia.actor';
export const AUTH_URL_PARAM = 'auth';
export const AUTH_URL_HASH = 'auth';
export const DEFAULT_ACTOR = 'web';
const MAX_LEN = 200;

const base64url = (text) => {
  if (typeof text !== 'string') return '';
  try {
    if (typeof globalThis.btoa === 'function') {
      return globalThis.btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    }
    return Buffer.from(text, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  } catch {
    return '';
  }
};

const decodeBase64url = (text) => {
  if (typeof text !== 'string' || text === '') return '';
  try {
    const padded = text.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice(0, (4 - (text.length % 4)) % 4);
    if (typeof globalThis.atob === 'function') return globalThis.atob(padded);
    return Buffer.from(padded, 'base64').toString('utf8');
  } catch {
    return '';
  }
};

/** Formato aceptado para AUTH_PASSWORD: ASCII imprimible sin espacios ni control, hasta 200 bytes. */
export function isValidAuth(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_LEN
    && /^[!-~]+$/.test(value);
}

/** Codifica la contraseña para pegarla en #auth=... (base64url, sin padding). */
export function encodeAuth(password) {
  return base64url(String(password ?? ''));
}

/** Lee ?auth= o #auth= de una URL (string o URL). Devuelve la contraseña decodificada o ''. */
export function decodeAuth(encoded) {
  const text = decodeBase64url(String(encoded ?? ''));
  return isValidAuth(text) ? text : '';
}

function readHashParam(hash, key) {
  if (typeof hash !== 'string' || hash === '') return { value: null, rest: '' };
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  // Soporta #auth=X y #auth=X&otro=Y (como query sin '?')
  const params = new URLSearchParams(raw.includes('=') ? raw : '');
  const value = params.get(key);
  if (value === null) return { value: null, rest: hash };
  params.delete(key);
  const rest = params.toString();
  return { value, rest: rest ? `#${rest}` : '' };
}

/** Mira la URL por #auth=<base64> (canal oficial) o ?auth=<base64> (legacy, deja huella en logs CF).
 *  Devuelve la contraseña + una URL limpia sin el token. */
export function readParamAuth(location) {
  try {
    const url = new URL(String(location?.href ?? location ?? ''));
    // 1) Canal oficial: fragmento #auth=<b64>. No viaja al servidor.
    const fromHash = readHashParam(url.hash, AUTH_URL_HASH);
    if (fromHash.value !== null) {
      const auth = decodeAuth(fromHash.value);
      const search = url.searchParams.toString();
      const cleanUrl = `${url.origin}${url.pathname}${search ? `?${search}` : ''}${fromHash.rest}`;
      return { auth, cleanUrl };
    }
    // 2) Compat: ?auth=<b64>. Ya quedó en logs CF, limpiamos la URL igualmente.
    const raw = url.searchParams.get(AUTH_URL_PARAM);
    if (raw === null) return { auth: '', cleanUrl: null };
    const auth = decodeAuth(raw);
    url.searchParams.delete(AUTH_URL_PARAM);
    const search = url.searchParams.toString();
    const cleanUrl = `${url.origin}${url.pathname}${search ? `?${search}` : ''}${url.hash}`;
    return { auth, cleanUrl };
  } catch {
    return { auth: '', cleanUrl: null };
  }
}

/** Añade X-Auth + X-Actor a las cabeceras de un fetch init, sin pisar las que ya haya. */
export function buildHeaders(init = {}, { password, actor }) {
  const headers = new Headers(init?.headers ?? {});
  if (isValidAuth(password) && !headers.has('X-Auth')) headers.set('X-Auth', password);
  if (typeof actor === 'string' && actor !== '' && !headers.has('X-Actor')) headers.set('X-Actor', actor.slice(0, 64));
  return headers;
}

function safeStorage(getStorage = () => globalThis.localStorage ?? null) {
  try { return getStorage(); } catch { return null; }
}

function readFrom(storage, key) {
  if (!storage) return null;
  try { return storage.getItem(key); } catch { return null; }
}

function writeTo(storage, key, value) {
  if (!storage) return;
  try {
    if (value === null) storage.removeItem(key);
    else storage.setItem(key, value);
  } catch {
    // Almacenamiento lleno/bloqueado: la contraseña vale solo para esta visita.
  }
}

/**
 * Gestor de la contraseña del Worker. Dependencias (todas inyectables para las pruebas):
 * - storage: localStorage (o compatible con getItem/setItem/removeItem)
 * - locationLike: { href }, para leer ?auth=... al arrancar
 * - replaceUrl(cleanUrl): quita el ?auth de la barra tras guardarlo (history.replaceState en el navegador)
 * - promptPassword(): abre el diálogo para pedirla, resuelve con la contraseña o null si se cancela
 *
 * Expone:
 * - ensure(): devuelve la contraseña (de localStorage, URL o diálogo), o '' si el usuario cancela
 * - get(): la que haya ahora, sin pedirla
 * - set(value): guarda explícitamente (p. ej. desde el diálogo)
 * - clear(): borra la guardada (tras un 401)
 * - actor(): el X-Actor que se mandará
 * - withAuth(init): copia de init con X-Auth + X-Actor añadidos; si falta la contraseña, la pide
 * - authorizedFetch(fetchImpl)(path, init): envuelve fetchImpl añadiendo auth y, en caso de 401, pide y reintenta UNA vez
 */
export function createAuthClient({
  storage = safeStorage(),
  locationLike = (typeof globalThis.location !== 'undefined' ? globalThis.location : null),
  replaceUrl = null,
  promptPassword = async () => null,
} = {}) {
  let password = readFrom(storage, STORAGE_KEY) ?? '';
  if (!isValidAuth(password)) password = '';
  let actor = readFrom(storage, ACTOR_KEY);
  actor = typeof actor === 'string' && actor !== '' ? actor : DEFAULT_ACTOR;

  // Provisionado: #auth=<base64> (fragmento, oficial) o ?auth=<base64> (legacy) en la URL manda sobre lo guardado.
  if (locationLike) {
    const { auth: fromUrl, cleanUrl } = readParamAuth(locationLike);
    if (isValidAuth(fromUrl)) {
      password = fromUrl;
      writeTo(storage, STORAGE_KEY, password);
      if (cleanUrl && typeof replaceUrl === 'function') replaceUrl(cleanUrl);
    }
  }

  function set(value) {
    if (!isValidAuth(value)) return false;
    password = value;
    writeTo(storage, STORAGE_KEY, password);
    return true;
  }

  function clear() {
    password = '';
    writeTo(storage, STORAGE_KEY, null);
  }

  async function ensure() {
    if (password) return password;
    const asked = await promptPassword();
    if (asked && isValidAuth(asked)) set(asked);
    return password;
  }

  async function withAuth(init = {}) {
    const value = await ensure();
    return { ...init, headers: buildHeaders(init, { password: value, actor }) };
  }

  function authorizedFetch(fetchImpl = globalThis.fetch?.bind(globalThis)) {
    return async (path, init = {}) => {
      const first = await withAuth(init);
      let response = await fetchImpl(path, first);
      if (response?.status !== 401) return response;
      // 401: la contraseña guardada no vale. La borramos, pedimos otra y reintentamos UNA vez.
      clear();
      const asked = await promptPassword();
      if (!asked || !isValidAuth(asked)) return response;
      set(asked);
      const retried = await withAuth(init);
      response = await fetchImpl(path, retried);
      return response;
    };
  }

  return {
    get: () => password,
    set,
    clear,
    ensure,
    actor: () => actor,
    setActor(value) {
      actor = typeof value === 'string' && value !== '' ? value.slice(0, 64) : DEFAULT_ACTOR;
      writeTo(storage, ACTOR_KEY, actor === DEFAULT_ACTOR ? null : actor);
    },
    withAuth,
    authorizedFetch,
  };
}

/** Diálogo nativo para pedir la contraseña. Solo navegador (importa ui/dom). Devuelve la contraseña o null. */
export async function openAuthDialog() {
  // Importación perezosa para que el módulo siga siendo probable en node sin DOM.
  const { el, openDialog } = await import('./ui/dom.js');
  return new Promise((resolve) => {
    let value = '';
    openDialog({
      title: 'Contraseña del catálogo',
      testid: 'auth-dialog',
      className: 'dialog-auth',
      render: (body) => {
        const input = el('input', {
          type: 'password',
          class: 'input',
          'data-testid': 'auth-input',
          autocomplete: 'current-password',
          spellcheck: 'false',
          'aria-label': 'Contraseña del Worker',
        });
        input.addEventListener('input', () => { value = input.value; });
        const pasteButton = el('button', {
          type: 'button',
          class: 'button button-light',
          'data-testid': 'auth-paste',
        }, 'Pegar desde el portapapeles');
        pasteButton.addEventListener('click', async () => {
          try {
            const text = await navigator.clipboard.readText();
            if (isValidAuth(text)) {
              input.value = text;
              value = text;
            }
          } catch {
            // Sin permiso o sin API de portapapeles: el usuario puede escribirla a mano.
          }
        });
        const saveButton = el('button', {
          type: 'button',
          class: 'button',
          'data-testid': 'auth-save',
        }, 'Guardar');
        saveButton.addEventListener('click', () => {
          if (isValidAuth(value)) resolve(value);
        });
        const cancelButton = el('button', {
          type: 'button',
          class: 'button button-secondary',
          'data-testid': 'auth-cancel',
        }, 'Cancelar');
        cancelButton.addEventListener('click', () => resolve(null));
        body.append(
          el('p', { class: 'dialog-text' }, 'La contraseña del catálogo protege las ediciones y las publicaciones. Se guarda en este navegador y no se te pedirá otra vez.'),
          input,
          el('div', { class: 'dialog-actions' }, pasteButton, saveButton, cancelButton),
        );
      },
      initialFocus: (dialog) => dialog.querySelector('[data-testid="auth-input"]'),
    }).finally(() => resolve(null));
  });
}
