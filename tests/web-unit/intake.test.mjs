// Pruebas del contrato de peticiones de la web (frontend/web/js/intake.js).
// Ejecución: node --test "tests/web-unit/*.test.mjs" (desde la raíz del repositorio).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  BLOCKED_HOSTS,
  buildImportBody,
  buildIssueTitle,
  buildIssueUrl,
  buildOrganizeBody,
  needsLicense,
  normalizeTags,
  selectableSongs,
  validateImport,
  validatePayload,
} from "../../frontend/web/js/intake.js";

const FOLDER = "0123456789";
const SONG = "S0123456789abcdef";

describe("validateImport: plataformas bloqueadas", () => {
  it("rechaza YouTube, Spotify y SoundCloud, con y sin www", () => {
    for (const url of [
      "https://www.youtube.com/watch?v=abc",
      "https://youtu.be/abc",
      "https://open.spotify.com/track/abc",
      "https://soundcloud.com/artista/tema",
    ]) {
      assert.notEqual(validateImport({ url }), null, url);
    }
  });

  it("rechaza también los subdominios de las plataformas bloqueadas", () => {
    for (const url of [
      "https://m.youtube.com/watch?v=abc",
      "https://music.apple.com/es/album/x/1",
      "https://www.instagram.com/p/abc/",
      "https://player.vimeo.com/video/1.mp3",
    ]) {
      assert.notEqual(validateImport({ url, license: "CC0" }), null, url);
    }
  });

  it("rechaza el dominio escrito con punto final (youtube.com. es youtube.com)", () => {
    assert.notEqual(validateImport({ url: "https://youtube.com./watch.mp3", license: "CC0" }), null);
  });

  it("no bloquea dominios que solo terminan igual que una plataforma", () => {
    assert.equal(validateImport({ url: "https://notyoutube.com/tema.mp3", license: "CC0" }), null);
  });
});

describe("validateImport: esquema y tipo de fuente", () => {
  it("acepta http y https con un ítem de Internet Archive", () => {
    assert.equal(validateImport({ url: "https://archive.org/details/Free_20s_Jazz_Collection" }), null);
    assert.equal(validateImport({ url: "http://archive.org/details/charleston1925" }), null);
  });

  it("rechaza otros esquemas", () => {
    assert.notEqual(validateImport({ url: "ftp://example.com/tema.mp3", license: "CC0" }), null);
    assert.notEqual(validateImport({ url: "javascript:alert(1)" }), null);
  });

  it("acepta archive.org/download/<id> y archive.org/download/<id>/<fichero>: los dos son el ítem <id>", () => {
    assert.equal(validateImport({ url: "https://archive.org/download/charleston1925" }), null);
    assert.equal(validateImport({ url: "https://archive.org/download/charleston1925/charleston.mp3" }), null);
    assert.equal(validateImport({ url: "https://archive.org/download/charleston1925/" }), null);
    assert.equal(validateImport({ url: "https://archive.org/download/charleston1925/Carta%20a%20Juan.flac?x=1" }), null);
  });

  it("un enlace de archive.org/download no pide licencia: el ítem y su licencia salen de sus metadatos", () => {
    assert.equal(needsLicense("https://archive.org/download/charleston1925/charleston.mp3"), false);
    assert.equal(
      buildImportBody({ url: "https://archive.org/download/charleston1925/charleston.mp3" }),
      "action: import\nurl: https://archive.org/download/charleston1925/charleston.mp3",
    );
  });

  it("exige exactamente un tipo y un identificador en la ruta de Internet Archive, como el backend", () => {
    assert.notEqual(validateImport({ url: "https://archive.org/details/abc/extra" }), null);
    assert.notEqual(validateImport({ url: "https://archive.org/details/a//b" }), null);
    assert.equal(validateImport({ url: "https://archive.org/details/abc/" }), null);
    assert.notEqual(validateImport({ url: "https://archive.org/details/abc//" }), null);
    assert.notEqual(validateImport({ url: "https://archive.org//details/abc" }), null);
  });

  it("rechaza archive.org sin identificador o con otra ruta", () => {
    assert.notEqual(validateImport({ url: "https://archive.org/details/" }), null);
    assert.notEqual(validateImport({ url: "https://archive.org/search?query=jazz" }), null);
    assert.notEqual(validateImport({ url: "https://archive.org/download" }), null);
    assert.notEqual(validateImport({ url: "https://archive.org/download/" }), null);
    assert.notEqual(validateImport({ url: "https://archive.org/download//charleston.mp3" }), null);
  });

  it("con download admite como mucho un fichero detrás del identificador; details no admite ninguno", () => {
    assert.notEqual(validateImport({ url: "https://archive.org/download/charleston1925/charleston.mp3/extra" }), null);
    assert.notEqual(validateImport({ url: "https://archive.org/download/charleston1925//charleston.mp3" }), null);
    assert.match(validateImport({ url: "https://archive.org/details/charleston1925/charleston.mp3" }), /archive\.org\/details/);
  });

  it("exige licencia en un fichero directo", () => {
    assert.match(validateImport({ url: "https://example.org/audio/tema.mp3" }), /licencia/);
  });

  it("rechaza una licencia en blanco en un fichero directo", () => {
    assert.match(validateImport({ url: "https://example.org/tema.opus", license: "   " }), /licencia/);
  });

  it("acepta un fichero directo con licencia, sin distinguir mayúsculas en la extensión", () => {
    assert.equal(validateImport({ url: "https://example.org/Tema.MP3", license: "CC BY 4.0" }), null);
  });

  it("rechaza páginas que no son ficheros de audio", () => {
    assert.notEqual(validateImport({ url: "https://example.org/tema", license: "CC0" }), null);
  });
});

