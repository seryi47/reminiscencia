// Hoja «Subir canciones» (ADR-0017): una sola forma de subir archivos.
// - Subir: la persona elige uno o varios archivos (también ZIP, mezclados con canciones sueltas) y cada canción pasa a la cola del gestor de subidas de la app
//   (js/cuidador/subida-estado.js), que lo convierte a Opus en este navegador, guarda una copia para que se pueda
//   escuchar ya, lo envía por trozos a la función del propio origen /api/subir (js/cuidador/subida-publica.js) y
//   comprueba /data/songs.json hasta que la canción está publicada. La hoja solo pinta ese estado: una fila por archivo
//   con su paso («Convirtiendo a Opus…», «Subiendo… 45 %», «Guardada en GitHub», «Publicándose…», «Publicada» con
//   «Reproducir», o «Error: <motivo>» con «Reintentar») y un resumen arriba («2 de 3 publicadas»). Al cerrar la hoja,
//   las subidas siguen. Ni esta hoja ni la web conocen ningún token.
// - ZIP: la app saca del ZIP sus canciones de audio (subida-zip.js y zip.js) y la hoja las pinta en un grupo, con la
//   cabecera «Álbum.zip: 12 canciones», lo que se ignoró y una fila por canción. El ZIP no se sube nunca.
// - Posibles duplicados (ADR-0026): antes de poner los archivos en la cola, cada uno se compara con la biblioteca y con
//   los anteriores de la misma tanda (js/duplicates.js); si se parece a otro, se pregunta con askDuplicate: «Parece que
//   ya está en la biblioteca: «X» (3:21). ¿Subirla igualmente?», con «Subir igualmente» y «Quitar de la cola».
// - Las canciones guardadas antes solo en este navegador (ADR-0012) siguen sonando y se pueden borrar desde aquí.
// - «Importar desde Internet Archive»: prepara una incidencia de importación con la validación de incidencias.js y de
//   intake.js (la misma lista de bloqueo de 42 plataformas que el backend; ADR-0008).

import { evaluateImportForm, buildIssueBody, buildIssueTitle, buildIssueUrl, classifyUrl, PROCESSING_NOTE } from '../cuidador/incidencias.js';
import { validateImport } from '../intake.js';
import { opusSupport } from '../cuidador/subida-local.js';
import { PUBLIC_AUDIO_ACCEPT, PUBLIC_UNSUPPORTED_TEXT, RIGHTS_TEXT } from '../cuidador/subida-publica.js';
import { progressOf, STATES, statusText, summaryText } from '../cuidador/subida-estado.js';
import { groupNote, groupTitle, ZIP_ACCEPT } from '../cuidador/subida-zip.js';
import { formatDuration } from '../catalog.js';
import { el, openDialog, uid } from '../ui/dom.js';
import { icon } from '../ui/icons.js';

/** Abre la hoja. ctx aporta uploads (el gestor), addUploads, deleteLocalSong y las canciones locales. option: 'archive'. */
export function openUploadSheet(ctx, { option = null } = {}) {
  return openDialog({
    title: 'Subir canciones',
    className: 'dialog-upload',
    testid: 'upload-sheet',
    render: (body, _close, dialog) => {
      let cleanup = null;
      const show = (key) => {
        cleanup?.();
        cleanup = null;
        if (key === 'archive') body.replaceChildren(archivePanel(() => show(null)));
        else {
          const panel = uploadPanel(ctx, () => show('archive'));
          cleanup = panel.cleanup;
          body.replaceChildren(panel.node);
        }
        const target = body.querySelector('[data-autofocus]') ?? body.querySelector('button, a, input');
        target?.focus();
      };
      // Al cerrar la hoja solo se deja de pintar: las subidas siguen en la app.
      dialog?.addEventListener('close', () => cleanup?.());
      show(option);
    },
  });
}

function backButton(back) {
  return el('button', { type: 'button', class: 'button button-text upload-back', 'data-testid': 'upload-back', on: { click: back } },
    icon('chevron-left', { size: 20 }), 'Volver a Subir canciones');
}

