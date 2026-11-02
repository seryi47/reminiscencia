// Pestaña «Recuerdos» del perfil (DESIGN C3a y C3c): cada recuerdo con su título, año, personas y número de canciones
// y de fotografías, y «Nuevo recuerdo». Cada fila lleva a su editor (ruta recuerdo/:profileId/:memoryId).
// Las funciones puras (orden, textos) se prueban en tests/web-unit/cuidador-contenido.test.mjs.

import { compareIds, h, messageOf, nextId, pluralize } from './observacion-hoja.js';

// Año de un recuerdo como texto: «Año 1974», «Año aproximado: 1974» o «Sin año».
export function formatMemoryYear(memory) {
  if (memory.year === null || memory.year === undefined) return 'Sin año';
  return memory.yearApproximate ? `Año aproximado: ${memory.year}` : `Año ${memory.year}`;
}

// Orden de la lista: por año, de menor a mayor (los recuerdos sin año, al final); después por título y, por último,
// por identificador. Así la lista sigue la vida que describe, no el orden en que se escribieron los recuerdos.
export function orderMemories(memories) {
  const yearOf = (memory) => (memory.year === null || memory.year === undefined ? Infinity : memory.year);
  return memories.slice().sort((a, b) => {
    const yearA = yearOf(a);
    const yearB = yearOf(b);
    if (yearA !== yearB) return yearA < yearB ? -1 : 1;
    const byTitle = String(a.title ?? '').localeCompare(String(b.title ?? ''), 'es');
    if (byTitle !== 0) return byTitle;
    return compareIds(a.id, b.id);
  });
}

// Textos de una fila del recuerdo: título, año, personas y recuentos de canciones y fotografías.
export function describeMemory(memory) {
  const people = Array.isArray(memory.people) ? memory.people : [];
  const songs = Array.isArray(memory.songIds) ? memory.songIds.length : 0;
  const photos = Array.isArray(memory.photoIds) ? memory.photoIds.length : 0;
  return {
    title: memory.title || 'Sin título',
    year: formatMemoryYear(memory),
    people: people.length > 0 ? `Personas: ${people.join(', ')}` : 'Sin personas',
    songs: pluralize(songs, 'canción', 'canciones'),
    photos: pluralize(photos, 'fotografía', 'fotografías'),
  };
}

// Monta la pestaña en root. Devuelve { unmount() }.
export function mountMemories(root, services, { profileId } = {}) {
  let disposed = false;
  const headingId = nextId('cc-recuerdos');
  const statusNode = h('p', { class: 'cc-estado', role: 'status', text: 'Cargando recuerdos…' });
  const alertNode = h('p', { class: 'cc-alerta', role: 'alert', hidden: true });
  const emptyNode = h('p', {
    class: 'cc-vacio',
    hidden: true,
    text: 'Este perfil todavía no tiene recuerdos. Crea el primero con «Nuevo recuerdo».',
  });
  const listNode = h('ul', { class: 'cc-lista' });
  const newButton = h('button', {
    type: 'button',
    class: 'cc-boton cc-boton--primario',
    'data-testid': 'c-memory-new',
    text: 'Nuevo recuerdo',
    onClick: () => services.navigate('recuerdo', { profileId, memoryId: 'nuevo' }),
  });

  root.replaceChildren(h('section', { class: 'cc-seccion', 'aria-labelledby': headingId },
    h('div', { class: 'cc-seccion-cabecera' },
      h('h2', { id: headingId, class: 'cc-seccion-titulo', text: 'Recuerdos' }),
      newButton),
    statusNode, alertNode, emptyNode, listNode));

  // Una fila por recuerdo. La marca «Recuerdo» lleva el color cálido de la paleta (DESIGN 4) con su palabra.
  function memoryRow(memory) {
    const info = describeMemory(memory);
    return h('li', { class: 'cc-fila cc-fila-recuerdo' },
      h('p', { class: 'cc-marca-recuerdo', text: 'Recuerdo' }),
      h('h3', { class: 'cc-fila-titulo' },
        h('button', {
          type: 'button',
          class: 'cc-fila-enlace',
          text: info.title,
          onClick: () => services.navigate('recuerdo', { profileId, memoryId: memory.id }),
        })),
      h('p', { class: 'cc-meta', text: `${info.year} · ${info.people}` }),
      h('p', { class: 'cc-meta', text: `${info.songs} · ${info.photos}` }));
  }

  async function load() {
    try {
      const memories = orderMemories(await services.store.listMemories(profileId));
      if (disposed) return;
      statusNode.hidden = true;
      emptyNode.hidden = memories.length > 0;
      listNode.replaceChildren(...memories.map(memoryRow));
    } catch (error) {
      if (disposed) return;
      statusNode.hidden = true;
      alertNode.textContent = messageOf(error, 'No se pudieron cargar los recuerdos.');
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
