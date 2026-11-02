// Pestaña «Listas» del perfil (DESIGN C3a): cada lista con su nombre y su número de canciones, y «Nueva lista»,
// que abre el editor de lista (C3b). La pantalla de perfil (perfil.js) monta esta pestaña en su área de contenido.

import { h, messageOf, nextId, pluralize } from './observacion-hoja.js';

// Texto del número de canciones de una lista: «Sin canciones», «1 canción» o «3 canciones».
export function songCountText(count) {
  return count === 0 ? 'Sin canciones' : pluralize(count, 'canción', 'canciones');
}

// Monta la pestaña en root. Devuelve { unmount() }.
export function mountProfileLists(root, services, { profileId } = {}) {
  let disposed = false;
  const headingId = nextId('cc-listas');
  const statusNode = h('p', { class: 'cc-estado', role: 'status', text: 'Cargando listas…' });
  const alertNode = h('p', { class: 'cc-alerta', role: 'alert', hidden: true });
  const emptyNode = h('p', {
    class: 'cc-vacio',
    hidden: true,
    text: 'Este perfil todavía no tiene listas. Crea una con «Nueva lista».',
  });
  const listNode = h('ul', { class: 'cc-lista' });
  const newButton = h('button', {
    type: 'button',
    class: 'cc-boton cc-boton--primario',
    'data-testid': 'c-list-new',
    text: 'Nueva lista',
    onClick: () => services.navigate('lista', { profileId, listId: 'nueva' }),
  });

  root.replaceChildren(h('section', { class: 'cc-seccion', 'aria-labelledby': headingId },
    h('div', { class: 'cc-seccion-cabecera' },
      h('h2', { id: headingId, class: 'cc-seccion-titulo', text: 'Listas' }),
      newButton),
    statusNode, alertNode, emptyNode, listNode));

  // Una fila por lista: el nombre lleva al editor; debajo, el número de canciones.
  function listRow(list) {
    return h('li', { class: 'cc-fila' },
      h('h3', { class: 'cc-fila-titulo' },
        h('button', {
          type: 'button',
          class: 'cc-fila-enlace',
          text: list.name,
          onClick: () => services.navigate('lista', { profileId, listId: list.id }),
        })),
      h('p', { class: 'cc-meta', text: songCountText(list.songIds.length) }));
  }

  async function load() {
    try {
      const lists = await services.store.listPlaylists(profileId);
      if (disposed) return;
      statusNode.hidden = true;
      emptyNode.hidden = lists.length > 0;
      listNode.replaceChildren(...lists.map(listRow));
    } catch (error) {
      if (disposed) return;
      statusNode.hidden = true;
      alertNode.textContent = messageOf(error, 'No se pudieron cargar las listas.');
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
