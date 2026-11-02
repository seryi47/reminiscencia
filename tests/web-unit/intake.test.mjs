// Pruebas del contrato de peticiones de la web (frontend/web/js/intake.js).
// Ejecución: node --test "tests/web-unit/*.test.mjs" (desde la raíz del repositorio).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildImportBody,
  buildIssueTitle,
  buildIssueUrl,
  buildOrganizeBody,
  needsLicense,
  normalizeTags,
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

  it("solo admite el ítem de Internet Archive, no un fichero dentro de archive.org/download", () => {
    assert.equal(validateImport({ url: "https://archive.org/download/charleston1925" }), null);
    assert.match(validateImport({ url: "https://archive.org/download/charleston1925/charleston.mp3" }), /archive\.org\/details/);
  });

  it("exige exactamente un tipo y un identificador en la ruta de Internet Archive, como el backend", () => {
    assert.notEqual(validateImport({ url: "https://archive.org/details/abc/extra" }), null);
    assert.notEqual(validateImport({ url: "https://archive.org/details/a//b" }), null);
    assert.equal(validateImport({ url: "https://archive.org/details/abc/" }), null);
    assert.equal(validateImport({ url: "https://archive.org//details/abc" }), null);
  });

  it("rechaza archive.org sin identificador o con otra ruta", () => {
    assert.notEqual(validateImport({ url: "https://archive.org/details/" }), null);
    assert.notEqual(validateImport({ url: "https://archive.org/search?query=jazz" }), null);
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
