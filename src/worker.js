import { GereRoom } from './room-do.js';
import { GereReviews } from './reviews-do.js';

export { GereRoom, GereReviews };

const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ROOM_CODE_LEN = 6;
const ROOM_CODE_RE = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/;

const ipBuckets = new Map();

const SECURITY_HEADERS = {
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
};

function checkIpRateLimit(ip, key, limit, windowMs) {
  const now = Date.now();
  const bucketKey = `${key}:${ip}`;
  let entry = ipBuckets.get(bucketKey);
  if (!entry || now - entry.start > windowMs) {
    entry = { start: now, count: 0 };
  }
  entry.count += 1;
  ipBuckets.set(bucketKey, entry);

  if (ipBuckets.size > 2000) {
    for (const [k, v] of ipBuckets) {
      if (now - v.start > windowMs) ipBuckets.delete(k);
    }
  }
  return entry.count <= limit;
}

function generateRoomCode() {
  const bytes = new Uint8Array(ROOM_CODE_LEN);
  crypto.getRandomValues(bytes);
  let code = '';
  for (let i = 0; i < ROOM_CODE_LEN; i++) {
    code += ROOM_ALPHABET[bytes[i] % ROOM_ALPHABET.length];
  }
  return code;
}

function isLoopbackHost(hostname) {
  return hostname === 'localhost' || hostname === '127.0.0.1';
}

function isOriginAllowed(request, env) {
  const origin = request.headers.get('Origin');
  if (!origin) return false;
  let originUrl;
  let reqUrl;
  try {
    originUrl = new URL(origin);
    reqUrl = new URL(request.url);
  } catch {
    return false;
  }
  if (originUrl.origin === reqUrl.origin) return true;

  // Allow localhost <-> 127.0.0.1 loopback parity during local development
  if (
    isLoopbackHost(originUrl.hostname) &&
    isLoopbackHost(reqUrl.hostname) &&
    originUrl.port === reqUrl.port
  ) {
    return true;
  }

  if (env.DEV_ALLOW_LOCALHOST === 'true' && isLoopbackHost(originUrl.hostname)) {
    return true;
  }
  return false;
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...SECURITY_HEADERS,
    },
  });
}

function withSecurityHeaders(doResp) {
  const headers = new Headers(doResp.headers);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) headers.set(k, v);
  headers.set('Cache-Control', 'no-store');
  return new Response(doResp.body, { status: doResp.status, headers });
}