describe("validateImport: límites y texto", () => {
  it("la dirección admite 2048 caracteres y no más", () => {
    const exact = `https://example.org/${"a".repeat(2048 - 20 - 4)}.mp3`;
    const over = `https://example.org/${"a".repeat(2049 - 20 - 4)}.mp3`;
    assert.equal(exact.length, 2048);
    assert.equal(validateImport({ url: exact, license: "CC0" }), null);
    assert.match(validateImport({ url: over, license: "CC0" }), /2048/);
  });

  it("rechaza espacios dentro de la dirección", () => {
    assert.notEqual(validateImport({ url: "https://archive.org/details/a b" }), null);
  });

  it("la licencia admite 300 caracteres y el título 200", () => {
    const direct = "https://example.org/tema.wav";
    assert.equal(validateImport({ url: direct, license: "L".repeat(300) }), null);
    assert.notEqual(validateImport({ url: direct, license: "L".repeat(301) }), null);
    assert.equal(validateImport({ url: "https://archive.org/details/x", title: "T".repeat(200) }), null);
    assert.notEqual(validateImport({ url: "https://archive.org/details/x", title: "T".repeat(201) }), null);
  });

  it("rechaza saltos de línea en el título, porque romperían el formato de la petición", () => {
    assert.notEqual(validateImport({ url: "https://archive.org/details/x", title: "uno\nurl: otra" }), null);
  });
});

