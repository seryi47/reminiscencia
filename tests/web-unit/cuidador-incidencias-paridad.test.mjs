// Paridad de las incidencias de la biblioteca con el backend de main (ADR-0008). La lista de bloqueo y la validación de
// direcciones y de texto no aceptan nada que el backend rechace (backend/sonidos/sources.py e issue_request.py). Cada
// bloque cubre una diferencia que estaba en la interfaz y se corrigió. Todos los datos son ficticios.
// Ejecución: node --test tests/web-unit/cuidador-incidencias-paridad.test.mjs

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  BLOCKED_HOSTS,
  PROCESSING_NOTE,
  buildIssueBody,
  classifyUrl,
  validateImportRequest,
  validateOperation,
  validateUrl,
} from '../../frontend/web/js/cuidador/incidencias.js';

const IA_ITEM = 'https://archive.org/details/ejemplo-de-prueba';
const DIRECT = 'https://ejemplo.org/audio/tema.mp3';

describe('lista de bloqueo (copia de BLOCKED_HOSTS de sources.py)', () => {
  test('tiene las 42 entradas de sources.py de main, sin repetir', () => {
    assert.equal(new Set(BLOCKED_HOSTS).size, 42);
    assert.equal(BLOCKED_HOSTS.length, 42);
  });

  test('cada entrada bloquea su dominio, sus subdominios, www. y el punto final', () => {
    for (const host of BLOCKED_HOSTS) {
      assert.equal(classifyUrl(`https://${host}/tema.mp3`), 'blocked', host);
      assert.equal(classifyUrl(`https://sub.${host}/tema.mp3`), 'blocked', host);
      assert.equal(classifyUrl(`https://www.${host}./tema.mp3`), 'blocked', host);
    }
  });

  test('las plataformas que antes no estaban en la lista se rechazan con el motivo de plataforma', () => {
    for (const host of ['dailymotion.com', 'deezer.com', 'twitch.tv', 'x.com', 'reddit.com', 'rumble.com']) {
      assert.match(validateUrl(`https://${host}/tema.mp3`), /no se puede importar/, host);
    }
  });
});

describe('direcciones privadas, de bucle local y de enlace local', () => {
  test('un fichero directo en localhost o en una IP no global se rechaza antes de pedir la licencia', () => {
    const hosts = [
      'localhost', 'api.localhost', '127.0.0.1', '10.1.2.3', '192.168.0.5', '172.16.0.9', '169.254.169.254',
      '100.64.0.1', '0.0.0.0', '198.18.0.7', '203.0.113.9', '240.0.0.1', '255.255.255.255',
    ];
    for (const host of hosts) {
      assert.equal(classifyUrl(`https://${host}/audio/tema.mp3`), 'private', host);
      assert.match(validateUrl(`https://${host}/audio/tema.mp3`), /red privada/, host);
      assert.equal(validateImportRequest({ url: `https://${host}/audio/tema.mp3`, license: 'CC0 1.0' }).field, 'url', host);
    }
  });

  test('las IP públicas siguen siendo ficheros directos, también en el borde de 172.16.0.0/12 y en 192.0.0.9', () => {
    assert.equal(classifyUrl('https://172.32.0.1/audio/tema.mp3'), 'direct');
    assert.equal(classifyUrl('https://8.8.8.8/audio/tema.mp3'), 'direct');
    assert.equal(classifyUrl('https://192.0.0.9/audio/tema.mp3'), 'direct');
  });

  test('un host de una sola etiqueta o una IP escrita de otra forma no es válido', () => {
    for (const host of ['intranet', '2130706433', '127.1', '0x7f000001', 'ejemplo.2130706433']) {
      assert.equal(classifyUrl(`https://${host}/audio/tema.mp3`), 'invalid', host);
      assert.match(validateUrl(`https://${host}/audio/tema.mp3`), /revisa el dominio/, host);
    }
  });
});

describe('Internet Archive (ia_identifier y classify del backend)', () => {
  test('un fichero de un servidor de Internet Archive no se importa como directo, aunque tenga extensión de audio', () => {
    assert.equal(classifyUrl('https://ia800100.us.archive.org/5/items/ejemplo/tema.mp3'), 'archive-file');
    assert.equal(classifyUrl('https://foo.archive.org/details/ejemplo'), 'archive-file');
    const problem = validateImportRequest({ url: 'https://ia800100.us.archive.org/5/items/ejemplo/tema.mp3', license: 'CC BY 4.0' });
    assert.equal(problem.field, 'url');
    assert.match(problem.message, /archive\.org\/details/);
  });

  test('la ruta de un ítem no admite barras iniciales ni finales de más', () => {
    assert.equal(classifyUrl('https://archive.org//details/ejemplo-de-prueba'), 'archive-path');
    assert.equal(classifyUrl('https://archive.org/details/ejemplo-de-prueba//'), 'archive-path');
    assert.equal(classifyUrl('https://archive.org/details/ejemplo-de-prueba/'), 'archive');
  });

  test('el identificador de un ítem no puede contener «..», aunque sí un punto suelto', () => {
    assert.equal(classifyUrl('https://archive.org/details/ejemplo..prueba'), 'archive-path');
    assert.equal(classifyUrl('https://archive.org/details/ejemplo.prueba'), 'archive');
  });
});

describe('caracteres de formato (_has_control del backend también rechaza Cf)', () => {
  test('una dirección con un carácter de formato (ancho cero o bidi) no se acepta', () => {
    assert.match(validateUrl('https://ejemplo.org/audio/tema​.mp3'), /caracteres de control/);
    assert.match(validateUrl('https://ejemplo.org/audio/‮tema.mp3'), /caracteres de control/);
  });

  test('un texto con carácter de formato no pasa en título, licencia, etiquetas, carpeta ni en la incidencia', () => {
    assert.equal(validateImportRequest({ url: IA_ITEM, title: 'Tema‮' }).field, 'title');
    assert.equal(validateImportRequest({ url: DIRECT, license: 'CC BY​ 4.0' }).field, 'license');
    assert.match(validateOperation({ op: 'rename_folder', folder_id: '0123456789', name: 'Carpeta‮' }), /caracteres de control/);
    assert.match(validateOperation({ op: 'edit_song', song_id: 'S0123456789abcdef', tags: ['jazz​', 'vals'] }), /caracteres de control/);
    assert.match(validateOperation({ op: 'create_folder', name: '﻿Años' }), /caracteres de control/);
    assert.throws(() => buildIssueBody({ action: 'import', url: IA_ITEM, title: 'Tema​' }), /caracteres de control/);
  });
});

describe('aviso de la hoja', () => {
  test('dice que las procesan las cuentas con permiso de escritura, no el propietario', () => {
    assert.match(PROCESSING_NOTE, /permiso de escritura/);
    assert.doesNotMatch(PROCESSING_NOTE, /propietario/);
  });
});