// ---------------------------------------------------------------------------
// Subir (para todos)
// ---------------------------------------------------------------------------

/** Icono de cada paso (el texto dice lo mismo: el color nunca es lo único que lo indica). */
export const STATE_ICONS = Object.freeze({
  [STATES.QUEUED]: 'clock',
  [STATES.CONVERTING]: 'note',
  [STATES.SENDING]: 'upload',
  [STATES.SAVED]: 'check',
  [STATES.PUBLISHING]: 'clock',
  [STATES.PUBLISHED]: 'check-circle',
  [STATES.SLOW]: 'clock',
  [STATES.ERROR]: 'alert',
});

function localSection(ctx) {
  const list = el('ul', { class: 'upload-local-list', 'data-testid': 'upload-local-list' });
  const section = el('section', { class: 'upload-local', 'data-testid': 'upload-local' },
    el('h3', { class: 'upload-subtitle' }, 'Guardadas solo en este navegador'),
    el('p', { class: 'upload-note' }, 'Son de antes: siguen sonando aquí y puedes borrarlas.'),
    list);
  const paint = () => {
    const songs = ctx.localSongs();
    section.hidden = songs.length === 0;
    list.replaceChildren(...songs.map((song) => el('li', { class: 'upload-local-row', 'data-song-id': song.id },
      el('span', { class: 'upload-local-text' },
        el('span', { class: 'add-title' }, song.title),
        el('span', { class: 'track-artist' }, formatDuration(song.durationS ?? song.duration_s ?? NaN))),
      el('button', {
        type: 'button',
        class: 'button button-outline',
        'aria-label': `Borrar ${song.title} de este navegador`,
        'data-testid': 'upload-delete',
        on: { click: async () => { if (await ctx.deleteLocalSong(song)) paint(); } },
      }, 'Borrar'))));
  };
  paint();
  return section;
}

/** Fila de una subida. Se actualiza en su sitio: los botones solo se cambian cuando cambia el paso. */
function uploadRow(ctx) {
  const iconSlot = el('span', { class: 'upload-item-icon', 'aria-hidden': 'true' });
  const name = el('span', { class: 'upload-item-name', 'data-testid': 'upload-item-name' });
  const status = el('span', { class: 'upload-item-status', 'data-testid': 'upload-item-status' });
  const bar = el('progress', { class: 'upload-item-progress', max: '100', 'data-testid': 'upload-item-progress' });
  const actions = el('div', { class: 'upload-item-actions' });
  const node = el('li', { class: 'upload-item', tabindex: '-1', 'data-testid': 'upload-item' },
    iconSlot, el('div', { class: 'upload-item-main' }, name, status, bar), actions);
  let shownState = null;
  let shown = '';

  const update = (item) => {
    const text = statusText(item);
    const progress = progressOf(item);
    // Solo se toca el DOM si cambia algo que se ve: con muchas subidas, repintar todas las filas en cada aviso frenaba
    // el teléfono (ADR-0033).
    const signature = `${item.key}|${item.state}|${item.name}|${text}|${progress.hidden}|${progress.value}|${item.retryable}|${item.songId}`;
    if (signature === shown) return;
    shown = signature;
    node.dataset.key = item.key;
    node.dataset.state = item.state;
    name.textContent = item.name;
    name.title = item.name;
    status.textContent = text;
    // Sin nada que medir, la barra no se ve pero guarda su hueco (visibility, no hidden): la fila no cambia de alto.
    bar.classList.toggle('is-idle', progress.hidden);
    bar.setAttribute('aria-label', `Progreso de ${item.name}`);
    if (progress.value === null) bar.removeAttribute('value');
    else bar.value = progress.value;
    if (item.state === shownState) return;
    shownState = item.state;
    iconSlot.replaceChildren(icon(STATE_ICONS[item.state] ?? 'note', { size: 20 }));
    // Si el foco estaba en un botón que desaparece (por ejemplo, «Reintentar»), pasa a la fila.
    const hadFocus = actions.contains(document.activeElement);
    const buttons = [];
    if (item.state === STATES.PUBLISHED && item.songId) {
      buttons.push(el('button', {
        type: 'button',
        class: 'button button-primary button-small',
        'aria-label': `Reproducir ${item.songTitle ?? item.title}`,
        'data-testid': 'upload-item-play',
        on: { click: () => ctx.playSongById(item.songId) },
      }, icon('play', { size: 16 }), 'Reproducir'));
    }
    if (item.state === STATES.ERROR && item.retryable) {
      buttons.push(el('button', {
        type: 'button',
        class: 'button button-outline button-small',
        'aria-label': `Reintentar ${item.name}`,
        'data-testid': 'upload-item-retry',
        on: { click: () => ctx.uploads.retry(item.key) },
      }, 'Reintentar'));
    }
    actions.replaceChildren(...buttons);
    if (hadFocus) node.focus();
  };
  return { node, update };
}