describe("validateImport: paridad con backend/sonidos/sources.py", () => {
  it("valida el identificador de Internet Archive: 200 caracteres como máximo, sin símbolos ni inicio con punto o guion", () => {
    assert.equal(validateImport({ url: "https://archive.org/details/Free_20s.Jazz-1" }), null);
    assert.equal(validateImport({ url: `https://archive.org/details/${"a".repeat(200)}` }), null);
    assert.notEqual(validateImport({ url: `https://archive.org/details/${"a".repeat(201)}` }), null);
    for (const id of ["ab$c", ".oculto", "-abc", "ñandu", "a%20b"]) {
      assert.notEqual(validateImport({ url: `https://archive.org/details/${id}` }), null, id);
    }
  });

  it("el identificador de archive.org/download se valida igual, con o sin fichero", () => {
    assert.equal(validateImport({ url: `https://archive.org/download/${"a".repeat(200)}/charleston.mp3` }), null);
    assert.notEqual(validateImport({ url: `https://archive.org/download/${"a".repeat(201)}/charleston.mp3` }), null);
    assert.notEqual(validateImport({ url: `https://archive.org/download/${"a".repeat(201)}` }), null);
    for (const id of ["ab$c", ".oculto", "-abc", "ñandu", "a%20b"]) {
      assert.notEqual(validateImport({ url: `https://archive.org/download/${id}` }), null, id);
      assert.notEqual(validateImport({ url: `https://archive.org/download/${id}/charleston.mp3` }), null, id);
    }
  });

  it("acepta archive.org con punto final y rechaza etiquetas vacías o de 64 caracteres o más", () => {
    assert.equal(validateImport({ url: "https://archive.org./details/x" }), null);
    assert.notEqual(validateImport({ url: "https://archive.org../details/x" }), null);
    assert.notEqual(validateImport({ url: "https://a..b.org/tema.mp3", license: "CC0" }), null);
    assert.equal(validateImport({ url: `https://${"a".repeat(63)}.org/tema.mp3`, license: "CC0" }), null);
    assert.notEqual(validateImport({ url: `https://${"a".repeat(64)}.org/tema.mp3`, license: "CC0" }), null);
  });

  it("rechaza hosts que el backend no lee como tales: codificados, con barra invertida o sin host", () => {
    for (const url of [
      "https://%61rchive.org/details/x",
      "https://archive.org\\details/x",
      "https://example.org\\tema.mp3",
      "https:///a/tema.mp3",
    ]) {
      assert.notEqual(validateImport({ url, license: "CC0" }), null, url);
    }
  });

  it("rechaza caracteres C1, separadores Unicode y surrogates sueltos en la dirección", () => {
    for (const code of [0x80, 0x85, 0x9f, 0x2028, 0x2029, 0xd800]) {
      const url = `https://example.org/te${String.fromCharCode(code)}ma.mp3`;
      assert.notEqual(validateImport({ url, license: "CC0" }), null, code.toString(16));
    }
  });

  it("rechaza espacios Unicode dentro de la dirección, como Python", () => {
    assert.notEqual(validateImport({ url: "https://example.org/te ma.mp3", license: "CC0" }), null);
  });
});

describe("buildImportBody", () => {
  it("genera solo las líneas de importación, sin payload y sin licencia vacía", () => {
    const body = buildImportBody({ url: "https://archive.org/details/x", license: "", title: " Charleston " });
    assert.equal(body, "action: import\nurl: https://archive.org/details/x\ntitle: Charleston");
  });

  it("incluye la licencia en un fichero directo y nunca añade payload", () => {
    const body = buildImportBody({ url: "https://example.org/a.flac", license: "CC0 1.0" });
    assert.equal(body, "action: import\nurl: https://example.org/a.flac\nlicense: CC0 1.0");
    assert.equal(body.includes("payload:"), false);
  });

  it("lanza error si la petición no es válida", () => {
    assert.throws(() => buildImportBody({ url: "https://youtu.be/abc" }), /no se puede importar/);
  });
});

describe("needsLicense", () => {
  it("solo pide licencia para un fichero directo que no esté bloqueado", () => {
    assert.equal(needsLicense("https://example.org/tema.m4a"), true);
    assert.equal(needsLicense("https://archive.org/details/x"), false);
    assert.equal(needsLicense("https://youtube.com/x.mp3"), false);
    assert.equal(needsLicense("no es una url"), false);
  });
});

