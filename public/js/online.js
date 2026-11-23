const SESSION_KEY = 'gere_online_session';

const ERROR_MESSAGES = {
  SERVER_MISCONFIGURED: 'Server secret missing. Set SESSION_SECRET in .dev.vars or Cloudflare secrets.',
  ROOM_NOT_FOUND: 'Room not found. Check the 6-character code and try again.',
  ROOM_FULL: 'This room already has 2 players.',
  ROOM_NOT_AVAILABLE: 'This room is no longer accepting players.',
  FORBIDDEN_ORIGIN: 'Origin blocked by security policy. Open via http://localhost:8080.',
  RATE_LIMITED: 'Too many requests. Wait a few seconds and try again.',
  INVALID_ROOM_CODE: 'Enter a valid 6-character room code.',
};

async function parseApiResponse(res) {
  const rawText = await res.text();
  let data = null;
  if (rawText) {
    try {
      data = JSON.parse(rawText);
    } catch {
      if (res.status === 404 || res.status === 405 || res.status === 501) {
        throw new Error(
          'Online backend is not running on this port. Start with: npx wrangler dev --port 8080'
        );
      }
      throw new Error(`Unexpected server response (HTTP ${res.status}).`);
    }
  }
  if (!res.ok) {
    const code = data && data.error ? data.error : `HTTP_${res.status}`;
    throw new Error(ERROR_MESSAGES[code] || code);
  }
  return data || {};
}

export class OnlineClient {
  constructor({ onState, onStatus, onError }) {
    this.ws = null;
    this.roomCode = null;
    this.player = 0;
    this.token = null;
    this.pingTimer = null;
    this.reconnectTimer = null;
    this.closedByUser = false;
    this.onState = onState;
    this.onStatus = onStatus;
    this.onError = onError;
  }

  saveSession() {
    try {
      sessionStorage.setItem(
        SESSION_KEY,
        JSON.stringify({ roomCode: this.roomCode, player: this.player, token: this.token })
      );
    } catch {
      // ignore storage restrictions
    }
  }

  clearSession() {
    try {
      sessionStorage.removeItem(SESSION_KEY);
    } catch {
      // ignore
    }
  }

  tryResumeSession() {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      if (!raw) return false;
      const saved = JSON.parse(raw);
      if (saved && saved.roomCode && saved.token && (saved.player === 1 || saved.player === 2)) {
        this.roomCode = saved.roomCode;
        this.player = saved.player;
        this.token = saved.token;
        this.connect();
        return true;
      }
    } catch {
      this.clearSession();
    }
    return false;
  }

  async createRoom({ name, color, timeMode, timeMinutes }) {
    const res = await fetch('/api/rooms', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ name, color, timeMode, timeMinutes }),
    });
    const data = await parseApiResponse(res);
    this.roomCode = data.roomCode;
    this.player = data.player;
    this.token = data.token;
    this.saveSession();
    this.connect();
    return data;
  }

  async joinRoom({ roomCode, name, color }) {
    const code = roomCode.trim().toUpperCase();
    const res = await fetch(`/api/rooms/${encodeURIComponent(code)}/join`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ name, color }),
    });
    const data = await parseApiResponse(res);
    this.roomCode = data.roomCode;
    this.player = data.player;
    this.token = data.token;
    this.saveSession();
    this.connect();
    return data;
  }

  connect() {
    if (!this.roomCode || !this.token) return;
    this.closedByUser = false;
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${proto}//${location.host}/ws/${this.roomCode}`;

    this.ws = new WebSocket(wsUrl);
    this.ws.addEventListener('open', () => {
      this.ws.send(JSON.stringify({ type: 'AUTH', token: this.token }));
      this.startPing();
    });

    this.ws.addEventListener('message', (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type === 'AUTH_OK') {
          if (this.onStatus) this.onStatus('connected');
        } else if (msg.type === 'STATE') {
          if (this.onState) this.onState(msg);
        }
      } catch {
        // ignore malformed frames
      }
    });

    this.ws.addEventListener('close', (ev) => {
      this.stopPing();
      if (ev.code === 1008 || ev.code === 1000) {
        this.clearSession();
        if (ev.reason === 'ROOM_EXPIRED' && this.onError) {
          this.onError('Room expired due to inactivity.');
        }
        return;
      }
      if (!this.closedByUser && this.token) {
        if (this.onStatus) this.onStatus('reconnecting');
        this.reconnectTimer = setTimeout(() => this.connect(), 1800);
      }
    });

    this.ws.addEventListener('error', () => {
      if (this.onError) this.onError('Connection interrupted');
    });
  }

  startPing() {
    this.stopPing();
    this.pingTimer = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'PING' }));
      }
    }, 15000);
  }

  stopPing() {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  sendIntent(payload) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
    }
  }

  disconnect() {
    this.closedByUser = true;
    this.stopPing();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      try {
        this.ws.close(1000, 'CLIENT_EXIT');
      } catch {
        // ignore
      }
      this.ws = null;
    }
    this.roomCode = null;
    this.player = 0;
    this.token = null;
    this.clearSession();
  }
}