function uploadPanel(ctx, openArchive) {
  const inputId = uid('archivos');
  // El campo de archivo va oculto: lo abre el botón visible, que sí recibe el foco con el teclado.
  const input = el('input', { id: inputId, type: 'file', accept: `${PUBLIC_AUDIO_ACCEPT},${ZIP_ACCEPT}`, multiple: true, hidden: true, 'data-testid': 'upload-file-input' });
  const pick = el('button', {
    type: 'button',
    class: 'button button-primary upload-pick',
    'data-testid': 'upload-pick',
    on: { click: () => { if (pick.getAttribute('aria-disabled') !== 'true') input.click(); } },
  }, icon('upload', { size: 20 }), 'Elegir archivos');
  const status = el('p', { class: 'upload-status', role: 'status', 'data-testid': 'upload-status' });
  const support = el('p', { class: 'upload-note', 'data-testid': 'upload-support' });
  const summary = el('p', { class: 'upload-summary', 'data-testid': 'upload-summary', hidden: true });
  const list = el('ul', { class: 'upload-items', 'data-testid': 'upload-items', 'aria-label': 'Subidas' });
  // Región que anuncia cada cambio de paso (no cada porcentaje) a quien usa un lector de pantalla.
  const live = el('p', { class: 'sr-only', 'aria-live': 'polite', 'data-testid': 'upload-live' });
  const rows = new Map();
  const groups = new Map();
  const seen = new Map();

  opusSupport().then((result) => {
    if (!result.ok) {
      support.textContent = PUBLIC_UNSUPPORTED_TEXT;
      support.classList.add('is-warning');
      pick.setAttribute('aria-disabled', 'true');
    }
  });

  // Grupo de un ZIP: cabecera «Álbum.zip: 12 canciones», lo ignorado y su propia lista de filas.
  const groupNode = (group, changes) => {
    let node = groups.get(group.key);
    if (node) return node;
    const note = groupNote(group);
    const items = el('ul', { class: 'upload-items upload-group-items', 'aria-label': `Canciones de ${group.name}` });
    const title = groupTitle(group);
    const element = el('li', { class: 'upload-group', 'data-testid': 'upload-group', 'data-group-key': group.key },
      el('p', { class: 'upload-group-title', 'data-testid': 'upload-group-title', title },
        el('span', { class: 'upload-group-icon', 'aria-hidden': 'true' }, icon('archive', { size: 20 })),
        el('span', { class: 'upload-group-name' }, title)),
      note ? el('p', { class: 'upload-note upload-group-note', 'data-testid': 'upload-group-note' }, note) : null,
      items);
    list.append(element);
    node = { element, items };
    groups.set(group.key, node);
    changes.push([title, note].filter(Boolean).join('. '));
    return node;
  };

  const paint = (items, { announce = true } = {}) => {
    summary.textContent = summaryText(items);
    summary.hidden = items.length === 0;
    const changes = [];
    for (const item of items) {
      let row = rows.get(item.key);
      if (!row) {
        row = uploadRow(ctx);
        rows.set(item.key, row);
        (item.group ? groupNode(item.group, changes).items : list).append(row.node);
      }
      row.update(item);
      if (seen.get(item.key) !== item.state) {
        if (seen.has(item.key) || item.state !== STATES.QUEUED) changes.push(`${item.name}: ${statusText(item)}`);
        seen.set(item.key, item.state);
      }
    }
    if (announce && changes.length > 0) live.textContent = changes.join('. ');
  };

  // Los archivos van a la cola de la app; se puede elegir más mientras se suben otros.
  input.addEventListener('change', () => {
    const files = [...input.files];
    input.value = '';
    if (files.length === 0) return;
    // Antes de la cola, se avisa de lo que parece estar ya en la biblioteca (ADR-0026). Después, la primera fila nueva
    // se trae a la vista: en el teléfono, la lista queda debajo del texto de la hoja y no se veía que algo empezaba.
    const before = new Set(rows.keys());
    Promise.resolve(ctx.addUploads(files, { checkDuplicates: true })).then(() => {
      const first = [...rows.entries()].find(([key]) => !before.has(key))?.[1]?.node;
      if (first?.isConnected) first.scrollIntoView({ block: 'nearest' });
    }).catch(() => {});
  });

  const uploads = ctx.uploads;
  paint(uploads?.items() ?? [], { announce: false });
  const unsubscribe = uploads?.subscribe((items) => paint(items)) ?? (() => {});

  const node = el('div', { class: 'upload-panel', 'data-testid': 'upload-panel' },
    el('p', { class: 'dialog-text', 'data-autofocus': '', tabindex: '-1' },
      'Elige uno o varios archivos de audio (WAV, MP3, M4A, FLAC, OGG u OPUS) o archivos ZIP con canciones. Se convierten a Opus en este navegador y se suben a la biblioteca para todos. El título de cada canción es el nombre del archivo. De un ZIP se sacan todas sus canciones, también las de sus carpetas; el ZIP no se sube.'),
    el('p', { class: 'upload-note', 'data-testid': 'upload-rights' }, RIGHTS_TEXT),
    support,
    el('div', { class: 'upload-row' }, input, pick),
    status,
    summary,
    list,
    live,
    el('p', { class: 'upload-note' }, 'Puedes cerrar esta hoja: las subidas siguen y se avisa cuando cada canción esté en la biblioteca.'),
    localSection(ctx),
    el('button', { type: 'button', class: 'button button-text upload-archive-link', 'data-testid': 'upload-open-archive', on: { click: openArchive } },
      icon('archive', { size: 20 }), 'Importar desde Internet Archive'));
  return { node, cleanup: unsubscribe };
}