describe("validatePayload: operaciones e identificadores", () => {
  it("rechaza una operación desconocida", () => {
    assert.match(validatePayload({ op: "publish_everything" }), /desconocida/);
  });

  it("rechaza campos que la operación no admite", () => {
    assert.match(validatePayload({ op: "edit_song", song_id: SONG, owner: "x" }), /no está permitido/);
    assert.match(validatePayload({ op: "delete_folder", folder_id: FOLDER, name: "x" }), /no está permitido/);
  });

  it("valida los identificadores de carpeta y de canción", () => {
    assert.equal(validatePayload({ op: "delete_folder", folder_id: FOLDER }), null);
    assert.notEqual(validatePayload({ op: "delete_folder", folder_id: "ABCDEF0123" }), null);
    assert.notEqual(validatePayload({ op: "delete_folder", folder_id: "012345678" }), null);
    assert.notEqual(validatePayload({ op: "edit_song", song_id: "S123" }), null);
    assert.notEqual(validatePayload({ op: "edit_song", song_id: "0123456789abcdef" }), null);
    assert.equal(validatePayload({ op: "edit_song", song_id: SONG, folder_id: null }), null);
  });

  it("acepta los dos formatos de álbum del backend: F + 16 hexadecimales (nuevo) y 10 hexadecimales (antiguo)", () => {
    assert.equal(validatePayload({ op: "delete_folder", folder_id: "F0123456789abcdef" }), null);
    assert.equal(validatePayload({ op: "edit_song", song_id: SONG, folder_id: "F0123456789abcdef" }), null);
    for (const bad of ["f0123456789abcdef", "F0123456789ABCDEF", "F0123456789abcde", "G0123456789abcdef"]) {
      assert.notEqual(validatePayload({ op: "delete_folder", folder_id: bad }), null, bad);
    }
  });

  it("exige el año entre 1000 y 2100, como entero o null", () => {
    assert.equal(validatePayload({ op: "edit_song", song_id: SONG, year: 1925 }), null);
    assert.equal(validatePayload({ op: "edit_song", song_id: SONG, year: null }), null);
    assert.notEqual(validatePayload({ op: "edit_song", song_id: SONG, year: 999 }), null);
    assert.notEqual(validatePayload({ op: "edit_song", song_id: SONG, year: 2101 }), null);
    assert.notEqual(validatePayload({ op: "edit_song", song_id: SONG, year: "1925" }), null);
    assert.notEqual(validatePayload({ op: "edit_song", song_id: SONG, year: 1925.5 }), null);
    assert.notEqual(validatePayload({ op: "edit_song", song_id: SONG, year: Number.NaN }), null);
  });

  it("exige booleanos reales en public, nunca cadenas", () => {
    assert.equal(validatePayload({ op: "edit_song", song_id: SONG, public: true }), null);
    assert.equal(validatePayload({ op: "edit_song", song_id: SONG, public: false }), null);
    assert.notEqual(validatePayload({ op: "edit_song", song_id: SONG, public: "true" }), null);
    assert.notEqual(validatePayload({ op: "edit_song", song_id: SONG, public: 1 }), null);
  });

  it("admite como máximo 20 etiquetas de 40 caracteres, en una lista", () => {
    const twenty = Array.from({ length: 20 }, (_, index) => `t${index}`);
    assert.equal(validatePayload({ op: "edit_song", song_id: SONG, tags: twenty }), null);
    assert.notEqual(validatePayload({ op: "edit_song", song_id: SONG, tags: [...twenty, "extra"] }), null);
    assert.equal(validatePayload({ op: "edit_song", song_id: SONG, tags: ["a".repeat(40)] }), null);
    assert.notEqual(validatePayload({ op: "edit_song", song_id: SONG, tags: ["a".repeat(41)] }), null);
    assert.notEqual(validatePayload({ op: "edit_song", song_id: SONG, tags: "jazz" }), null);
  });

  it("normaliza las etiquetas: minúsculas, sin vacías ni repetidas", () => {
    assert.deepEqual(normalizeTags("Jazz, años 20, jazz,  , FAVORITAS"), ["jazz", "años 20", "favoritas"]);
    assert.deepEqual(normalizeTags(["Rock", "rock"]), ["rock"]);
    assert.deepEqual(normalizeTags(""), []);
  });

  it("valida el nombre de la carpeta: de 1 a 80 caracteres y no en blanco", () => {
    assert.equal(validatePayload({ op: "create_folder", name: "Años 20", parent_id: null }), null);
    assert.notEqual(validatePayload({ op: "create_folder", name: "   ", parent_id: null }), null);
    assert.equal(validatePayload({ op: "create_folder", name: "n".repeat(80), parent_id: null }), null);
    assert.notEqual(validatePayload({ op: "create_folder", name: "n".repeat(81), parent_id: null }), null);
  });

  it("exige parent_id en create_folder: null o un identificador de carpeta", () => {
    assert.notEqual(validatePayload({ op: "create_folder", name: "x" }), null);
    assert.equal(validatePayload({ op: "create_folder", name: "x", parent_id: FOLDER }), null);
    assert.notEqual(validatePayload({ op: "create_folder", name: "x", parent_id: "nope" }), null);
  });

  it("exige la carpeta en rename_folder y en delete_folder", () => {
    assert.match(validatePayload({ op: "rename_folder", name: "x" }), /Falta la carpeta/);
    assert.match(validatePayload({ op: "delete_folder" }), /Falta la carpeta/);
    assert.equal(validatePayload({ op: "rename_folder", folder_id: FOLDER, name: "nuevo" }), null);
  });

  it("exige al menos un campo que cambiar en edit_song, como el backend", () => {
    assert.match(validatePayload({ op: "edit_song", song_id: SONG }), /al menos un campo/);
    assert.match(validatePayload({ op: "edit_song", song_id: SONG, title: undefined }), /al menos un campo/);
    assert.equal(validatePayload({ op: "edit_song", song_id: SONG, artist: "" }), null);
  });

  it("acepta el payload como texto JSON, pero no en varias líneas", () => {
    assert.equal(validatePayload(`{"op":"delete_folder","folder_id":"${FOLDER}"}`), null);
    assert.notEqual(validatePayload(`{\n"op":"delete_folder","folder_id":"${FOLDER}"}`), null);
  });

  it("el payload no puede pasar de 4000 caracteres", () => {
    assert.match(validatePayload("x".repeat(4001)), /4000/);
  });
});

