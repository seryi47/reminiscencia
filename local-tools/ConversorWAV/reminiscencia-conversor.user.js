// ==UserScript==
// @name         Reminiscencia · Conversor a WAV (local)
// @namespace    reminiscencia-local
// @version      1.0
// @description  Añade un botón "Convertir a WAV (local)" en el menú Crear, SOLO cuando abres la app en local. No toca el repo ni se publica; usa el servidor local de local-tools/ConversorWAV.
// @match        http://localhost:*/*
// @match        http://127.0.0.1:*/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==
(function () {
  'use strict';
  const SERVIDOR = 'http://127.0.0.1:8787';

  // Cuando se abre el menú "Crear" (lo detectamos por el item 'menu-upload'),
  // clonamos ese item para heredar el estilo y lo convertimos en el nuestro.
  function inyectar(menu) {
    if (menu.querySelector('[data-testid="menu-convertir-wav"]')) return;
    const modelo = menu.querySelector('[data-testid="menu-upload"]');
    if (!modelo) return; // no es el menú Crear
    const nuevo = modelo.cloneNode(true);
    nuevo.setAttribute('data-testid', 'menu-convertir-wav');
    const label = nuevo.querySelector('.menu-label');
    const desc = nuevo.querySelector('.menu-description');
    if (label) label.textContent = 'Convertir a WAV (local)';
    if (desc) desc.textContent = 'Saca el audio de tus vídeos de YouTube. Solo en tu Mac.';
    nuevo.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const url = prompt('Pega la URL de TU vídeo o playlist de YouTube:');
      if (!url) return;
      const carpeta = prompt('Carpeta de salida (en el Escritorio):', 'Mis videos') || 'Mis videos';
      try {
        await fetch(SERVIDOR + '/convertir', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url, carpeta }),
        });
        window.open(SERVIDOR + '/', '_blank'); // abre la página local para ver el progreso
      } catch (err) {
        alert('No encuentro el conversor local.\n\nArráncalo primero con:\n' +
              'local-tools/ConversorWAV/Abrir conversor local.command');
      }
    }, true);
    modelo.after(nuevo);
  }

  // El menú se pinta y se quita al vuelo: lo vigilamos con un observador.
  const obs = new MutationObserver((muts) => {
    for (const m of muts) {
      for (const n of m.addedNodes) {
        if (n.nodeType !== 1) continue;
        const menu = n.matches && n.matches('[data-testid="menu"]')
          ? n : (n.querySelector && n.querySelector('[data-testid="menu"]'));
        if (menu) inyectar(menu);
      }
    }
  });
  obs.observe(document.body, { childList: true, subtree: true });
})();
