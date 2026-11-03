// Hoja «Homeostasia» (menú «Crear»). Toda la lógica del botón vive en este archivo.
// Lo que se elige aquí va a GitHub por el mismo camino que «Subir canciones» (ADR-0017): la cola de subidas de la app
// (ctx.addUploads) lo convierte a Opus en el navegador, lo envía por trozos a /api/subir y el workflow buzon lo cataloga
// y lo publica. Un ZIP se descomprime en el navegador y sube cada canción; el ZIP no se sube.

import { PUBLIC_AUDIO_ACCEPT, RIGHTS_TEXT } from '../cuidador/subida-publica.js';
import { summaryText } from '../cuidador/subida-estado.js';
import { ZIP_ACCEPT } from '../cuidador/subida-zip.js';
import { el, openDialog, uid } from '../ui/dom.js';
import { icon } from '../ui/icons.js';

/** Abre la hoja «Homeostasia». ctx aporta addUploads, uploads y openUpload (los mismos que usa «Subir canciones»). */
export function openHomeostasiaSheet(ctx) {
  return openDialog({
    title: 'Homeostasia',
    className: 'dialog-homeostasia',
    testid: 'homeostasia-sheet',
    render: (body, close, dialog) => {
      const panel = homeostasiaPanel(ctx, close);
      dialog?.addEventListener('close', () => panel.cleanup());
      body.replaceChildren(panel.node);
      body.querySelector('[data-autofocus]')?.focus();
    },
  });
}

function homeostasiaPanel(ctx, close) {
  const input = el('input', {
    id: uid('homeostasia'),
    type: 'file',
    accept: `${PUBLIC_AUDIO_ACCEPT},${ZIP_ACCEPT}`,
    multiple: true,
    hidden: true,
    'data-testid': 'homeostasia-file-input',
  });
  const pick = el('button', {
    type: 'button',
    class: 'button button-primary upload-pick',
    'data-testid': 'homeostasia-pick',
    on: { click: () => input.click() },
  }, icon('upload', { size: 20 }), 'Enviar a GitHub');
  const status = el('p', { class: 'upload-status', role: 'status', 'data-testid': 'homeostasia-status' });
  const progress = el('button', {
    type: 'button',
    class: 'button button-text',
    'data-testid': 'homeostasia-progress',
    hidden: true,
    on: { click: () => { close?.(); ctx.openUpload(); } },
  }, 'Ver el progreso');

  input.addEventListener('change', () => {
    const files = [...input.files];
    input.value = '';
    if (files.length === 0) return;
    ctx.addUploads(files);
    status.textContent = files.length === 1
      ? `Enviando «${files[0].name}» a GitHub…`
      : `Enviando ${files.length} archivos a GitHub…`;
    progress.hidden = false;
  });

  // Resumen de la cola de subidas («1 de 2 publicadas»), el mismo que muestra «Subir canciones».
  const paint = (items) => {
    if (items.length > 0 && !progress.hidden) status.textContent = summaryText(items);
  };
  const unsubscribe = ctx.uploads?.subscribe((items) => paint(items)) ?? (() => {});

  const node = el('div', { class: 'upload-panel', 'data-testid': 'homeostasia-panel' },
    el('p', { class: 'dialog-text', 'data-autofocus': '', tabindex: '-1' },
      'Elige archivos de audio (WAV, MP3, M4A, FLAC, OGG u OPUS) o ZIP con canciones. Se envían a GitHub y la biblioteca los publica para todos, con el nombre del archivo como título.'),
    el('p', { class: 'upload-note' }, RIGHTS_TEXT),
    el('div', { class: 'upload-row' }, input, pick),
    status,
    progress,
  );
  return { node, cleanup: unsubscribe };
}