describe("buildOrganizeBody", () => {
  it("produce dos líneas: action y un payload JSON en una sola línea", () => {
    const title = 'Café "Ñandú" \\ 🎵';
    const body = buildOrganizeBody({ op: "edit_song", song_id: SONG, title, tags: ["jazz"] });
    const lines = body.split("\n");
    assert.equal(lines.length, 2);
    assert.equal(lines[0], "action: organize");
    assert.ok(lines[1].startsWith("payload: "));
    assert.equal(/[\r\v\f]/.test(body), false);
    const payload = JSON.parse(lines[1].slice("payload: ".length));
    assert.deepEqual(payload, { op: "edit_song", song_id: SONG, title, tags: ["jazz"] });
  });

  it("rechaza saltos de línea y separadores Unicode dentro de los textos", () => {
    const lineSeparator = String.fromCharCode(0x2028);
    const nextLine = String.fromCharCode(0x85);
    assert.throws(() => buildOrganizeBody({ op: "edit_song", song_id: SONG, title: `Carta${lineSeparator}a` }), /saltos de línea/);
    assert.throws(() => buildOrganizeBody({ op: "edit_song", song_id: SONG, title: `Carta${nextLine}a` }), /saltos de línea/);
    assert.throws(() => buildOrganizeBody({ op: "create_folder", name: "uno\ndos", parent_id: null }), /saltos de línea/);
  });

  it("no genera texto para una operación inválida", () => {
    assert.throws(() => buildOrganizeBody({ op: "delete_folder", folder_id: "bad" }), /identificador/);
  });
});

describe("buildIssueUrl y buildIssueTitle", () => {
  it("apunta a una incidencia nueva con la etiqueta biblioteca y codifica título y cuerpo", () => {
    const body = "action: import\nurl: https://archive.org/details/Café & más\ntitle: Canción ñ";
    const title = "Añadir audio: Canción ñ & más";
    const href = buildIssueUrl(body, title);
    assert.ok(href.startsWith("https://github.com/seryi47/reminiscencia/issues/new?labels=biblioteca&title="));
    const parsed = new URL(href);
    assert.equal(parsed.searchParams.get("labels"), "biblioteca");
    assert.equal(parsed.searchParams.get("title"), title);
    assert.equal(parsed.searchParams.get("body"), body);
    assert.equal(href.includes("& más"), false);
  });

  it("acepta otro repositorio y rechaza nombres mal formados", () => {
    assert.match(buildIssueUrl("x", "t", "otra/repo"), /^https:\/\/github\.com\/otra\/repo\/issues\/new\?/);
    assert.throws(() => buildIssueUrl("x", "t", "no-es-un-repo"), /propietario\/nombre/);
  });

  it("el título tiene como mucho 120 caracteres y una sola línea", () => {
    const title = buildIssueTitle(`${"Línea larga ".repeat(20)}\n fin`);
    assert.ok([...title].length <= 120);
    assert.equal(/[\n\r]/.test(title), false);
    assert.equal(buildIssueTitle("   "), "Petición de la biblioteca");
  });
});

describe("buildIssueUrl: nombres de repositorio", () => {
  it("rechaza . y .. como propietario o como nombre, porque suben de nivel en la ruta", () => {
    assert.throws(() => buildIssueUrl("x", "t", "../.."), /propietario\/nombre/);
    assert.throws(() => buildIssueUrl("x", "t", "./repo"), /propietario\/nombre/);
    assert.throws(() => buildIssueUrl("x", "t", "seryi47/.."), /propietario\/nombre/);
    assert.throws(() => buildIssueUrl("x", "t", "seryi47/."), /propietario\/nombre/);
  });

  it("acepta puntos dentro del nombre del repositorio", () => {
    assert.match(buildIssueUrl("x", "t", "seryi47/repo.v2"), /^https:\/\/github\.com\/seryi47\/repo\.v2\/issues\/new\?/);
  });
});

