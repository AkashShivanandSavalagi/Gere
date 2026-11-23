import { DurableObject } from 'cloudflare:workers';

// Canonical Gere rules — 100% parity with public/js/engine.js
const ADJACENCY = {
  0: [1, 3, 4],
  1: [0, 2, 4],
  2: [1, 4, 5],
  3: [0, 4, 6],
  4: [0, 1, 2, 3, 5, 6, 7, 8],
  5: [2, 4, 8],
  6: [3, 4, 7],
  7: [4, 6, 8],
  8: [4, 5, 7],
};

const WIN_LINES = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
];

const HARD_DEADLINE_MS = 21 * 60 * 1000;
const IDLE_CLEANUP_MS = 25 * 60 * 1000;
const FINISHED_CLEANUP_MS = 5 * 60 * 1000;
const MAX_WS_PAYLOAD_BYTES = 1024;
const AUTH_TIMEOUT_MS = 5000;
const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_MS = 5000;

const VALID_TIME_MODES = new Set(['none', 'combined', 'separate']);
const VALID_TIME_MINS = new Set([2, 5, 9, 12]);
const VALID_COLORS = new Set([
  'teal',
  'terracotta',
  'indigo',
  'crimson',
  'emerald',
  'slate',
  'plum',
  'ochre',
]);

function checkWinner(board) {
  for (let i = 0; i < WIN_LINES.length; i++) {
    const [a, b, c] = WIN_LINES[i];
    if (board[a] !== 0 && board[a] === board[b] && board[b] === board[c]) {
      return { winner: board[a], line: WIN_LINES[i] };
    }
  }
  return null;
}

function sanitizeName(raw, fallback) {
  if (typeof raw !== 'string') return fallback;
  const cleaned = raw.replace(/[\x00-\x1F\x7F]/g, '').trim().slice(0, 18);
  return cleaned || fallback;
}

function sanitizeColor(raw, fallback) {
  return typeof raw === 'string' && VALID_COLORS.has(raw) ? raw : fallback;
}

function toHex(buf) {
  const bytes = new Uint8Array(buf);
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, '0');
  }
  return out;
}

function constantTimeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

async function sha256Hex(str) {
  const data = new TextEncoder().encode(str);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return toHex(digest);
}

async function signToken(rawToken, secret) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawToken));
  return `${rawToken}.${toHex(sig)}`;
}

async function verifySignedToken(signedToken, secret) {
  if (typeof signedToken !== 'string') return false;
  const parts = signedToken.split('.');
  if (parts.length !== 2 || parts[0].length !== 64 || parts[1].length !== 64) {
    return false;
  }
  const expected = await signToken(parts[0], secret);
  return constantTimeEqual(signedToken, expected);
}

async function issueSessionToken(secret) {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const raw = toHex(bytes);
  const signed = await signToken(raw, secret);
  const hash = await sha256Hex(signed);
  return { signed, hash };
}

