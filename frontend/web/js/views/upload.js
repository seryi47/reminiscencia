// Hoja «Subir canciones»: tres caminos.
// 1. «Solo en este navegador»: convierte a Opus y guarda en IndexedDB (js/cuidador/subida-local.js; ADR-0012).
// 2. «Para todos»: abre en otra pestaña la subida de GitHub al buzón del repositorio (sin tokens ni API).
// 3. «Desde Internet Archive»: prepara una incidencia de importación con la validación de incidencias.js y de
//    intake.js (la misma lista de bloqueo de 42 plataformas que el backend; ADR-0008).

import { evaluateImportForm, buildIssueBody, buildIssueTitle, buildIssueUrl, classifyUrl, PROCESSING_NOTE } from '../cuidador/incidencias.js';
import { validateImport } from '../intake.js';
import {
  addLocalFiles,
  LOCAL_AUDIO_ACCEPT,
  MAX_DURATION_S,
  MAX_FILE_BYTES,
  opusSupport,
  UNSUPPORTED_TEXT,
} from '../cuidador/subida-local.js';
import { formatDuration } from '../catalog.js';
import { el, openDialog, uid } from '../ui/dom.js';
import { icon } from '../ui/icons.js';

/** Dirección de la subida de GitHub al buzón de la biblioteca. */
export const GITHUB_UPLOAD_URL = 'https://github.com/seryi47/reminiscencia/upload/main/audio-library/buzon';

const OPTIONS = Object.freeze([
  Object.freeze({ key: 'local', icon: 'device', title: 'Solo en este navegador', text: 'Se convierten y se guardan aquí. Nadie más las ve ni salen de este dispositivo.' }),
  Object.freeze({ key: 'todos', icon: 'people', title: 'Para todos', text: 'Súbelas al repositorio en GitHub para que entren en la biblioteca pública.' }),
  Object.freeze({ key: 'archive', icon: 'archive', title: 'Desde Internet Archive', text: 'Pide importar un ítem con licencia mediante una incidencia en GitHub.' }),
]);

/** Abre la hoja. ctx aporta onLocalAdded, deleteLocalSong y la lista de canciones locales. */
export function openUploadSheet(ctx, { option = null } = {}) {
  return openDialog({
    title: 'Subir canciones',
    className: 'dialog-upload',
    testid: 'upload-sheet',
    render: (body) => {
      const show = (key) => {
        body.replaceChildren(key ? panelFor(key, ctx, () => show(null)) : chooser(show));
        const target = body.querySelector('[data-autofocus]') ?? body.querySelector('button, a, input');
        target?.focus();
      };
      show(option);
    },
  });
}

function chooser(show) {
  return el('div', { class: 'upload-chooser' },
    el('p', { class: 'dialog-text' }, '¿Dónde quieres que estén las canciones?'),
    el('ul', { class: 'upload-options' },
      OPTIONS.map((item) => el('li', {},
        el('button', { type: 'button', class: 'upload-option', 'data-testid': `upload-option-${item.key}`, on: { click: () => show(item.key) } },
          el('span', { class: 'upload-option-icon', 'aria-hidden': 'true' }, icon(item.icon, { size: 24 })),
          el('span', { class: 'upload-option-text' },
            el('span', { class: 'upload-option-title' }, item.title),
            el('span', { class: 'upload-option-desc' }, item.text)))))));
}

function backButton(back) {
  return el('button', { type: 'button', class: 'button button-text upload-back', 'data-testid': 'upload-back', on: { click: back } },
    icon('chevron-left', { size: 20 }), 'Otras opciones');
}

function panelFor(key, ctx, back) {
  if (key === 'todos') return publicPanel(back);
  if (key === 'archive') return archivePanel(back);
  return localPanel(ctx, back);
}

// ---------------------------------------------------------------------------
// Solo en este navegador
// ---------------------------------------------------------------------------