describe("validatePayload: etiquetas medidas como el backend (issue_request.py, _tags)", () => {
  it("mide la etiqueta después de minusculizar: 21 veces İ son 42 caracteres", () => {
    assert.notEqual(validatePayload({ op: "edit_song", song_id: SONG, tags: ["İ".repeat(21)] }), null);
    assert.equal(validatePayload({ op: "edit_song", song_id: SONG, tags: ["İ".repeat(20)] }), null);
  });

  it("no cuenta los espacios de los extremos, como el strip del backend", () => {
    assert.equal(validatePayload({ op: "edit_song", song_id: SONG, tags: [` ${"a".repeat(40)} `] }), null);
  });

  it("no quita U+FEFF al medir: str.strip() de Python no lo quita", () => {
    assert.notEqual(validatePayload({ op: "edit_song", song_id: SONG, tags: [`\ufeff${"a".repeat(40)}`] }), null);
  });
});

describe("validateImport: plataformas de vídeo, streaming y sus dominios de ficheros (sources.py)", () => {
  it("rechaza las plataformas añadidas a la lista de bloqueo del backend", () => {
    for (const url of [
      "https://www.dailymotion.com/x.mp3",
      "https://www.twitch.tv/x.mp3",
      "https://www.deezer.com/x.mp3",
      "https://tidal.com/x.mp3",
      "https://www.mixcloud.com/x.mp3",
    ]) {
      assert.match(validateImport({ url, license: "CC0" }), /no se puede importar/, url);
    }
  });

  it("rechaza los dominios de ficheros de esas plataformas, también como subdominios", () => {
    for (const url of [
      "https://r1---sn.googlevideo.com/x.mp3",
      "https://i.ytimg.com/x.mp3",
      "https://cdn.sndcdn.com/x.mp3",
      "https://dzcdn.net/x.mp3",
    ]) {
      assert.match(validateImport({ url, license: "CC0" }), /no se puede importar/, url);
    }
  });
});

describe("validateImport: ';' en la ruta como urlparse del backend", () => {
  it("un ';' en el último segmento corta la ruta: a.txt;x.mp3 no es un fichero de audio", () => {
    assert.notEqual(validateImport({ url: "https://example.org/a.txt;x.mp3", license: "CC0" }), null);
    assert.notEqual(validateImport({ url: "https://example.org/tema;.mp3", license: "CC0" }), null);
    assert.notEqual(validateImport({ url: "https://example.org/x;.mp3", license: "CC0" }), null);
  });

  it("la extensión se lee antes del ';' del último segmento, y un ';' en un segmento anterior no cuenta", () => {
    assert.equal(validateImport({ url: "https://example.org/tema.mp3;x", license: "CC0" }), null);
    assert.equal(validateImport({ url: "https://example.org/a;b/tema.mp3", license: "CC0" }), null);
  });

  it("en Internet Archive el ';' es un error en el identificador: ia_identifier lee la ruta entera", () => {
    assert.match(validateImport({ url: "https://archive.org/details/x;y" }), /archive\.org\/details/);
    assert.match(validateImport({ url: "https://archive.org/download/x;y" }), /archive\.org\/details/);
  });
});

describe("validateImport: servidores de ficheros de Internet Archive", () => {
  it("un fichero de ia800100.us.archive.org no se importa como directo: su licencia está en el ítem", () => {
    assert.match(validateImport({ url: "https://ia800100.us.archive.org/1/items/x/tema.mp3", license: "CC0" }), /desde su ítem/);
    assert.match(validateImport({ url: "https://ia800100.us.archive.org/1/items/x/tema.mp3" }), /desde su ítem/);
  });
});

describe("selectableSongs: lo que la sección muestra y cuenta", () => {
  it("solo quedan las canciones publicadas con un identificador válido", () => {
    const songs = [
      { id: SONG, public: true },
      { id: "BAD", public: true },
      { id: "S0123456789abcde", public: true },
      { id: "S1123456789abcdef", public: false },
      null,
    ];
    assert.deepEqual(selectableSongs(songs).map((song) => song.id), [SONG]);
  });
});

