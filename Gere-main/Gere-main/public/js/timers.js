import { HARD_DEADLINE_MS } from './engine.js';

/**
 * Drift-free wall-clock delta timer using performance.now().
 * Immune to background-tab setInterval throttling.
 */
export class MatchClock {
  constructor({ mode = 'none', minutes = 5, onTick, onExpire }) {
    this.mode = mode; // 'none' | 'combined' | 'separate'
    this.baseMs = mode === 'none' ? 0 : minutes * 60 * 1000;
    this.combinedMs = this.baseMs;
    this.p1Ms = this.baseMs;
    this.p2Ms = this.baseMs;
    this.deadlineMs = HARD_DEADLINE_MS;
    this.activePlayer = 1;
    this.running = false;
    this.lastStamp = 0;
    this.rafId = null;
    this.onTick = onTick;
    this.onExpire = onExpire;
  }

  start(activePlayer = 1) {
    this.activePlayer = activePlayer;
    this.running = true;
    this.lastStamp = performance.now();
    this.loop();
  }

  setTurn(player) {
    if (this.running) this.sample();
    this.activePlayer = player;
  }

  stop() {
    this.running = false;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  sample() {
    const now = performance.now();
    const delta = Math.max(0, now - this.lastStamp);
    this.lastStamp = now;

    this.deadlineMs = Math.max(0, this.deadlineMs - delta);
    if (this.deadlineMs <= 0) {
      this.stop();
      if (this.onExpire) this.onExpire('deadline', 0);
      return;
    }

    if (this.mode === 'combined') {
      this.combinedMs = Math.max(0, this.combinedMs - delta);
      if (this.combinedMs <= 0) {
        this.stop();
        if (this.onExpire) this.onExpire('timeout_combined', 0);
        return;
      }
    } else if (this.mode === 'separate') {
      if (this.activePlayer === 1) {
        this.p1Ms = Math.max(0, this.p1Ms - delta);
        if (this.p1Ms <= 0) {
          this.stop();
          if (this.onExpire) this.onExpire('timeout', 2);
          return;
        }
      } else {
        this.p2Ms = Math.max(0, this.p2Ms - delta);
        if (this.p2Ms <= 0) {
          this.stop();
          if (this.onExpire) this.onExpire('timeout', 1);
          return;
        }
      }
    }

    if (this.onTick) {
      this.onTick({
        mode: this.mode,
        combinedMs: this.combinedMs,
        p1Ms: this.p1Ms,
        p2Ms: this.p2Ms,
        deadlineMs: this.deadlineMs,
        activePlayer: this.activePlayer,
      });
    }
  }

  loop() {
    if (!this.running) return;
    this.sample();
    if (this.running) {
      this.rafId = requestAnimationFrame(() => this.loop());
    }
  }
}

export function splitTimeParts(ms) {
  const clamped = Math.max(0, ms);
  const totalTenths = Math.floor(clamped / 100);
  const tenths = totalTenths % 10;
  const totalSecs = Math.floor(totalTenths / 10);
  const mins = Math.floor(totalSecs / 60);
  const secs = totalSecs % 60;
  return {
    mins: String(mins).padStart(2, '0'),
    secs: String(secs).padStart(2, '0'),
    tenths: `.${tenths}`,
  };
}