/**
 * Pregunta por un archivo que parece duplicado. Resuelve true con «Subir igualmente» (también si se cierra sin elegir:
 * solo es un aviso) y false con «Quitar de la cola».
 */
export async function askDuplicate({ name, message }) {
  const result = await openDialog({
    title: 'Posible duplicado',
    testid: 'duplicate-dialog',
    render: (body, close) => {
      body.append(
        el('p', { class: 'dialog-text upload-item-name', 'data-testid': 'duplicate-file' }, name),
        el('p', { class: 'dialog-text', 'data-testid': 'duplicate-message' }, message),
        el('div', { class: 'dialog-actions' },
          el('button', { type: 'button', class: 'button button-secondary', 'data-testid': 'duplicate-drop', on: { click: () => close(false) } }, 'Quitar de la cola'),
          el('button', { type: 'button', class: 'button button-primary', 'data-testid': 'duplicate-keep', on: { click: () => close(true) } }, 'Subir igualmente')));
    },
    initialFocus: (dialog) => dialog.querySelector('[data-testid="duplicate-keep"]'),
  });
  return result !== false;
}

// ---------------------------------------------------------------------------
// Desde Internet Archive (incidencia)
// ---------------------------------------------------------------------------

function field(key, label, help) {
  const id = uid(`campo-${key}`);
  const helpId = `${id}-ayuda`;
  const errorId = `${id}-error`;
  const input = el('input', {
    id,
    type: 'text',
    class: 'text-field',
    autocomplete: 'off',
    autocapitalize: 'off',
    spellcheck: 'false',
    'aria-describedby': helpId,
    'data-testid': `archive-${key}`,
  });
  const error = el('p', { id: errorId, class: 'field-error', hidden: true });
  const wrapper = el('div', { class: 'field' },
    el('label', { class: 'field-label', for: id }, label),
    input,
    el('p', { id: helpId, class: 'field-help' }, help),
    error);
  const setError = (message) => {
    error.textContent = message ?? '';
    error.hidden = !message;
    if (message) {
      input.setAttribute('aria-invalid', 'true');
      input.setAttribute('aria-describedby', `${helpId} ${errorId}`);
    } else {
      input.removeAttribute('aria-invalid');
      input.setAttribute('aria-describedby', helpId);
    }
  };
  return { input, wrapper, setError, touched: false };
}