describe("validateImport: direcciones que no son públicas, como check_download_url del backend", () => {
  it("rechaza las IPv4 de red privada, de bucle local, de enlace local, de metadatos y de CGNAT, aunque haya licencia", () => {
    for (const host of [
      "127.0.0.1", "127.255.255.255", "10.0.0.5", "172.16.0.1", "172.31.255.255", "192.168.1.1",
      "169.254.169.254", "100.64.0.1", "100.127.255.255", "0.0.0.0", "198.18.0.1", "192.0.0.8",
      "192.0.0.170", "192.0.2.10", "198.51.100.7", "203.0.113.9", "240.0.0.1", "255.255.255.255",
    ]) {
      assert.match(validateImport({ url: `https://${host}/audio/cancion.mp3`, license: "CC BY 4.0" }), /red privada/, host);
    }
  });

  it("admite una IPv4 pública como fichero directo con licencia, también justo fuera de los rangos privados", () => {
    for (const host of ["8.8.8.8", "1.1.1.1", "172.15.255.255", "172.32.0.1", "100.63.255.255", "100.128.0.1", "192.0.0.9", "192.0.0.10", "198.20.0.1"]) {
      assert.equal(validateImport({ url: `https://${host}/audio/cancion.mp3`, license: "CC0" }), null, host);
    }
  });

  it("rechaza localhost y sus subdominios, con puerto o con punto final", () => {
    for (const host of ["localhost", "LOCALHOST", "localhost.", "localhost:8080", "foo.localhost"]) {
      assert.match(validateImport({ url: `https://${host}/audio/cancion.mp3`, license: "CC0" }), /red privada/, host);
    }
  });

  it("rechaza las formas numéricas de una IP que el backend resuelve a un host no público", () => {
    for (const host of ["127.1", "2130706433", "0x7f000001", "0x7f.0.0.1", "0177.0.0.1", "010.0.0.1", "8.8.8", "7"]) {
      assert.match(validateImport({ url: `https://${host}/audio/cancion.mp3`, license: "CC0" }), /no es válida/, host);
    }
  });

  it("rechaza un nombre de una sola etiqueta, que no es una dirección pública", () => {
    for (const host of ["intranet", "router"]) {
      assert.match(validateImport({ url: `https://${host}/audio/cancion.mp3`, license: "CC0" }), /no es válida/, host);
    }
  });

  it("no pide licencia para un host que no es público, porque no se va a importar", () => {
    assert.equal(needsLicense("https://127.0.0.1/tema.mp3"), false);
    assert.equal(needsLicense("https://8.8.8.8/tema.mp3"), true);
  });
});

describe("paridad de la lista de bloqueo con backend/sonidos/sources.py", () => {
  const backendSource = readFileSync(new URL("../../backend/sonidos/sources.py", import.meta.url), "utf8");
  const block = backendSource.match(/BLOCKED_HOSTS = frozenset\(\s*\{([\s\S]*?)\}\s*\)/);
  const backendBlocked = block ? [...block[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]) : [];

  it("encuentra la lista de bloqueo del backend", () => {
    assert.ok(backendBlocked.length >= 10, `solo se leyeron ${backendBlocked.length} entradas`);
  });

  it("la web bloquea todo lo que bloquea el backend, y también los subdominios", () => {
    for (const host of backendBlocked) {
      assert.match(validateImport({ url: `https://${host}/tema.mp3`, license: "CC0" }), /no se puede importar/, host);
      assert.match(validateImport({ url: `https://sub.${host}/tema.mp3`, license: "CC0" }), /no se puede importar/, host);
    }
  });

  it("la lista de la web es idéntica a la del backend", () => {
    assert.deepEqual([...BLOCKED_HOSTS].sort(), [...backendBlocked].sort());
  });
});