function localPanel(ctx, back) {
  const inputId = uid('archivos');
  // El campo de archivo va oculto: lo abre el botón visible, que sí recibe el foco con el teclado.
  const input = el('input', { id: inputId, type: 'file', accept: LOCAL_AUDIO_ACCEPT, multiple: true, hidden: true, 'data-testid': 'upload-file-input' });
  const pick = el('button', {
    type: 'button',
    class: 'button button-primary upload-pick',
    'data-testid': 'upload-pick',
    on: { click: () => { if (pick.getAttribute('aria-disabled') !== 'true') input.click(); } },
  }, icon('upload', { size: 20 }), 'Elegir archivos');
  const progress = el('progress', { class: 'upload-progress', max: '100', value: '0', hidden: true, 'aria-label': 'Progreso de la conversión' });
  const status = el('p', { class: 'upload-status', role: 'status', 'data-testid': 'upload-status' });
  const failures = el('ul', { class: 'upload-failures', 'data-testid': 'upload-failures' });
  const mine = el('ul', { class: 'upload-local-list', 'data-testid': 'upload-local-list' });
  const support = el('p', { class: 'upload-note', 'data-testid': 'upload-support' });

  const paintMine = () => {
    const songs = ctx.localSongs();
    mine.replaceChildren(...songs.map((song) => el('li', { class: 'upload-local-row', 'data-song-id': song.id },
      el('span', { class: 'upload-local-text' },
        el('span', { class: 'add-title' }, song.title),
        el('span', { class: 'track-artist' }, formatDuration(song.durationS ?? NaN))),
      el('button', {
        type: 'button',
        class: 'button button-outline',
        'aria-label': `Borrar ${song.title} de este navegador`,
        'data-testid': 'upload-delete',
        on: { click: async () => { if (await ctx.deleteLocalSong(song)) paintMine(); } },
      }, 'Borrar'))));
    if (songs.length === 0) mine.append(el('li', { class: 'empty-text' }, 'Todavía no has subido ninguna.'));
  };

  opusSupport().then((result) => {
    if (!result.ok) {
      support.textContent = UNSUPPORTED_TEXT;
      support.classList.add('is-warning');
    }
  });

  input.addEventListener('change', async () => {
    const files = [...input.files];
    input.value = '';
    if (files.length === 0) return;
    pick.setAttribute('aria-disabled', 'true');
    progress.hidden = false;
    failures.replaceChildren();
    try {
      const result = await addLocalFiles(files, {
        onProgress: ({ index, total, name, fraction }) => {
          progress.value = String(Math.round(((index + fraction) / total) * 100));
          status.textContent = `Convirtiendo ${index + 1} de ${total}: ${name}…`;
        },
      });
      if (result.added.length > 0) await ctx.onLocalAdded(result.added);
      const added = result.added.length;
      status.textContent = added === 0
        ? 'No se ha añadido ninguna canción.'
        : `${added === 1 ? 'Se ha añadido 1 canción' : `Se han añadido ${added} canciones`} a este navegador.`;
      failures.replaceChildren(...result.failed.map((item) => el('li', {}, `${item.name}: ${item.message}`)));
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : 'No se pudieron añadir los archivos.';
    } finally {
      progress.hidden = true;
      pick.removeAttribute('aria-disabled');
      paintMine();
    }
  });
  paintMine();

  return el('div', { class: 'upload-panel', 'data-testid': 'upload-panel-local' },
    backButton(back),
    el('h3', { class: 'upload-panel-title', 'data-autofocus': '', tabindex: '-1' }, 'Solo en este navegador'),
    el('p', { class: 'dialog-text' },
      `Elige archivos de audio (WAV, MP3, M4A, OGG o FLAC). Se convierten a Opus y se guardan solo en este navegador: no se envían a ningún servidor. Hasta ${Math.round(MAX_FILE_BYTES / (1024 * 1024))} MB y ${MAX_DURATION_S / 60} minutos por archivo.`),
    el('p', { class: 'upload-note' }, 'Si borras los datos del sitio o cambias de dispositivo, se pierden.'),
    support,
    el('div', { class: 'upload-row' }, input, pick),
    progress,
    status,
    failures,
    el('h3', { class: 'upload-subtitle' }, 'Subidas a este navegador'),
    mine);
}

// ---------------------------------------------------------------------------
// Para todos (GitHub)
// ---------------------------------------------------------------------------

function publicPanel(back) {
  return el('div', { class: 'upload-panel', 'data-testid': 'upload-panel-todos' },
    backButton(back),
    el('h3', { class: 'upload-panel-title', 'data-autofocus': '', tabindex: '-1' }, 'Para todos'),
    el('p', { class: 'dialog-text' }, 'Las canciones se suben al buzón del repositorio en GitHub y entran en la biblioteca pública cuando se procesan.'),
    el('ul', { class: 'upload-rules', 'data-testid': 'upload-rules' },
      el('li', {}, 'Hace falta una cuenta de GitHub con permiso de escritura en el repositorio.'),
      el('li', {}, 'La web de GitHub admite hasta 25 MB por archivo.'),
      el('li', {}, 'El mensaje del commit debe llevar una línea «Licencia: …» (por ejemplo, «Licencia: CC BY 4.0»). Sin ella, las canciones quedan privadas.'),
      el('li', {}, 'Quien sube las canciones responde de esa declaración de licencia.')),
    el('a', {
      class: 'button button-primary',
      href: GITHUB_UPLOAD_URL,
      target: '_blank',
      rel: 'noopener noreferrer',
      'data-testid': 'upload-github-link',
    }, 'Abrir la subida en GitHub', el('span', { class: 'sr-only' }, ' (se abre en otra pestaña)'), icon('external', { size: 18 })));
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