/**
 * Evalúa el formulario con las dos validaciones de la web: la de incidencias.js (más estricta: solo https y
 * archive.org/details/…) y la de intake.js. Una petición solo vale si las dos la aceptan.
 */
export function evaluateArchiveForm(raw) {
  const result = evaluateImportForm(raw);
  if (!result.request) return result;
  const second = validateImport({ url: result.request.url, license: result.request.license, title: result.request.title });
  if (second) return { request: null, errors: { url: second } };
  return result;
}

function archivePanel(back) {
  const url = field('url', 'Dirección del ítem o del fichero', 'Internet Archive: https://archive.org/details/<identificador>. También un enlace directo a un fichero de audio con licencia (mp3, flac, ogg, opus, m4a o wav).');
  const license = field('license', 'Licencia de uso', 'Obligatoria en un fichero directo, tal como figura en la fuente (por ejemplo, CC BY 4.0).');
  const title = field('title', 'Título (opcional)', 'Si lo dejas vacío, se usa el del ítem.');
  const status = el('p', { class: 'upload-status', role: 'status', 'data-testid': 'archive-status' });
  const link = el('a', {
    class: 'button button-primary',
    target: '_blank',
    rel: 'noopener noreferrer',
    'aria-disabled': 'true',
    'data-testid': 'archive-issue-link',
  }, 'Abrir incidencia en GitHub', el('span', { class: 'sr-only' }, ' (se abre en otra pestaña)'), icon('external', { size: 18 }));
  const fields = { url, license, title };

  const refresh = () => {
    const raw = { url: url.input.value, license: license.input.value, title: title.input.value };
    license.wrapper.hidden = classifyUrl(raw.url.trim()) !== 'direct';
    const result = evaluateArchiveForm(raw);
    for (const [key, item] of Object.entries(fields)) {
      const filled = item.input.value.trim() !== '';
      item.setError(result.errors[key] && (item.touched || filled) ? result.errors[key] : null);
    }
    if (result.request) {
      link.setAttribute('href', buildIssueUrl(buildIssueTitle(result.request), buildIssueBody(result.request)));
      link.setAttribute('aria-disabled', 'false');
      status.textContent = 'Lista. Pulsa «Abrir incidencia en GitHub» para confirmarla allí.';
    } else {
      link.removeAttribute('href');
      link.setAttribute('aria-disabled', 'true');
      status.textContent = 'Completa la dirección para preparar la incidencia.';
    }
  };
  for (const item of Object.values(fields)) {
    item.input.addEventListener('input', refresh);
    item.input.addEventListener('blur', () => { item.touched = true; refresh(); });
  }
  link.addEventListener('click', (event) => {
    if (link.getAttribute('aria-disabled') === 'true') {
      event.preventDefault();
      url.touched = true;
      refresh();
      url.input.focus();
    }
  });
  refresh();

  return el('div', { class: 'upload-panel', 'data-testid': 'upload-panel-archive' },
    backButton(back),
    el('h3', { class: 'upload-panel-title', 'data-autofocus': '', tabindex: '-1' }, 'Desde Internet Archive'),
    el('p', { class: 'dialog-text' }, PROCESSING_NOTE),
    el('p', { class: 'upload-note' }, 'No se admiten plataformas de vídeo ni de streaming: sus condiciones no permiten descargar el contenido.'),
    url.wrapper, license.wrapper, title.wrapper,
    status,
    link);
}