describe("validateImport: el fichero de archive.org/download como _is_plain_file_name de sources.py", () => {
  const withFile = (file) => validateImport({ url: `https://archive.org/download/charleston1925/${file}` });

  it("acepta un nombre de texto sin barras, sin control ni formato, también con escapes %XX válidos o inválidos", () => {
    for (const file of ["charleston.mp3", "Canción%20ñ.flac", "%C3%A1.mp3", "tema%.mp3", "tema.mp3;v=1", "%20", "a.b.c"]) {
      assert.equal(withFile(file), null, file);
    }
  });

  it("rechaza un fichero que, decodificado, es '.' o '..', o tiene barras o barras invertidas", () => {
    for (const file of [".", "..", "%2e", "%2E%2E", ".%2E", "a%2Fb.mp3", "tema%2fmp3", "tema%5Cmp3", "tema\\mp3"]) {
      assert.notEqual(withFile(file), null, file);
    }
  });

  it("rechaza un fichero con caracteres de control o de formato, también codificados", () => {
    for (const file of ["tema%00.mp3", "%0A", "%C2%85", "%E2%80%A8", "%EF%BB%BFtema.mp3", "tema%E2%80%8B.mp3"]) {
      assert.notEqual(withFile(file), null, file);
    }
  });

  it("una barra final se tolera, pero una segunda barra deja un fichero vacío y no vale", () => {
    assert.equal(validateImport({ url: "https://archive.org/download/charleston1925/" }), null);
    assert.notEqual(validateImport({ url: "https://archive.org/download/charleston1925//" }), null);
  });
});

describe("paridad de las formas de Internet Archive con backend/sonidos/sources.py", () => {
  const backendSource = readFileSync(new URL("../../backend/sonidos/sources.py", import.meta.url), "utf8");
  const start = backendSource.indexOf("def ia_identifier(");
  const end = backendSource.indexOf("def _is_plain_identifier(");
  // Tipos de ruta: las palabras entre comillas dobles de ia_identifier, sin los esquemas http y https.
  const backendKinds = start === -1 || end === -1
    ? []
    : [...new Set([...backendSource.slice(start, end).matchAll(/"([a-z]+)"/g)].map((match) => match[1]))]
      .filter((word) => word !== "http" && word !== "https");
  const identifier = backendSource.match(/IA_IDENTIFIER = re\.compile\(r"([^"]+)"\)/);
  const webSource = readFileSync(new URL("../../frontend/web/js/intake.js", import.meta.url), "utf8");

  it("encuentra los tipos de ruta de ia_identifier y el patrón del identificador en sources.py", () => {
    assert.deepEqual([...backendKinds].sort(), ["details", "download"]);
    assert.ok(identifier, "no se encuentra IA_IDENTIFIER en sources.py");
  });

  it("la web acepta archive.org/<tipo>/<identificador> solo con los tipos que admite el backend", () => {
    for (const kind of ["details", "download", "search", "metadata", "embed", "stream"]) {
      const accepted = validateImport({ url: `https://archive.org/${kind}/charleston1925` }) === null;
      assert.equal(accepted, backendKinds.includes(kind), kind);
    }
  });

  it("el patrón del identificador es el mismo que IA_IDENTIFIER de sources.py", () => {
    assert.ok(identifier && webSource.includes(identifier[1]), "intake.js no tiene el patrón de IA_IDENTIFIER");
  });

  it("ni el backend ni la web aceptan '..' dentro del identificador", () => {
    assert.ok(backendSource.includes('".." not in identifier'), "sources.py ya no rechaza '..' en el identificador");
    assert.notEqual(validateImport({ url: "https://archive.org/details/a..b" }), null);
    assert.notEqual(validateImport({ url: "https://archive.org/download/a..b/charleston.mp3" }), null);
  });
});

describe("validatePayload: una etiqueta con muchos espacios interiores se mide en tiempo lineal", () => {
  it("responde deprisa aunque la etiqueta tenga 100.000 espacios seguidos", () => {
    const tag = `a${" ".repeat(100000)}b`;
    const started = performance.now();
    const problem = validatePayload({ op: "edit_song", song_id: SONG, tags: [tag] });
    const elapsed = performance.now() - started;
    assert.match(problem, /40 caracteres/);
    assert.ok(elapsed < 1000, `tardó ${Math.round(elapsed)} ms`);
  });
});

describe("validatePayload: texto JSON sin caracteres de control, como en la línea payload del backend", () => {
  it("rechaza un tabulador entre tokens del texto JSON", () => {
    assert.notEqual(validatePayload(`{"op":"delete_folder",\t"folder_id":"${FOLDER}"}`), null);
  });

  it("rechaza un carácter de control escrito como escape JSON, como el backend al leer el título", () => {
    assert.match(validatePayload(`{"op":"edit_song","song_id":"${SONG}","title":"a\\u0007b"}`), /caracteres de control/);
  });
});
