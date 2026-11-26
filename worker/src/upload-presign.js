// Subida directa a R2 con URLs firmadas SigV4 (ADR-0052). El Worker ya no transporta el audio: firma una URL, el
// cliente hace PUT directo al bucket privado y después notifica al Worker con metadatos. 100 % menos ancho de banda
// consumido por el Worker en subidas.
//
// Necesita tres secretos en el Worker (si faltan, los endpoints responden 503 y el cliente cae al flujo /api/subir):
//   R2_ACCOUNT_ID        — 32 hex, el id de la cuenta de Cloudflare (aparece en el dashboard de R2).
//   R2_ACCESS_KEY_ID     — del API Token de R2 (crearlo en el panel con «Object Read & Write» sobre los dos buckets).
//   R2_SECRET_ACCESS_KEY — el secret correspondiente.
//
// El endpoint S3 de R2 es `https://<account_id>.r2.cloudflarestorage.com`; la región firmada es `auto`.
// La firma es SigV4 estilo S3, con `X-Amz-Expires` para presign y `UNSIGNED-PAYLOAD`.

const PRESIGN_TTL_SECONDS = 15 * 60; // 15 minutos
const MULTIPART_CHUNK_BYTES = 50 * 1024 * 1024; // 50 MB
const SIMPLE_MAX_BYTES = 100 * 1024 * 1024; // 100 MB: por encima pedimos multipart
const MAX_TOTAL_BYTES = 2 * 1024 * 1024 * 1024; // 2 GB tope absoluto

function jsonResponse(status, body, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...extraHeaders },
  });
}

function configured(env) {
  return Boolean(env?.R2_ACCOUNT_ID && env?.R2_ACCESS_KEY_ID && env?.R2_SECRET_ACCESS_KEY);
}

function isAuthorized(request, env) {
  const got = request.headers.get('x-auth') ?? '';
  const want = env?.AUTH_PASSWORD ?? '';
  if (!want) return false;
  // Timing-safe compare (sin salida temprana por longitud)
  const a = new TextEncoder().encode(got);
  const b = new TextEncoder().encode(want);
  const n = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < n; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

function sanitizeFilename(name) {
  if (typeof name !== 'string') return '';
  // Solo lo que es seguro en una key de R2 y en una URL. Trimmed; sin barras.
  const cleaned = name.trim().replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 128);
  return cleaned || 'audio.opus';
}

function uuid() {
  // crypto.randomUUID está disponible en Workers modernos
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  // Fallback: hex aleatorio
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const h = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function toHex(buffer) {
  return Array.from(new Uint8Array(buffer), (b) => b.toString(16).padStart(2, '0')).join('');
}

async function sha256Hex(message) {
  const data = typeof message === 'string' ? new TextEncoder().encode(message) : message;
  const buf = await crypto.subtle.digest('SHA-256', data);
  return toHex(buf);
}

async function hmacRaw(key, data) {
  const cryptoKey = await crypto.subtle.importKey(
    'raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, data));
}

async function signingKey(secret, date, region, service) {
  const enc = new TextEncoder();
  const kDate = await hmacRaw(enc.encode('AWS4' + secret), enc.encode(date));
  const kRegion = await hmacRaw(kDate, enc.encode(region));
  const kService = await hmacRaw(kRegion, enc.encode(service));
  const kSigning = await hmacRaw(kService, enc.encode('aws4_request'));
  return kSigning;
}

function amzDate(date = new Date()) {
  // YYYYMMDDTHHMMSSZ
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getUTCFullYear()}${p(date.getUTCMonth() + 1)}${p(date.getUTCDate())}T${p(date.getUTCHours())}${p(date.getUTCMinutes())}${p(date.getUTCSeconds())}Z`;
}

/** Codifica una query param al estilo AWS SigV4: percent-encode RFC 3986, dejando sin tocar letras, dígitos,
 *  y los caracteres -_.~. */
function awsEncode(value) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
}

function buildPresignedUrl({ accountId, accessKeyId, secretAccessKey, bucket, key, method = 'PUT', expiresSeconds = PRESIGN_TTL_SECONDS, extraQuery = {}, now = new Date() }) {
  return (async () => {
    const host = `${accountId}.r2.cloudflarestorage.com`;
    const region = 'auto';
    const service = 's3';
    const amz = amzDate(now);
    const date = amz.slice(0, 8);
    const credentialScope = `${date}/${region}/${service}/aws4_request`;
    const canonicalUri = '/' + bucket + '/' + key.split('/').map(awsEncode).join('/');

    const query = {
      'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
      'X-Amz-Credential': `${accessKeyId}/${credentialScope}`,
      'X-Amz-Date': amz,
      'X-Amz-Expires': String(expiresSeconds),
      'X-Amz-SignedHeaders': 'host',
      ...extraQuery,
    };

    // canonical query string: ordena por clave, percent-encoded
    const canonicalQuery = Object.keys(query).sort().map((k) => `${awsEncode(k)}=${awsEncode(query[k])}`).join('&');
    const canonicalHeaders = `host:${host}\n`;
    const signedHeaders = 'host';
    const payloadHash = 'UNSIGNED-PAYLOAD';

    const canonicalRequest = [method, canonicalUri, canonicalQuery, canonicalHeaders, signedHeaders, payloadHash].join('\n');
    const stringToSign = ['AWS4-HMAC-SHA256', amz, credentialScope, await sha256Hex(canonicalRequest)].join('\n');

    const kSigning = await signingKey(secretAccessKey, date, region, service);
    const signatureBytes = await hmacRaw(kSigning, new TextEncoder().encode(stringToSign));
    const signature = toHex(signatureBytes);

    const url = `https://${host}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`;
    return url;
  })();
}

