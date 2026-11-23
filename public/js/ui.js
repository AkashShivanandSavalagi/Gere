import { BOARD_SURFACES, PAWN_COLORS } from './theme.js';
import { splitTimeParts } from './timers.js';

export const NODE_SVG_COORDS = [
  { svgX: 45, svgY: 45 },
  { svgX: 150, svgY: 45 },
  { svgX: 255, svgY: 45 },
  { svgX: 45, svgY: 150 },
  { svgX: 150, svgY: 150 },
  { svgX: 255, svgY: 150 },
  { svgX: 45, svgY: 255 },
  { svgX: 150, svgY: 255 },
  { svgX: 255, svgY: 255 },
];

export function showScreen(screenId) {
  for (const el of document.querySelectorAll('.screen')) {
    el.classList.toggle('hidden', el.id !== screenId);
  }
}

export function renderColorSwatches(container, selectedId, disabledId, onSelect) {
  container.textContent = '';
  for (const c of PAWN_COLORS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `swatch-btn${c.id === selectedId ? ' selected' : ''}`;
    btn.disabled = c.id === disabledId;
    btn.setAttribute('aria-label', c.label);

    const dot = document.createElement('span');
    dot.className = `swatch-dot pawn-${c.id}`;
    btn.appendChild(dot);

    btn.addEventListener('click', () => onSelect(c.id));
    container.appendChild(btn);
  }
}

export function renderBoardPicker(container, activeId, onSelect) {
  container.textContent = '';
  for (const b of BOARD_SURFACES) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `pill-btn${b.id === activeId ? ' active' : ''}`;
    btn.textContent = b.label;
    btn.addEventListener('click', () => onSelect(b.id));
    container.appendChild(btn);
  }
}

function createPawnElement(colorId) {
  const pawn = document.createElement('div');
  pawn.className = `pawn-piece pawn-${colorId}`;
  const head = document.createElement('div');
  head.className = 'pawn-head';
  const collar = document.createElement('div');
  collar.className = 'pawn-collar';
  const base = document.createElement('div');
  base.className = 'pawn-base';
  pawn.append(head, collar, base);
  return pawn;
}

export function renderBoard({
  board,
  selectedNode,
  validTargets,
  p1Color,
  p2Color,
  winLine,
  onNodeClick,
}) {
  const container = document.getElementById('board-nodes');
  container.textContent = '';
  const validSet = new Set(validTargets);

  for (let i = 0; i < 9; i++) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `board-node node-pos-${i}`;
    if (selectedNode === i) btn.classList.add('selected');
    if (validSet.has(i)) btn.classList.add('valid-target');
    btn.setAttribute('aria-label', `Node ${i + 1}`);

    if (board[i] === 0) {
      const ring = document.createElement('span');
      ring.className = 'node-ring';
      btn.appendChild(ring);
    } else {
      btn.appendChild(createPawnElement(board[i] === 1 ? p1Color : p2Color));
    }

    btn.addEventListener('click', () => onNodeClick(i));
    container.appendChild(btn);
  }

  const winSvg = document.getElementById('win-line-svg');
  if (winLine && winLine.length === 3) {
    const start = NODE_SVG_COORDS[winLine[0]];
    const end = NODE_SVG_COORDS[winLine[2]];
    winSvg.setAttribute('x1', String(start.svgX));
    winSvg.setAttribute('y1', String(start.svgY));
    winSvg.setAttribute('x2', String(end.svgX));
    winSvg.setAttribute('y2', String(end.svgY));
    winSvg.classList.remove('hidden');
  } else {
    winSvg.classList.add('hidden');
  }
}

export function renderPlayerCards({ p1, p2, turn, placed, moves }) {
  const card1 = document.getElementById('card-p1');
  const card2 = document.getElementById('card-p2');
  card1.classList.toggle('active-turn', turn === 1);
  card2.classList.toggle('active-turn', turn === 2);

  document.getElementById('dot-p1').className = `player-dot pawn-${p1.color}`;
  document.getElementById('dot-p2').className = `player-dot pawn-${p2.color}`;
  document.getElementById('name-p1').textContent = p1.name;
  document.getElementById('name-p2').textContent = p2.name;
  document.getElementById('pawns-p1').textContent = `PAWNS ${placed[1]}/3`;
  document.getElementById('pawns-p2').textContent = `PAWNS ${placed[2]}/3`;
  document.getElementById('moves-p1').textContent = `MOVES ${moves[1]}`;
  document.getElementById('moves-p2').textContent = `MOVES ${moves[2]}`;
}

function buildTimerPill(ms, isActive) {
  const pill = document.createElement('div');
  pill.className = `timer-pill${isActive ? ' active' : ''}${ms < 20000 ? ' low' : ''}`;
  const parts = splitTimeParts(ms);

  const m = document.createElement('span');
  m.className = 'timer-min';
  m.textContent = parts.mins;

  const sep = document.createElement('span');
  sep.className = 'timer-sep';
  sep.textContent = ':';

  const s = document.createElement('span');
  s.className = 'timer-sec';
  s.textContent = parts.secs;

  const t = document.createElement('span');
  t.className = 'timer-tenths';
  t.textContent = parts.tenths;

  pill.append(m, sep, s, t);
  return pill;
}

export function renderTimers({ mode, combinedMs, p1Ms, p2Ms, activePlayer }) {
  const row = document.getElementById('timers-row');
  row.textContent = '';
  if (mode === 'none') return;
  if (mode === 'combined') {
    row.appendChild(buildTimerPill(combinedMs, true));
  } else if (mode === 'separate') {
    row.appendChild(buildTimerPill(p1Ms, activePlayer === 1));
    row.appendChild(buildTimerPill(p2Ms, activePlayer === 2));
  }
}

export function startEmblemAnimation() {
  const pawn = document.getElementById('emblem-pawn');
  if (!pawn) return;
  const path = [
    [50, 50],
    [20, 20],
    [50, 20],
    [50, 50],
    [80, 80],
    [80, 50],
    [50, 50],
    [20, 80],
  ];
  let idx = 0;
  setInterval(() => {
    idx = (idx + 1) % path.length;
    pawn.setAttribute('cx', String(path[idx][0]));
    pawn.setAttribute('cy', String(path[idx][1]));
  }, 1150);
}