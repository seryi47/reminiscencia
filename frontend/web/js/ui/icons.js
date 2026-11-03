// Iconos propios en SVG (24 × 24), dibujados para Reminiscencia. No reproducen iconos ni logotipos de ninguna marca.
// Cada icono es una lista de formas: [etiqueta, atributos]. Por defecto se dibujan con trazo (stroke); las formas con
// fill: true van rellenas. Todos son decorativos (aria-hidden): el nombre accesible lo da el control que los contiene.

const SVG_NS = 'http://www.w3.org/2000/svg';

const ICONS = Object.freeze({
  home: [['path', { d: 'M12 3.2 3.5 10.3V20.5h6v-6h5v6h6V10.3L12 3.2z' }]],
  'home-filled': [['path', { d: 'M12 3.2 3.5 10.3V20.5h6v-6h5v6h6V10.3L12 3.2z', fill: true }]],
  search: [['circle', { cx: 10.5, cy: 10.5, r: 6.5 }], ['path', { d: 'm15.5 15.5 5 5' }]],
  'search-filled': [['circle', { cx: 10.5, cy: 10.5, r: 6.5, 'stroke-width': 3 }], ['path', { d: 'm15.5 15.5 5 5', 'stroke-width': 3 }]],
  library: [['path', { d: 'M4.5 3.5v17M9.5 3.5v17M14 4.2l5.5 16.3' }]],
  'library-filled': [['path', { d: 'M4.5 3.5v17M9.5 3.5v17M14 4.2l5.5 16.3', 'stroke-width': 3 }]],
  plus: [['path', { d: 'M12 5v14M5 12h14' }]],
  upload: [['path', { d: 'M12 15.5V4M7 8.5 12 3.8l5 4.7M4 15v4.5h16V15' }]],
  play: [['path', { d: 'M8 5.2v13.6a1 1 0 0 0 1.5.86l10.8-6.8a1 1 0 0 0 0-1.72L9.5 4.34A1 1 0 0 0 8 5.2z', fill: true }]],
  pause: [['path', { d: 'M6.5 4.5h3.8v15H6.5zM13.7 4.5h3.8v15h-3.8z', fill: true }]],
  next: [['path', { d: 'M5 5.6v12.8a.8.8 0 0 0 1.23.67L15.5 13v5.5h2.6v-13h-2.6V11L6.23 4.93A.8.8 0 0 0 5 5.6z', fill: true }]],
  previous: [['path', { d: 'M19 5.6v12.8a.8.8 0 0 1-1.23.67L8.5 13v5.5H5.9v-13h2.6V11l9.27-6.07A.8.8 0 0 1 19 5.6z', fill: true }]],
  shuffle: [['path', { d: 'M3 7h3.3c2 0 3.2.9 4.3 2.6l2.6 4.8c1.1 1.7 2.3 2.6 4.3 2.6H21M3 17h3.3c1.3 0 2.3-.4 3.1-1.2M14.4 8.2c.8-.8 1.8-1.2 3.1-1.2H21M18 4l3 3-3 3M18 14l3 3-3 3' }]],
  repeat: [['path', { d: 'M17 2.5 20 5.5l-3 3M4 11.5V9.5a4 4 0 0 1 4-4h12M7 21.5l-3-3 3-3M20 12.5v2a4 4 0 0 1-4 4H4' }]],
  'repeat-one': [
    ['path', { d: 'M17 2.5 20 5.5l-3 3M4 11.5V9.5a4 4 0 0 1 4-4h12M7 21.5l-3-3 3-3M20 12.5v2a4 4 0 0 1-4 4H4' }],
    ['path', { d: 'M11 10.6 12.6 9.5V15', 'stroke-width': 1.8 }],
  ],
  heart: [['path', { d: 'M12 20.2 10.8 19C6.1 14.8 3 12.1 3 8.8 3 6.2 5.1 4.1 7.7 4.1c1.6 0 3.1.8 4.3 2 1.2-1.2 2.7-2 4.3-2C18.9 4.1 21 6.2 21 8.8c0 3.3-3.1 6-7.8 10.2L12 20.2z' }]],
  'heart-filled': [['path', { d: 'M12 20.2 10.8 19C6.1 14.8 3 12.1 3 8.8 3 6.2 5.1 4.1 7.7 4.1c1.6 0 3.1.8 4.3 2 1.2-1.2 2.7-2 4.3-2C18.9 4.1 21 6.2 21 8.8c0 3.3-3.1 6-7.8 10.2L12 20.2z', fill: true }]],
  queue: [['path', { d: 'M3 5.5h14M3 11h14M3 16.5h8' }], ['path', { d: 'M15 14v7l5.5-3.5z', fill: true }]],
  volume: [['path', { d: 'M3.5 9v6h4l5 4V5l-5 4h-4z', fill: true }], ['path', { d: 'M16 8.5a5 5 0 0 1 0 7M18.6 5.9a8.6 8.6 0 0 1 0 12.2' }]],
  'volume-muted': [['path', { d: 'M3.5 9v6h4l5 4V5l-5 4h-4z', fill: true }], ['path', { d: 'm16 9.5 5 5M21 9.5l-5 5' }]],
  more: [
    ['circle', { cx: 5, cy: 12, r: 1.8, fill: true }],
    ['circle', { cx: 12, cy: 12, r: 1.8, fill: true }],
    ['circle', { cx: 19, cy: 12, r: 1.8, fill: true }],
  ],
  clock: [['circle', { cx: 12, cy: 12, r: 8.5 }], ['path', { d: 'M12 7.5V12l3 2' }]],
  download: [['circle', { cx: 12, cy: 12, r: 9 }], ['path', { d: 'M12 7.5v8M8.5 12 12 15.5l3.5-3.5' }]],
  downloaded: [['circle', { cx: 12, cy: 12, r: 10, fill: true }], ['path', { d: 'M12 7v8M8.3 11.6 12 15.3l3.7-3.7', stroke: '#000' }]],
  note: [['path', { d: 'M9 17.5V5.5l10-2v12' }], ['circle', { cx: 6.5, cy: 17.5, r: 2.5 }], ['circle', { cx: 16.5, cy: 15.5, r: 2.5 }]],
  folder: [['path', { d: 'M3 6.5A1.5 1.5 0 0 1 4.5 5h4.7l2 2.2h8.3A1.5 1.5 0 0 1 21 8.7v9.8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5z' }]],
  list: [['path', { d: 'M4 6h16M4 12h16M4 18h10' }]],
  device: [['path', { d: 'M4.5 5h15v10.5h-15zM2 19h20' }]],
  archive: [['path', { d: 'M3 4h18v4H3zM5 8v12h14V8M10 12h4' }]],
  people: [['circle', { cx: 9, cy: 8, r: 3.5 }], ['path', { d: 'M2.5 20c.5-3.6 3.1-6 6.5-6s6 2.4 6.5 6M15.5 4.8a3.5 3.5 0 0 1 0 6.4M18 14.4c2 .8 3.2 2.8 3.5 5.6' }]],
  'chevron-down': [['path', { d: 'm6 9 6 6 6-6' }]],
  'chevron-left': [['path', { d: 'm15 5-7 7 7 7' }]],
  close: [['path', { d: 'M6 6l12 12M18 6 6 18' }]],
  external: [['path', { d: 'M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5' }]],
  trash: [['path', { d: 'M4 7h16M9.5 7V4.5h5V7M6.2 7l1 13h9.6l1-13' }]],
  check: [['path', { d: 'm5 12.5 4.5 4.5L19 7.5' }]],
  offline: [['path', { d: 'M3 3l18 18M8.5 16.5a5 5 0 0 1 7 0M5 13a10 10 0 0 1 4.2-2.4M12 9.6a10 10 0 0 1 7 3.4M2 9.5a15 15 0 0 1 4-2.6M10.5 5.6a15 15 0 0 1 11.5 3.9' }], ['circle', { cx: 12, cy: 19.5, r: 1, fill: true }]],
  // Explorar: una bandeja con una ranura.
  browse: [['path', { d: 'M3.5 9.5 6 4.5h12l2.5 5v10h-17zM3.5 9.5h17M9.5 13.5h5' }]],
  'browse-filled': [['path', { d: 'M3.5 9.5 6 4.5h12l2.5 5v10h-17z', fill: true }], ['path', { d: 'M3.5 9.5h17M9.5 13.5h5', stroke: '#000' }]],
  // Reproduciendo: una pantalla con un triángulo.
  'now-playing': [['path', { d: 'M3 4.5h18v15H3z' }], ['path', { d: 'M10 9v6l5-3z', fill: true }]],
  lyrics: [['circle', { cx: 15, cy: 9, r: 5 }], ['path', { d: 'm11.5 12.5-7.5 7.5M8.5 12.5l3 3' }]],
  speaker: [['path', { d: 'M6 3h12v18H6z' }], ['circle', { cx: 12, cy: 14.5, r: 3 }], ['circle', { cx: 12, cy: 7.2, r: 1, fill: true }]],
  fullscreen: [['path', { d: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5' }]],
  pencil: [['path', { d: 'M4 20h4L19.2 8.8a2.1 2.1 0 0 0-3-3L5 17v3zM14.5 7.5l2.9 2.9' }]],
  image: [['path', { d: 'M3.5 4.5h17v15h-17z' }], ['circle', { cx: 9, cy: 9.5, r: 1.8 }], ['path', { d: 'm4 17.5 5-5 4 4 2.5-2.5 5 4.5' }]],
  sort: [['path', { d: 'M4 6h16M4 12h11M4 18h7' }]],
  album: [['circle', { cx: 12, cy: 12, r: 9 }], ['circle', { cx: 12, cy: 12, r: 2.5 }]],
  copy: [['path', { d: 'M8.5 8.5h11v11h-11zM15.5 8.5v-4h-11v11h4' }]],
  'arrow-left': [['path', { d: 'M20 12H5M11 5.5 4.5 12l6.5 6.5' }]],
});

/** Crea un icono SVG decorativo. size en píxeles (por defecto 24). */
export function icon(name, { size = 24, className = '' } = {}) {
  const doc = globalThis.document;
  const shapes = ICONS[name];
  if (!shapes) throw new RangeError(`Icono desconocido: ${name}`);
  const svg = doc.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.setAttribute('class', `icon${className ? ` ${className}` : ''}`);
  for (const [tag, attrs] of shapes) {
    const node = doc.createElementNS(SVG_NS, tag);
    const { fill, ...rest } = attrs;
    node.setAttribute('fill', fill ? 'currentColor' : 'none');
    if (!fill || rest.stroke) {
      if (!rest.stroke) node.setAttribute('stroke', 'currentColor');
      if (!rest['stroke-width']) node.setAttribute('stroke-width', '2');
      node.setAttribute('stroke-linecap', 'round');
      node.setAttribute('stroke-linejoin', 'round');
    }
    for (const [key, value] of Object.entries(rest)) node.setAttribute(key, String(value));
    svg.append(node);
  }
  return svg;
}
