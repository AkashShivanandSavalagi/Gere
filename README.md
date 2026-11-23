# ಗೆರೆ — GERE

A strategic two-player board game. **Think · Move · Win.**

## Game Rules
- **Board**: 3×3 grid with 9 circular nodes (`0–8`), 3 horizontal, 3 vertical, and 2 main diagonal lines through center `4`.
- **Phase 1 — Placement**: Alternate placing 1 pawn per turn onto any empty node (`PAWNS 0/3` → `3/3`). Win is checked after every placement.
- **Phase 2 — Movement**: Select one of your pawns and move it along a connected line to an adjacent empty node. No jumping or overwriting.
- **Win Condition**: Align 3 pawns in a straight line (horizontal, vertical, or diagonal).
- **No Move Limit**: Matches end only on a 3-in-a-row win, resignation, countdown timer expiry, or the 21-minute hard deadline.

## Game Modes
1. **Local Multiplayer**: Two players on one device with `None`, `Combined`, or `Separate` (`2`, `5`, `9`, `12` min) drift-free wall-clock timers, custom names, 8 pawn colors, and 6 board surfaces.
2. **Play with PC**: 4 AI levels (`Easy`, `Medium`, `Hard` 7-ply Alpha-Beta, `Impossible` up to 13-ply iterative deepening with transposition table and non-blocking time budget).
3. **Online Multiplayer**: Real-time matches via Cloudflare Durable Objects (`GereRoom`) with SQLite storage, WebSocket Hibernation, offline SVG QR invites, HMAC-SHA256 session tokens, reconnection, and server-authoritative anti-cheat.
4. **Rate Gere**: Live star rating & review widget backed by `GereReviews` Durable Object with offline `localStorage` fallback.

## Run Locally

### Method 1: Cloudflare Wrangler (Full Stack — Local, AI, Online, Reviews)
1. Install Wrangler:
   ```bash
   npm install