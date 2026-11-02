// Pestaña «Observaciones» del perfil (DESIGN C3a y C-23): lista cronológica con fecha y hora, etiquetas, canción y nota.
// «Nueva observación» abre la hoja (observacion-hoja.js). La ruta observaciones/:profileId/nueva abre la misma hoja
// y vuelve a la pestaña cuando se cierra.

import {
  compareIds, h, messageOf, nextId, observationTagLabel, openObservationSheet,
} from './observacion-hoja.js';

// Ruta de la hoja a pantalla completa (contrato 2.4): observaciones/:profileId/nueva.
export const routes = Object.freeze({ observaciones: mountNewObservationRoute });

// Orden de la lista: la observación más reciente primero; a igual hora, por identificador.
export function orderObservations(observations) {
  return observations.slice().sort((a, b) => (b.at - a.at) || compareIds(a.id, b.id));
}

// Textos de las etiquetas de una observación. Las etiquetas desconocidas se omiten.
export function observationTagLabels(codes = [], otherText = '') {
  return (Array.isArray(codes) ? codes : [])
    .map((code) => observationTagLabel(code, otherText))
    .filter(Boolean);
}

// Fecha y hora en castellano, por ejemplo «2 nov 2026, 10:42».
export function formatObservationTime(at) {
  return new Intl.DateTimeFormat('es-ES', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(at));
}

// Monta la pestaña en root. Devuelve { unmount() }.
export function mountObservations(root, services, { profileId } = {}) {
  let disposed = false;
  const headingId = nextId('cc-observaciones');
  const statusNode = h('p', { class: 'cc-estado', role: 'status', text: 'Cargando observaciones…' });
  const alertNode = h('p', { class: 'cc-alerta', role: 'alert', hidden: true });
  const emptyNode = h('p', {
    class: 'cc-vacio',
    hidden: true,
    text: 'Todavía no hay observaciones para este perfil. Usa «Nueva observación» para registrar la primera.',
  });
  const listNode = h('ol', { class: 'cc-observaciones', 'aria-labelledby': headingId });
  const newButton = h('button', {
    type: 'button',
    class: 'cc-boton cc-boton--primario',
    'data-testid': 'c-observation-new',
    text: 'Nueva observación',
    onClick: openNew,
  });

  root.replaceChildren(h('section', { class: 'cc-seccion' },
    h('div', { class: 'cc-seccion-cabecera' },
      h('h2', { id: headingId, class: 'cc-seccion-titulo', text: 'Observaciones' }),
      newButton),
    statusNode, alertNode, emptyNode, listNode));

  // Título de la canción vinculada; si ya no está en el catálogo, se dice así.
  function songTitle(songId) {
    const song = (services.catalog?.songs ?? []).find((item) => item.id === songId);
    return song?.title || 'Canción no disponible en el catálogo';
  }

  function observationRow(observation) {
    const labels = observationTagLabels(observation.tags, observation.otherTag);
    const song = observation.songId ? songTitle(observation.songId) : '';
    return h('li', { class: 'cc-observacion' },
      h('time', {
        class: 'cc-observacion-fecha',
        datetime: new Date(observation.at).toISOString(),
        text: formatObservationTime(observation.at),
      }),
      labels.length > 0
        ? h('ul', { class: 'cc-etiquetas-lista', 'aria-label': 'Etiquetas' },
          labels.map((label) => h('li', { class: 'cc-etiqueta', text: label })))
        : null,
      song ? h('p', { class: 'cc-meta', text: `Canción: ${song}` }) : null,
      observation.text ? h('p', { class: 'cc-observacion-nota', text: observation.text }) : null);
  }

  // Abre la hoja; si se guardó una observación, la lista se vuelve a leer.
  async function openNew() {
    const saved = await openObservationSheet(services, { profileId });
    if (saved && !disposed) await load();
  }

  async function load() {
    try {
      const observations = orderObservations(await services.store.listObservations(profileId));
      if (disposed) return;
      statusNode.hidden = true;
      alertNode.hidden = true;
      emptyNode.hidden = observations.length > 0;
      listNode.hidden = observations.length === 0;
      listNode.replaceChildren(...observations.map(observationRow));
    } catch (error) {
      if (disposed) return;
      statusNode.hidden = true;
      alertNode.textContent = messageOf(error, 'No se pudieron cargar las observaciones.');
      alertNode.hidden = false;
    }
  }

  load();
  return {
    unmount() {
      disposed = true;
      root.replaceChildren();
    },
  };
}

// Ruta observaciones/:profileId/nueva: abre la hoja y, al cerrarla (guardada o no), vuelve a las observaciones del perfil.
export function mountNewObservationRoute(root, services, { profileId } = {}) {
  let closed = false;
  const back = () => services.navigate('perfil', { profileId, tab: 'observaciones' });
  services.setTitle?.('Nueva observación');
  root.replaceChildren(h('div', { class: 'cc-editor' },
    h('button', { type: 'button', class: 'cc-enlace', text: '‹ Volver a observaciones', onClick: back }),
    h('p', { class: 'cc-estado', text: 'Registra la observación en la hoja que se abre.' })));
  openObservationSheet(services, { profileId }).then(
    () => { if (!closed) back(); },
    () => { if (!closed) back(); },
  );
  return {
    unmount() {
      closed = true;
      root.replaceChildren();
    },
  };
}
