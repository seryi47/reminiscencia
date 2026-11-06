// Función de Vercel POST /api/subir (ADR-0017, revisada por ADR-0024 y ADR-0029): guarda por trozos, en el bucket
// PRIVADO de Cloudflare R2, el Ogg Opus que la web (js/cuidador/subida-publica.js) o la APK (lib/shared_upload.dart) ya
// han convertido, y al terminar lanza el workflow buzon de GitHub. Node, sin dependencias: solo fetch y node:crypto
// (firma AWS SigV4 propia, como backend/sonidos/r2.py).
//
// El contrato, la validación, el orden de los trozos, el manifiesto y el aviso a GitHub están en
// ../server/upload-core.js, compartido con el Worker de Cloudflare (worker/src/index.js, ADR-0029), que hace lo mismo
// con el binding de R2 y trozos de hasta 32 MB. Aquí solo queda lo propio de Vercel: la configuración por variables de
// entorno, la firma SigV4 y el cliente S3 del bucket privado. El trozo máximo en Vercel es de 4 MB (Vercel admite 4,5 MB
// por petición). Las APK antiguas siguen usando esta función.
//
// Protecciones: las de upload-core.js. Las claves de R2 y el token solo salen de process.env, solo van a sus servicios
// (firma de R2; cabecera Authorization de GitHub) y nunca van en los registros (solo el estado HTTP) ni en las
// respuestas.

import { createHash, createHmac } from 'node:crypto';

import {
  handleUploadRequest,
  UploadError,
  VERCEL_MAX_CHUNK_BYTES,
} from '../server/upload-core.js';

export {
  checkChunk,
  cleanStem,
  DISPATCH_EVENT,
  DONE_MESSAGE,
  ENTRY_PREFIX,
  isOggOpus,
  MANIFEST_NAME,
  manifestKey,
  manifestText,
  MAX_PARTS,
  MAX_STEM_BYTES,
  MAX_STEM_CHARS,
  parseUploadHeaders,
  partKey,
  REPOSITORY,
  UploadError,
} from '../server/upload-core.js';

export const MAX_CHUNK_BYTES = VERCEL_MAX_CHUNK_BYTES;
const ACCOUNT_ID = /^[0-9a-f]{32}$/;
const BUCKET_NAME = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;
const NOT_CONFIGURED = 'La subida no está configurada en el servidor (falta GITHUB_TOKEN o alguna variable de R2). Avisa a quien mantiene la web.';

// ---------------------------------------------------------------------------------------------
// Firma AWS Signature Version 4 (la misma que sign_v4 de backend/sonidos/r2.py; vectores comunes en
// tests/fixtures/sigv4-vectores.json)
// ---------------------------------------------------------------------------------------------

function sha256Hex(data) {
  return createHash('sha256').update(data).digest('hex');
}

function hmac(key, data) {
  return createHmac('sha256', key).update(data).digest();
}

/** Codificación de RFC 3986: como urllib.parse.quote de Python (encodeURIComponent deja sin codificar !'()*). */
export function rfc3986(text, { keepSlash = false } = {}) {
  const encoded = encodeURIComponent(text).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
  return keepSlash ? encoded.replace(/%2F/g, '/') : encoded;
}

/** Query canónica de SigV4: claves ordenadas y todo codificado según RFC 3986 (como canonical_query de Python). */
export function canonicalQuery(query) {
  return Object.keys(query)
    .sort()
    .map((name) => `${rfc3986(name)}=${rfc3986(String(query[name]))}`)
    .join('&');
}