async function readBoundedJson(request, maxBytes = 1024) {
  const contentLength = Number(request.headers.get('Content-Length') || '0');
  if (contentLength > maxBytes) {
    throw new Error('PAYLOAD_TOO_LARGE');
  }
  const buf = await request.arrayBuffer();
  if (buf.byteLength > maxBytes) {
    throw new Error('PAYLOAD_TOO_LARGE');
  }
  const text = new TextDecoder('utf-8', { fatal: true }).decode(buf);
  return text ? JSON.parse(text) : {};
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const { pathname } = url;

    const isApi = pathname.startsWith('/api/');
    const isWs = pathname.startsWith('/ws/');

    if (!isApi && !isWs) {
      return env.ASSETS.fetch(request);
    }

    if (!isOriginAllowed(request, env)) {
      return jsonResponse({ error: 'FORBIDDEN_ORIGIN' }, 403);
    }

    const clientIp =
      request.headers.get('CF-Connecting-IP') ||
      request.headers.get('X-Forwarded-For') ||
      'local';

    // --- ROOM CREATION ---
    if (pathname === '/api/rooms') {
      if (request.method !== 'POST') {
        return jsonResponse({ error: 'METHOD_NOT_ALLOWED' }, 405);
      }
      if (!checkIpRateLimit(clientIp, 'room_create', 12, 60_000)) {
        return jsonResponse({ error: 'RATE_LIMITED' }, 429);
      }
      let body;
      try {
        body = await readBoundedJson(request, 1024);
      } catch (err) {
        return jsonResponse(
          { error: err.message === 'PAYLOAD_TOO_LARGE' ? 'PAYLOAD_TOO_LARGE' : 'INVALID_JSON' },
          err.message === 'PAYLOAD_TOO_LARGE' ? 413 : 400
        );
      }
      const code = generateRoomCode();
      const id = env.GERE_ROOM.idFromName(code);
      const stub = env.GERE_ROOM.get(id);
      const doResp = await stub.fetch(
        new Request('https://room.internal/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...body, roomCode: code }),
        })
      );
      return withSecurityHeaders(doResp);
    }

    // --- ROOM JOIN ---
    const joinMatch = pathname.match(/^\/api\/rooms\/([A-Z0-9]{6})\/join$/);
    if (joinMatch) {
      if (request.method !== 'POST') {
        return jsonResponse({ error: 'METHOD_NOT_ALLOWED' }, 405);
      }
      if (!checkIpRateLimit(clientIp, 'room_join', 20, 60_000)) {
        return jsonResponse({ error: 'RATE_LIMITED' }, 429);
      }
      const code = joinMatch[1];
      if (!ROOM_CODE_RE.test(code)) {
        return jsonResponse({ error: 'INVALID_ROOM_CODE' }, 400);
      }
      let body;
      try {
        body = await readBoundedJson(request, 1024);
      } catch (err) {
        return jsonResponse(
          { error: err.message === 'PAYLOAD_TOO_LARGE' ? 'PAYLOAD_TOO_LARGE' : 'INVALID_JSON' },
          err.message === 'PAYLOAD_TOO_LARGE' ? 413 : 400
        );
      }
      const id = env.GERE_ROOM.idFromName(code);
      const stub = env.GERE_ROOM.get(id);
      const doResp = await stub.fetch(
        new Request('https://room.internal/join', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
      );
      return withSecurityHeaders(doResp);
    }

    // --- WEBSOCKET UPGRADE ---
    const wsMatch = pathname.match(/^\/ws\/([A-Z0-9]{6})$/);
    if (wsMatch) {
      if (request.method !== 'GET') {
        return jsonResponse({ error: 'METHOD_NOT_ALLOWED' }, 405);
      }
      const upgrade = request.headers.get('Upgrade');
      if (!upgrade || upgrade.toLowerCase() !== 'websocket') {
        return jsonResponse({ error: 'EXPECTED_WEBSOCKET' }, 426);
      }
      const code = wsMatch[1];
      if (!ROOM_CODE_RE.test(code)) {
        return jsonResponse({ error: 'INVALID_ROOM_CODE' }, 400);
      }
      const id = env.GERE_ROOM.idFromName(code);
      const stub = env.GERE_ROOM.get(id);
      return stub.fetch(request);
    }

    // --- REVIEWS ---
    if (pathname === '/api/reviews') {
      if (request.method === 'GET') {
        const id = env.GERE_REVIEWS.idFromName('global-reviews');
        const stub = env.GERE_REVIEWS.get(id);
        const doResp = await stub.fetch(
          new Request('https://reviews.internal/list', { method: 'GET' })
        );
        return withSecurityHeaders(doResp);
      }
      if (request.method === 'POST') {
        if (!checkIpRateLimit(clientIp, 'review_post', 5, 300_000)) {
          return jsonResponse({ error: 'RATE_LIMITED' }, 429);
        }
        let body;
        try {
          body = await readBoundedJson(request, 1024);
        } catch (err) {
          return jsonResponse(
            { error: err.message === 'PAYLOAD_TOO_LARGE' ? 'PAYLOAD_TOO_LARGE' : 'INVALID_JSON' },
            err.message === 'PAYLOAD_TOO_LARGE' ? 413 : 400
          );
        }
        const id = env.GERE_REVIEWS.idFromName('global-reviews');
        const stub = env.GERE_REVIEWS.get(id);
        const doResp = await stub.fetch(
          new Request('https://reviews.internal/add', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          })
        );
        return withSecurityHeaders(doResp);
      }
      return jsonResponse({ error: 'METHOD_NOT_ALLOWED' }, 405);
    }

    return jsonResponse({ error: 'NOT_FOUND' }, 404);
  },
};