async function initiateMultipart({ accountId, accessKeyId, secretAccessKey, bucket, key, fetchImpl = fetch }) {
  // El `CreateMultipartUpload` requiere firma pero no es una URL presignada: lo llamamos nosotros desde el Worker.
  // Firmamos como request SigV4 "clásica" (header-signed), que es más directa para una llamada única.
  const host = `${accountId}.r2.cloudflarestorage.com`;
  const region = 'auto';
  const service = 's3';
  const now = new Date();
  const amz = amzDate(now);
  const date = amz.slice(0, 8);
  const credentialScope = `${date}/${region}/${service}/aws4_request`;
  const canonicalUri = '/' + bucket + '/' + key.split('/').map(awsEncode).join('/');
  const canonicalQuery = 'uploads=';
  const payloadHash = await sha256Hex('');
  const canonicalHeaders = `host:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amz}\n`;
  const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';
  const canonicalRequest = ['POST', canonicalUri, canonicalQuery, canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const stringToSign = ['AWS4-HMAC-SHA256', amz, credentialScope, await sha256Hex(canonicalRequest)].join('\n');
  const kSigning = await signingKey(secretAccessKey, date, region, service);
  const signatureBytes = await hmacRaw(kSigning, new TextEncoder().encode(stringToSign));
  const signature = toHex(signatureBytes);
  const authorization = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  const response = await fetchImpl(`https://${host}${canonicalUri}?uploads=`, {
    method: 'POST',
    headers: {
      host,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amz,
      authorization,
    },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`InitiateMultipartUpload HTTP ${response.status}: ${text.slice(0, 200)}`);
  // Parseo mínimo del XML para sacar el UploadId
  const match = /<UploadId>([^<]+)<\/UploadId>/.exec(text);
  if (!match) throw new Error('InitiateMultipartUpload sin UploadId en la respuesta.');
  return match[1];
}

async function completeMultipart({ accountId, accessKeyId, secretAccessKey, bucket, key, uploadId, parts, fetchImpl = fetch }) {
  const host = `${accountId}.r2.cloudflarestorage.com`;
  const region = 'auto';
  const service = 's3';
  const now = new Date();
  const amz = amzDate(now);
  const date = amz.slice(0, 8);
  const credentialScope = `${date}/${region}/${service}/aws4_request`;
  const canonicalUri = '/' + bucket + '/' + key.split('/').map(awsEncode).join('/');
  const canonicalQuery = `uploadId=${awsEncode(uploadId)}`;
  const body = '<?xml version="1.0" encoding="UTF-8"?><CompleteMultipartUpload xmlns="http://s3.amazonaws.com/doc/2006-03-01/">' +
    parts.map((p) => `<Part><ETag>${p.etag}</ETag><PartNumber>${p.partNumber}</PartNumber></Part>`).join('') +
    '</CompleteMultipartUpload>';
  const payloadHash = await sha256Hex(body);
  const canonicalHeaders = `host:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amz}\n`;
  const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';
  const canonicalRequest = ['POST', canonicalUri, canonicalQuery, canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const stringToSign = ['AWS4-HMAC-SHA256', amz, credentialScope, await sha256Hex(canonicalRequest)].join('\n');
  const kSigning = await signingKey(secretAccessKey, date, region, service);
  const signatureBytes = await hmacRaw(kSigning, new TextEncoder().encode(stringToSign));
  const signature = toHex(signatureBytes);
  const authorization = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  const response = await fetchImpl(`https://${host}${canonicalUri}?uploadId=${awsEncode(uploadId)}`, {
    method: 'POST',
    headers: {
      host,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amz,
      authorization,
      'Content-Type': 'application/xml',
    },
    body,
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`CompleteMultipartUpload HTTP ${response.status}: ${text.slice(0, 200)}`);
}

async function parseJson(request) {
  try { return await request.json(); } catch { return null; }
}

/** POST /api/upload/presign — devuelve URLs firmadas para subir un Opus directamente a R2. */
export async function handlePresign(request, env, fetchImpl = fetch) {
  if (request.method !== 'POST') return jsonResponse(405, { ok: false, error: 'Solo se admite POST.' });
  if (!isAuthorized(request, env)) return jsonResponse(401, { ok: false, error: 'Falta o no coincide X-Auth.' });
  if (!configured(env)) {
    return jsonResponse(503, {
      ok: false,
      error: 'Subida directa no configurada. Añade R2_ACCOUNT_ID, R2_ACCESS_KEY_ID y R2_SECRET_ACCESS_KEY como secretos del Worker.',
    });
  }
  const body = await parseJson(request);
  if (!body || typeof body !== 'object') return jsonResponse(400, { ok: false, error: 'Falta el cuerpo JSON.' });
  const filename = sanitizeFilename(body.filename);
  const sizeBytes = Number(body.sizeBytes);
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0 || sizeBytes > MAX_TOTAL_BYTES) {
    return jsonResponse(400, { ok: false, error: `sizeBytes fuera de rango (1..${MAX_TOTAL_BYTES}).` });
  }
  const bucket = 'reminiscencia-audio-privado';
  const uuidPart = uuid();
  // Guardamos como entrada/<uuid>/<filename> para que coincida con el patrón del flujo histórico.
  const key = `entrada/${uuidPart}/${filename}`;
  const expiresAt = Math.floor(Date.now() / 1000) + PRESIGN_TTL_SECONDS;
  const common = {
    accountId: env.R2_ACCOUNT_ID,
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    bucket, key,
  };

  if (sizeBytes <= SIMPLE_MAX_BYTES) {
    const uploadUrl = await buildPresignedUrl({ ...common, method: 'PUT', expiresSeconds: PRESIGN_TTL_SECONDS });
    return jsonResponse(200, {
      ok: true,
      mode: 'simple',
      uploadId: uuidPart,
      r2Key: key,
      uploadUrl,
      expiresAt,
    });
  }

  // Multipart: iniciamos el upload y firmamos una URL por chunk (uploadId real de S3).
  const s3UploadId = await initiateMultipart({ ...common, fetchImpl });
  const parts = [];
  const partCount = Math.ceil(sizeBytes / MULTIPART_CHUNK_BYTES);
  for (let i = 1; i <= partCount; i++) {
    const url = await buildPresignedUrl({
      ...common,
      method: 'PUT',
      expiresSeconds: PRESIGN_TTL_SECONDS,
      extraQuery: { partNumber: String(i), uploadId: s3UploadId },
    });
    parts.push({ partNumber: i, uploadUrl: url, sizeBytes: Math.min(MULTIPART_CHUNK_BYTES, sizeBytes - (i - 1) * MULTIPART_CHUNK_BYTES) });
  }
  return jsonResponse(200, {
    ok: true,
    mode: 'multipart',
    uploadId: uuidPart,
    s3UploadId,
    r2Key: key,
    chunkBytes: MULTIPART_CHUNK_BYTES,
    parts,
    expiresAt,
  });
}

/** POST /api/upload/complete — completa un multipart (si corresponde) y devuelve la r2Key final. */
export async function handleComplete(request, env, fetchImpl = fetch) {
  if (request.method !== 'POST') return jsonResponse(405, { ok: false, error: 'Solo se admite POST.' });
  if (!isAuthorized(request, env)) return jsonResponse(401, { ok: false, error: 'Falta o no coincide X-Auth.' });
  if (!configured(env)) {
    return jsonResponse(503, { ok: false, error: 'Subida directa no configurada.' });
  }
  const body = await parseJson(request);
  if (!body || typeof body !== 'object') return jsonResponse(400, { ok: false, error: 'Falta el cuerpo JSON.' });
  const r2Key = typeof body.r2Key === 'string' ? body.r2Key : '';
  if (!r2Key.startsWith('entrada/')) return jsonResponse(400, { ok: false, error: 'r2Key no válida.' });
  const parts = Array.isArray(body.parts) ? body.parts : [];
  const s3UploadId = typeof body.s3UploadId === 'string' ? body.s3UploadId : '';
  if (parts.length > 0 && s3UploadId) {
    await completeMultipart({
      accountId: env.R2_ACCOUNT_ID,
      accessKeyId: env.R2_ACCESS_KEY_ID,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY,
      bucket: 'reminiscencia-audio-privado',
      key: r2Key,
      uploadId: s3UploadId,
      parts,
      fetchImpl,
    });
  }
  return jsonResponse(200, { ok: true, r2Key });
}

// Exportados para tests
export const _testing = { buildPresignedUrl, sanitizeFilename, awsEncode, amzDate, sha256Hex, PRESIGN_TTL_SECONDS, SIMPLE_MAX_BYTES, MULTIPART_CHUNK_BYTES };