function amzDate(when) {
  return when.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/**
 * Cabeceras de la firma (x-amz-date, x-amz-content-sha256 y Authorization). path y query ya van codificados.
 * extraHeaders: cabeceras que también se firman, en minúsculas.
 */
export function signV4({ method, host, path, query = '', payload = new Uint8Array(0), accessKeyId, secretAccessKey, region, service, when, extraHeaders = {} }) {
  const date = amzDate(when);
  const day = date.slice(0, 8);
  const payloadHash = sha256Hex(payload);
  const toSign = { host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': date, ...extraHeaders };
  const names = Object.keys(toSign).sort();
  const canonicalHeaders = names.map((name) => `${name}:${String(toSign[name]).trim()}\n`).join('');
  const signedHeaders = names.join(';');
  const canonicalRequest = [method, path, query, canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const scope = `${day}/${region}/${service}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', date, scope, sha256Hex(canonicalRequest)].join('\n');
  let key = Buffer.from(`AWS4${secretAccessKey}`, 'utf8');
  for (const part of [day, region, service, 'aws4_request']) key = hmac(key, part);
  const signature = createHmac('sha256', key).update(stringToSign).digest('hex');
  return {
    'x-amz-date': date,
    'x-amz-content-sha256': payloadHash,
    Authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}

// ---------------------------------------------------------------------------------------------
// R2 (API S3)
// ---------------------------------------------------------------------------------------------

/** Configuración desde el entorno, o null si falta algo. */
export function readConfig(env) {
  const value = (name) => (typeof env[name] === 'string' ? env[name].trim() : '');
  const config = {
    token: value('GITHUB_TOKEN'),
    accountId: value('R2_ACCOUNT_ID'),
    accessKeyId: value('R2_ACCESS_KEY_ID'),
    secretAccessKey: value('R2_SECRET_ACCESS_KEY'),
    bucket: value('R2_PRIVATE_BUCKET'),
  };
  if (Object.values(config).some((item) => !item)) return null;
  // El id de la cuenta forma parte del host y el bucket, de la ruta: solo sus formatos (nunca otro host).
  if (!ACCOUNT_ID.test(config.accountId) || !BUCKET_NAME.test(config.bucket)) return null;
  return config;
}

function storageError(status, what) {
  // Solo el estado: ni la respuesta de R2 ni las cabeceras firmadas van al registro.
  console.error(`subir: R2 respondió ${status} al ${what}`);
  if (status === 401 || status === 403) {
    return new UploadError(500, 'El servidor no tiene permiso para guardar la subida. Avisa a quien mantiene la web.');
  }
  return new UploadError(502, 'El almacenamiento no ha aceptado la subida. Inténtalo de nuevo en un momento.');
}

function decodeXml(text) {
  return text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}

function r2Client(config, fetchImpl, now) {
  const host = `${config.accountId}.r2.cloudflarestorage.com`;
  const request = async (method, key, { query = {}, body, headers = {}, what }) => {
    const path = `/${rfc3986(config.bucket)}${key ? `/${rfc3986(key, { keepSlash: true })}` : ''}`;
    const queryString = canonicalQuery(query);
    const payload = body ?? new Uint8Array(0);
    const lower = Object.fromEntries(Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value]));
    const signed = signV4({
      method, host, path, query: queryString, payload, accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey, region: 'auto', service: 's3', when: now(),
      extraHeaders: 'if-none-match' in lower ? { 'if-none-match': lower['if-none-match'] } : {},
    });
    try {
      return await fetchImpl(`https://${host}${path}${queryString ? `?${queryString}` : ''}`, {
        method,
        headers: { ...headers, ...signed },
        body: method === 'PUT' ? payload : undefined,
      });
    } catch {
      console.error(`subir: no se pudo conectar con R2 al ${what}`);
      throw new UploadError(502, 'No se ha podido conectar con el almacenamiento. Inténtalo de nuevo en un momento.');
    }
  };
  return {
    /** Nombres y tamaños de los objetos bajo entrada/<id>/ (sin el prefijo). */
    async list(prefix) {
      const found = new Map();
      let token = '';
      for (let page = 0; page < 20; page += 1) {
        const query = { 'list-type': '2', prefix, ...(token ? { 'continuation-token': token } : {}) };
        const response = await request('GET', '', { query, what: 'listar la subida' });
        if (response.status !== 200) throw storageError(response.status, 'listar la subida');
        const xml = await response.text();
        for (const [, item] of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
          const key = decodeXml(/<Key>([\s\S]*?)<\/Key>/.exec(item)?.[1] ?? '');
          const size = Number(/<Size>(\d+)<\/Size>/.exec(item)?.[1] ?? NaN);
          if (key.startsWith(prefix)) found.set(key.slice(prefix.length), size);
        }
        token = /<IsTruncated>true<\/IsTruncated>/.test(xml) ? decodeXml(/<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/.exec(xml)?.[1] ?? '') : '';
        if (!token) return found;
      }
      throw new UploadError(502, 'La subida tiene demasiados trozos guardados. Vuelve a elegir el archivo.');
    },
    async get(key) {
      const response = await request('GET', key, { what: 'leer un trozo' });
      if (response.status !== 200) throw storageError(response.status, 'leer un trozo');
      return new Uint8Array(await response.arrayBuffer());
    },
    /** Escribe sin sobrescribir nunca: true si lo escribió, false si ya existía (412). */
    async putNew(key, bytes, contentType) {
      const response = await request('PUT', key, {
        body: bytes, headers: { 'Content-Type': contentType, 'If-None-Match': '*' }, what: 'guardar un trozo',
      });
      if (response.status === 200) return true;
      if (response.status === 412) return false;
      throw storageError(response.status, 'guardar un trozo');
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Petición
// ---------------------------------------------------------------------------------------------

/** Atiende una petición. env, fetchImpl y now se inyectan en las pruebas (tests/web-unit/api-subir.test.mjs). */
export function handleUpload(request, { env = {}, fetchImpl = globalThis.fetch, now = () => new Date() } = {}) {
  return handleUploadRequest(request, {
    fetchImpl,
    maxChunkBytes: MAX_CHUNK_BYTES,
    config: () => {
      const config = readConfig(env);
      if (!config) {
        console.error('subir: faltan variables de entorno (GITHUB_TOKEN, R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY o R2_PRIVATE_BUCKET) o no tienen el formato esperado');
        throw new UploadError(500, NOT_CONFIGURED);
      }
      return { token: config.token, storage: r2Client(config, fetchImpl, now) };
    },
  });
}

/** Punto de entrada de Vercel (firma web: Request → Response). */
export function POST(request) {
  return handleUpload(request, { env: process.env, fetchImpl: globalThis.fetch });
}
