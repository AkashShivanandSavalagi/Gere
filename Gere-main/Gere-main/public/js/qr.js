// Offline QR Code SVG Generator (Version 3-L, Byte Mode, up to 53 UTF-8 bytes)
// Zero external APIs, zero network calls, 100% deterministic.

const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
(function initGalois() {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255];
})();

function gfMul(a, b) {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[GF_LOG[a] + GF_LOG[b]];
}

function rsEncode(data, ecLen) {
  let poly = [1];
  for (let i = 0; i < ecLen; i++) {
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], GF_EXP[i]);
    }
    poly = next;
  }
  const res = new Uint8Array(data.length + ecLen);
  res.set(data);
  for (let i = 0; i < data.length; i++) {
    const coef = res[i];
    if (coef !== 0) {
      for (let j = 1; j < poly.length; j++) {
        res[i + j] ^= gfMul(poly[j], coef);
      }
    }
  }
  return res.slice(data.length);
}

function encodeVersion3L(text) {
  const bytes = new TextEncoder().encode(text).slice(0, 53);
  const bits = [];
  const pushBits = (val, len) => {
    for (let i = len - 1; i >= 0; i--) bits.push((val >> i) & 1);
  };
  pushBits(0b0100, 4);
  pushBits(bytes.length, 8);
  for (const b of bytes) pushBits(b, 8);
  pushBits(0, Math.min(4, 55 * 8 - bits.length));
  while (bits.length % 8 !== 0) bits.push(0);

  const data = [];
  for (let i = 0; i < bits.length; i += 8) {
    let v = 0;
    for (let j = 0; j < 8; j++) v = (v << 1) | bits[i + j];
    data.push(v);
  }
  const pad = [0xec, 0x11];
  let pi = 0;
  while (data.length < 55) {
    data.push(pad[pi++ % 2]);
  }
  const ec = rsEncode(new Uint8Array(data), 15);
  return [...data, ...ec];
}

function buildQrMatrix(text) {
  const size = 29;
  const m = Array.from({ length: size }, () => new Int8Array(size));
  const reserved = Array.from({ length: size }, () => new Uint8Array(size));

  const setMod = (r, c, val, res = true) => {
    if (r >= 0 && r < size && c >= 0 && c < size) {
      m[r][c] = val ? 1 : 0;
      if (res) reserved[r][c] = 1;
    }
  };

  const drawFinder = (r0, c0) => {
    for (let dr = -1; dr <= 7; dr++) {
      for (let dc = -1; dc <= 7; dc++) {
        const inOuter = dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6;
        const onEdge = dr === 0 || dr === 6 || dc === 0 || dc === 6;
        const inCore = dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4;
        setMod(r0 + dr, c0 + dc, inOuter && (onEdge || inCore));
      }
    }
  };

  drawFinder(0, 0);
  drawFinder(0, size - 7);
  drawFinder(size - 7, 0);

  for (let dr = -2; dr <= 2; dr++) {
    for (let dc = -2; dc <= 2; dc++) {
      setMod(22 + dr, 22 + dc, Math.max(Math.abs(dr), Math.abs(dc)) !== 1);
    }
  }

  for (let i = 8; i < size - 8; i++) {
    setMod(6, i, i % 2 === 0);
    setMod(i, 6, i % 2 === 0);
  }

  setMod(size - 8, 8, 1);
  for (let i = 0; i < 9; i++) {
    if (!reserved[8][i]) reserved[8][i] = 1;
    if (!reserved[i][8]) reserved[i][8] = 1;
  }
  for (let i = size - 8; i < size; i++) {
    reserved[8][i] = 1;
    reserved[i][8] = 1;
  }

  const codewords = encodeVersion3L(text);
  let bitIdx = 0;
  let up = true;
  for (let col = size - 1; col > 0; col -= 2) {
    if (col === 6) col--;
    for (let step = 0; step < size; step++) {
      const row = up ? size - 1 - step : step;
      for (let dx = 0; dx < 2; dx++) {
        const c = col - dx;
        if (!reserved[row][c]) {
          const byte = codewords[bitIdx >> 3] || 0;
          const bit = (byte >> (7 - (bitIdx & 7))) & 1;
          m[row][c] = (row + c) % 2 === 0 ? bit ^ 1 : bit;
          bitIdx++;
        }
      }
    }
    up = !up;
  }

  const fmt = 0x77c4;
  const fbit = (i) => (fmt >> i) & 1;
  for (let i = 0; i <= 5; i++) m[8][i] = fbit(14 - i);
  m[8][7] = fbit(8);
  m[8][8] = fbit(7);
  m[7][8] = fbit(6);
  for (let i = 0; i <= 5; i++) m[5 - i][8] = fbit(5 - i);
  for (let i = 0; i <= 7; i++) m[8][size - 1 - i] = fbit(i);
  for (let i = 0; i <= 6; i++) m[size - 7 + i][8] = fbit(14 - i);
  return m;
}

export function renderQrSvgElement(text, px = 176) {
  const m = buildQrMatrix(text);
  const size = m.length;
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('width', String(px));
  svg.setAttribute('height', String(px));
  svg.setAttribute('viewBox', `0 0 ${size + 4} ${size + 4}`);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Room invite QR code');

  const bg = document.createElementNS(ns, 'rect');
  bg.setAttribute('width', String(size + 4));
  bg.setAttribute('height', String(size + 4));
  bg.setAttribute('fill', '#f7f3eb');
  svg.appendChild(bg);

  let d = '';
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (m[r][c]) d += `M${c + 2},${r + 2}h1v1h-1z`;
    }
  }
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', d);
  path.setAttribute('fill', '#1c2331');
  svg.appendChild(path);
  return svg;
}