function jsonResp(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

export class GereRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx = ctx;
    this.env = env;
    this.authTimers = new WeakMap();
  }

  getSecret() {
    if (!this.env.SESSION_SECRET || this.env.SESSION_SECRET.length < 16) {
      throw new Error('SESSION_SECRET_NOT_CONFIGURED');
    }
    return this.env.SESSION_SECRET;
  }

  async loadRoom() {
    return (await this.ctx.storage.get('room')) || null;
  }

  async saveRoom(room) {
    await this.ctx.storage.put('room', room);
    const cleanupDelay = room.status === 'finished' ? FINISHED_CLEANUP_MS : IDLE_CLEANUP_MS;
    await this.ctx.storage.setAlarm(Date.now() + cleanupDelay);
  }

  async alarm() {
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.close(1000, 'ROOM_EXPIRED');
      } catch {
        // ignore closed sockets
      }
    }
    await this.ctx.storage.deleteAll();
  }

  createFreshGameState(room, now) {
    const baseMs = room.timeMode === 'none' ? 0 : room.timeMinutes * 60 * 1000;
    return {
      board: [0, 0, 0, 0, 0, 0, 0, 0, 0],
      turn: 1,
      phase: 'placement',
      placed: { 1: 0, 2: 0 },
      moves: { 1: 0, 2: 0 },
      winner: 0,
      winLine: null,
      endReason: null,
      startedAt: now,
      lastTurnAt: now,
      deadlineAt: now + HARD_DEADLINE_MS,
      clocks: {
        combined: baseMs,
        1: baseMs,
        2: baseMs,
      },
      rematchVotes: { 1: false, 2: false },
    };
  }

  syncClocks(room, now) {
    if (room.status !== 'playing' || !room.game) return false;
    const g = room.game;
    const elapsed = Math.max(0, now - g.lastTurnAt);
    g.lastTurnAt = now;

    if (now >= g.deadlineAt) {
      room.status = 'finished';
      g.winner = 0;
      g.endReason = 'deadline';
      return true;
    }

    if (room.timeMode === 'combined') {
      g.clocks.combined = Math.max(0, g.clocks.combined - elapsed);
      if (g.clocks.combined <= 0) {
        room.status = 'finished';
        g.winner = 0;
        g.endReason = 'timeout_combined';
        return true;
      }
    } else if (room.timeMode === 'separate') {
      const p = g.turn;
      g.clocks[p] = Math.max(0, g.clocks[p] - elapsed);
      if (g.clocks[p] <= 0) {
        room.status = 'finished';
        g.winner = p === 1 ? 2 : 1;
        g.endReason = 'timeout';
        return true;
      }
    }
    return false;
  }

  buildPublicSnapshot(room, now) {
    const g = room.game;
    return {
      type: 'STATE',
      serverNow: now,
      roomCode: room.roomCode,
      status: room.status,
      timeMode: room.timeMode,
      timeMinutes: room.timeMinutes,
      players: {
        1: room.players[1]
          ? {
              name: room.players[1].name,
              color: room.players[1].color,
              connected: room.players[1].connected,
            }
          : null,
        2: room.players[2]
          ? {
              name: room.players[2].name,
              color: room.players[2].color,
              connected: room.players[2].connected,
            }
          : null,
      },
      game: g
        ? {
            board: g.board,
            turn: g.turn,
            phase: g.phase,
            placed: g.placed,
            moves: g.moves,
            winner: g.winner,
            winLine: g.winLine,
            endReason: g.endReason,
            deadlineAt: g.deadlineAt,
            clocks: g.clocks,
            lastTurnAt: g.lastTurnAt,
            rematchVotes: g.rematchVotes,
          }
        : null,
    };
  }

  broadcast(payload) {
    const msg = JSON.stringify(payload);
    for (const ws of this.ctx.getWebSockets()) {
      const meta = ws.deserializeAttachment();
      if (meta && meta.authed) {
        try {
          ws.send(msg);
        } catch {
          // ignore broken socket
        }
      }
    }
  }

  async fetch(request) {
    const url = new URL(request.url);

    // WebSocket Hibernation upgrade
    if (request.headers.get('Upgrade')?.toLowerCase() === 'websocket') {
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      this.ctx.acceptWebSocket(server);
      const now = Date.now();
      server.serializeAttachment({
        authed: false,
        player: 0,
        connectedAt: now,
        rateStart: now,
        rateCount: 0,
      });

      const timer = setTimeout(() => {
        const meta = server.deserializeAttachment();
        if (!meta || !meta.authed) {
          try {
            server.close(1008, 'AUTH_TIMEOUT');
          } catch {
            // ignore
          }
        }
      }, AUTH_TIMEOUT_MS);
      this.authTimers.set(server, timer);
      return new Response(null, { status: 101, webSocket: client });
    }

    if (url.pathname === '/create' && request.method === 'POST') {
      let secret;
      try {
        secret = this.getSecret();
      } catch {
        return jsonResp({ error: 'SERVER_MISCONFIGURED' }, 500);
      }

      const existing = await this.loadRoom();
      if (existing) {
        return jsonResp({ error: 'ROOM_EXISTS' }, 409);
      }

      const body = await request.json();
      const roomCode = typeof body.roomCode === 'string' ? body.roomCode : '';
      const timeMode = VALID_TIME_MODES.has(body.timeMode) ? body.timeMode : 'none';
      const timeMinutes = VALID_TIME_MINS.has(Number(body.timeMinutes))
        ? Number(body.timeMinutes)
        : 5;
      const p1Name = sanitizeName(body.name, 'P1');
      const p1Color = sanitizeColor(body.color, 'teal');

      const { signed, hash } = await issueSessionToken(secret);

      const room = {
        roomCode,
        status: 'waiting',
        timeMode,
        timeMinutes,
        players: {
          1: { name: p1Name, color: p1Color, tokenHash: hash, connected: false },
          2: null,
        },
        game: null,
      };

      await this.saveRoom(room);
      return jsonResp({ roomCode, player: 1, token: signed }, 201);
    }

    if (url.pathname === '/join' && request.method === 'POST') {
      let secret;
      try {
        secret = this.getSecret();
      } catch {
        return jsonResp({ error: 'SERVER_MISCONFIGURED' }, 500);
      }

      const room = await this.loadRoom();
      if (!room) {
        return jsonResp({ error: 'ROOM_NOT_FOUND' }, 404);
      }
      if (room.players[2]) {
        return jsonResp({ error: 'ROOM_FULL' }, 409);
      }
      if (room.status !== 'waiting') {
        return jsonResp({ error: 'ROOM_NOT_AVAILABLE' }, 409);
      }

      const body = await request.json();
      const p2Name = sanitizeName(body.name, 'P2');
      let p2Color = sanitizeColor(body.color, 'terracotta');
      if (p2Color === room.players[1].color) {
        p2Color = p2Color === 'terracotta' ? 'indigo' : 'terracotta';
      }

      const { signed, hash } = await issueSessionToken(secret);
      const now = Date.now();

      room.players[2] = { name: p2Name, color: p2Color, tokenHash: hash, connected: false };
      room.status = 'playing';
      room.game = this.createFreshGameState(room, now);

      await this.saveRoom(room);
      return jsonResp({ roomCode: room.roomCode, player: 2, token: signed }, 200);
    }

    return jsonResp({ error: 'NOT_FOUND' }, 404);
  }

  async webSocketMessage(ws, message) {
    const now = Date.now();
    const meta = ws.deserializeAttachment() || {
      authed: false,
      player: 0,
      connectedAt: now,
      rateStart: now,
      rateCount: 0,
    };

    if (now - meta.rateStart > RATE_LIMIT_WINDOW_MS) {
      meta.rateStart = now;
      meta.rateCount = 1;
    } else {
      meta.rateCount += 1;
    }
    ws.serializeAttachment(meta);

    if (meta.rateCount > RATE_LIMIT_MAX) {
      ws.close(1008, 'RATE_LIMITED');
      return;
    }

    const byteLen =
      typeof message === 'string'
        ? new TextEncoder().encode(message).byteLength
        : message.byteLength;
    if (byteLen > MAX_WS_PAYLOAD_BYTES) {
      ws.close(1009, 'PAYLOAD_TOO_LARGE');
      return;
    }

    let data;
    try {
      const text =
        typeof message === 'string'
          ? message
          : new TextDecoder('utf-8', { fatal: true }).decode(message);
      data = JSON.parse(text);
    } catch {
      ws.close(1008, 'INVALID_JSON');
      return;
    }

    if (!data || typeof data.type !== 'string') {
      return;
    }

    const room = await this.loadRoom();
    if (!room) {
      ws.close(1000, 'ROOM_NOT_FOUND');
      return;
    }

    if (!meta.authed) {
      if (now - meta.connectedAt > AUTH_TIMEOUT_MS) {
        ws.close(1008, 'AUTH_TIMEOUT');
        return;
      }
      if (data.type !== 'AUTH' || typeof data.token !== 'string') {
        ws.close(1008, 'AUTH_REQUIRED');
        return;
      }

      let secret;
      try {
        secret = this.getSecret();
      } catch {
        ws.close(1011, 'SERVER_ERROR');
        return;
      }

      const validSig = await verifySignedToken(data.token, secret);
      if (!validSig) {
        ws.close(1008, 'INVALID_TOKEN');
        return;
      }

      const hash = await sha256Hex(data.token);
      let playerNum = 0;
      if (room.players[1] && constantTimeEqual(hash, room.players[1].tokenHash)) {
        playerNum = 1;
      } else if (room.players[2] && constantTimeEqual(hash, room.players[2].tokenHash)) {
        playerNum = 2;
      } else {
        ws.close(1008, 'UNAUTHORIZED');
        return;
      }

      const timer = this.authTimers.get(ws);
      if (timer) {
        clearTimeout(timer);
        this.authTimers.delete(ws);
      }

      meta.authed = true;
      meta.player = playerNum;
      ws.serializeAttachment(meta);

      room.players[playerNum].connected = true;
      this.syncClocks(room, now);
      await this.saveRoom(room);

      ws.send(JSON.stringify({ type: 'AUTH_OK', player: playerNum }));
      this.broadcast(this.buildPublicSnapshot(room, now));
      return;
    }

    const player = meta.player;

    if (data.type === 'PING') {
      const ended = this.syncClocks(room, now);
      if (ended) {
        await this.saveRoom(room);
        this.broadcast(this.buildPublicSnapshot(room, now));
      } else {
        ws.send(JSON.stringify({ type: 'PONG', serverNow: now }));
      }
      return;
    }

    if (data.type === 'PLACE_PAWN') {
      const ended = this.syncClocks(room, now);
      if (ended) {
        await this.saveRoom(room);
        this.broadcast(this.buildPublicSnapshot(room, now));
        return;
      }

      const g = room.game;
      const node = data.node;
      if (
        room.status !== 'playing' ||
        !g ||
        g.turn !== player ||
        g.phase !== 'placement' ||
        !Number.isInteger(node) ||
        node < 0 ||
        node > 8 ||
        g.board[node] !== 0
      ) {
        ws.send(JSON.stringify(this.buildPublicSnapshot(room, now)));
        return;
      }

      g.board[node] = player;
      g.placed[player] += 1;
      g.moves[player] += 1;

      const win = checkWinner(g.board);
      if (win) {
        room.status = 'finished';
        g.winner = win.winner;
        g.winLine = win.line;
        g.endReason = 'win';
      } else {
        if (g.placed[1] === 3 && g.placed[2] === 3) {
          g.phase = 'movement';
        }
        g.turn = player === 1 ? 2 : 1;
      }

      await this.saveRoom(room);
      this.broadcast(this.buildPublicSnapshot(room, now));
      return;
    }

    if (data.type === 'MOVE_PAWN') {
      const ended = this.syncClocks(room, now);
      if (ended) {
        await this.saveRoom(room);
        this.broadcast(this.buildPublicSnapshot(room, now));
        return;
      }

      const g = room.game;
      const { from, to } = data;
      if (
        room.status !== 'playing' ||
        !g ||
        g.turn !== player ||
        g.phase !== 'movement' ||
        !Number.isInteger(from) ||
        !Number.isInteger(to) ||
        from < 0 ||
        from > 8 ||
        to < 0 ||
        to > 8 ||
        g.board[from] !== player ||
        g.board[to] !== 0 ||
        !ADJACENCY[from].includes(to)
      ) {
        ws.send(JSON.stringify(this.buildPublicSnapshot(room, now)));
        return;
      }

      g.board[from] = 0;
      g.board[to] = player;
      g.moves[player] += 1;

      const win = checkWinner(g.board);
      if (win) {
        room.status = 'finished';
        g.winner = win.winner;
        g.winLine = win.line;
        g.endReason = 'win';
      } else {
        g.turn = player === 1 ? 2 : 1;
      }

      await this.saveRoom(room);
      this.broadcast(this.buildPublicSnapshot(room, now));
      return;
    }

    if (data.type === 'RESIGN') {
      if (room.status === 'playing' && room.game) {
        room.status = 'finished';
        room.game.winner = player === 1 ? 2 : 1;
        room.game.endReason = 'resign';
        await this.saveRoom(room);
        this.broadcast(this.buildPublicSnapshot(room, now));
      }
      return;
    }

    if (data.type === 'REMATCH') {
      if (room.status === 'finished' && room.game && room.players[1] && room.players[2]) {
        room.game.rematchVotes[player] = true;
        if (room.game.rematchVotes[1] && room.game.rematchVotes[2]) {
          room.status = 'playing';
          room.game = this.createFreshGameState(room, now);
        }
        await this.saveRoom(room);
        this.broadcast(this.buildPublicSnapshot(room, now));
      }
    }
  }

  async webSocketClose(ws) {
    const timer = this.authTimers.get(ws);
    if (timer) {
      clearTimeout(timer);
      this.authTimers.delete(ws);
    }

    const meta = ws.deserializeAttachment();
    if (!meta || !meta.authed) return;

    const room = await this.loadRoom();
    if (!room || !room.players[meta.player]) return;

    const stillConnected = this.ctx.getWebSockets().some((s) => {
      if (s === ws) return false;
      const m = s.deserializeAttachment();
      return m && m.authed && m.player === meta.player;
    });

    if (!stillConnected) {
      room.players[meta.player].connected = false;
      const now = Date.now();
      this.syncClocks(room, now);
      await this.saveRoom(room);
      this.broadcast(this.buildPublicSnapshot(room, now));
    }
  }

  async webSocketError(ws) {
    await this.webSocketClose(ws);
  }
}