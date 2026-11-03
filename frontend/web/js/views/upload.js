// Hoja «Subir canciones» (ADR-0017): una sola forma de subir archivos.
// - Subir: la persona elige uno o varios archivos; cada uno se convierte a Opus en este navegador y se envía, de uno en
//   uno y en orden, a la función del propio origen /api/subir (js/cuidador/subida-publica.js), que lo guarda en el
//   buzón del repositorio para que llegue a todos. Ni esta hoja ni la web conocen ningún token.
// - Las canciones guardadas antes solo en este navegador (ADR-0012) siguen sonando y se pueden borrar desde aquí.
// - «Importar desde Internet Archive»: prepara una incidencia de importación con la validación de incidencias.js y de
//   intake.js (la misma lista de bloqueo de 42 plataformas que el backend; ADR-0008).

import { evaluateImportForm, buildIssueBody, buildIssueTitle, buildIssueUrl, classifyUrl, PROCESSING_NOTE } from '../cuidador/incidencias.js';
import { validateImport } from '../intake.js';
import { opusSupport } from '../cuidador/subida-local.js';
import {
  DONE_TEXT,
  PUBLIC_AUDIO_ACCEPT,
  PUBLIC_UNSUPPORTED_TEXT,
  RIGHTS_TEXT,
  uploadFiles,
} from '../cuidador/subida-publica.js';
import { formatDuration } from '../catalog.js';
import { el, openDialog, uid } from '../ui/dom.js';
import { icon } from '../ui/icons.js';

/** Abre la hoja. ctx aporta deleteLocalSong y la lista de canciones locales. option: 'archive' abre la importación. */
export function openUploadSheet(ctx, { option = null } = {}) {
  return openDialog({
    title: 'Subir canciones',
    className: 'dialog-upload',
    testid: 'upload-sheet',
    render: (body) => {
      const show = (key) => {
        body.replaceChildren(key === 'archive' ? archivePanel(() => show(null)) : uploadPanel(ctx, () => show('archive')));
        const target = body.querySelector('[data-autofocus]') ?? body.querySelector('button, a, input');
        target?.focus();
      };
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

/** Texto del resumen tras subir: cuántas han salido y cuántas no. */
export function summaryText({ sent = 0, failed = 0 } = {}) {
  if (sent === 0 && failed === 0) return '';
  if (sent === 0) return failed === 1 ? 'No se ha podido subir el archivo.' : `No se ha podido subir ninguno de los ${failed} archivos.`;
  const done = sent === 1 ? `${DONE_TEXT}` : `${sent} canciones subidas: llegarán a todos en un par de minutos.`;
  return failed === 0 ? done : `${done} ${failed === 1 ? 'Un archivo no se ha podido subir.' : `${failed} archivos no se han podido subir.`}`;
}

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

function uploadPanel(ctx, openArchive) {
  const inputId = uid('archivos');
  // El campo de archivo va oculto: lo abre el botón visible, que sí recibe el foco con el teclado.
  const input = el('input', { id: inputId, type: 'file', accept: PUBLIC_AUDIO_ACCEPT, multiple: true, hidden: true, 'data-testid': 'upload-file-input' });
  const pick = el('button', {
    type: 'button',
    class: 'button button-primary upload-pick',
    'data-testid': 'upload-pick',
    on: { click: () => { if (pick.getAttribute('aria-disabled') !== 'true') input.click(); } },
  }, icon('upload', { size: 20 }), 'Elegir archivos');
  const progress = el('progress', { class: 'upload-progress', max: '100', value: '0', hidden: true, 'aria-label': 'Progreso de la subida' });
  const status = el('p', { class: 'upload-status', role: 'status', 'data-testid': 'upload-status' });
  const results = el('ul', { class: 'upload-results', 'data-testid': 'upload-results' });
  const support = el('p', { class: 'upload-note', 'data-testid': 'upload-support' });

  opusSupport().then((result) => {
    if (!result.ok) {
      support.textContent = PUBLIC_UNSUPPORTED_TEXT;
      support.classList.add('is-warning');
      pick.setAttribute('aria-disabled', 'true');
    }
  });

  const row = (name, message, ok) => el('li', { class: ok ? 'upload-result is-ok' : 'upload-result is-error', 'data-state': ok ? 'ok' : 'error' },
    el('span', { class: 'upload-result-name' }, name), ': ', message);

  input.addEventListener('change', async () => {
    const files = [...input.files];
    input.value = '';
    if (files.length === 0) return;
    pick.setAttribute('aria-disabled', 'true');
    progress.hidden = false;
    progress.value = '0';
    results.replaceChildren();
    try {
      const result = await uploadFiles(files, {
        onProgress: ({ index, total, name, stage, fraction }) => {
          progress.value = String(Math.round(((index + fraction) / total) * 100));
          const verb = stage === 'enviar' ? 'Subiendo' : 'Convirtiendo';
          status.textContent = `${verb} ${index + 1} de ${total}: ${name}…`;
        },
      });
      results.replaceChildren(...result.results.map((item) => row(item.name, item.message, item.ok)));
      status.textContent = summaryText({ sent: result.sent.length, failed: result.failed.length });
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : 'No se han podido subir los archivos.';
    } finally {
      progress.hidden = true;
      pick.removeAttribute('aria-disabled');
      if (support.classList.contains('is-warning')) pick.setAttribute('aria-disabled', 'true');
    }
  });

  return el('div', { class: 'upload-panel', 'data-testid': 'upload-panel' },
    el('p', { class: 'dialog-text', 'data-autofocus': '', tabindex: '-1' },
      'Elige uno o varios archivos de audio (WAV, MP3, M4A, FLAC, OGG u OPUS). Se convierten a Opus en este navegador y se suben a la biblioteca para todos. El título de cada canción es el nombre del archivo.'),
    el('p', { class: 'upload-note', 'data-testid': 'upload-rights' }, RIGHTS_TEXT),
    support,
    el('div', { class: 'upload-row' }, input, pick),
    progress,
    status,
    results,
    localSection(ctx),
    el('button', { type: 'button', class: 'button button-text upload-archive-link', 'data-testid': 'upload-open-archive', on: { click: openArchive } },
      icon('archive', { size: 20 }), 'Importar desde Internet Archive'));
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
