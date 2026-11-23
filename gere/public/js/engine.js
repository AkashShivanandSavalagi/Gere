// Canonical Gere Gameplay Engine — 100% parity with src/room-do.js
// Zero move limit: matches end ONLY on 3-in-a-row win, resignation, timer expiry, or 21-min deadline.

export const ADJACENCY = Object.freeze({
  0: [1, 3, 4],
  1: [0, 2, 4],
  2: [1, 4, 5],
  3: [0, 4, 6],
  4: [0, 1, 2, 3, 5, 6, 7, 8],
  5: [2, 4, 8],
  6: [3, 4, 7],
  7: [4, 6, 8],
  8: [4, 5, 7],
});

export const WIN_LINES = Object.freeze([
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
]);

export const HARD_DEADLINE_MS = 21 * 60 * 1000;

export function createGameState() {
  return {
    board: [0, 0, 0, 0, 0, 0, 0, 0, 0],
    turn: 1,
    phase: 'placement',
    placed: { 1: 0, 2: 0 },
    moves: { 1: 0, 2: 0 },
    selectedNode: null,
    winner: 0,
    winLine: null,
    endReason: null,
    historyKeys: [],
  };
}

export function checkWinner(board) {
  for (let i = 0; i < WIN_LINES.length; i++) {
    const [a, b, c] = WIN_LINES[i];
    if (board[a] !== 0 && board[a] === board[b] && board[b] === board[c]) {
      return { winner: board[a], line: WIN_LINES[i] };
    }
  }
  return null;
}

export function getValidTargets(state, fromNode) {
  if (state.winner !== 0 || state.endReason) return [];
  if (state.phase === 'placement') {
    const empty = [];
    for (let i = 0; i < 9; i++) {
      if (state.board[i] === 0) empty.push(i);
    }
    return empty;
  }
  if (!Number.isInteger(fromNode) || state.board[fromNode] !== state.turn) return [];
  return ADJACENCY[fromNode].filter((n) => state.board[n] === 0);
}

export function applyPlacement(state, node) {
  if (
    state.winner !== 0 ||
    state.endReason ||
    state.phase !== 'placement' ||
    !Number.isInteger(node) ||
    node < 0 ||
    node > 8 ||
    state.board[node] !== 0
  ) {
    return false;
  }

  const p = state.turn;
  state.board[node] = p;
  state.placed[p] += 1;
  state.moves[p] += 1;
  state.selectedNode = null;

  const win = checkWinner(state.board);
  if (win) {
    state.winner = win.winner;
    state.winLine = win.line;
    state.endReason = 'win';
  } else {
    if (state.placed[1] === 3 && state.placed[2] === 3) {
      state.phase = 'movement';
    }
    state.turn = p === 1 ? 2 : 1;
  }

  state.historyKeys.push(`${state.board.join('')}:${state.turn}`);
  if (state.historyKeys.length > 24) state.historyKeys.shift();
  return true;
}

export function applyMovement(state, from, to) {
  if (
    state.winner !== 0 ||
    state.endReason ||
    state.phase !== 'movement' ||
    !Number.isInteger(from) ||
    !Number.isInteger(to) ||
    from < 0 ||
    from > 8 ||
    to < 0 ||
    to > 8 ||
    state.board[from] !== state.turn ||
    state.board[to] !== 0 ||
    !ADJACENCY[from].includes(to)
  ) {
    return false;
  }

  const p = state.turn;
  state.board[from] = 0;
  state.board[to] = p;
  state.moves[p] += 1;
  state.selectedNode = null;

  const win = checkWinner(state.board);
  if (win) {
    state.winner = win.winner;
    state.winLine = win.line;
    state.endReason = 'win';
  } else {
    state.turn = p === 1 ? 2 : 1;
  }

  state.historyKeys.push(`${state.board.join('')}:${state.turn}`);
  if (state.historyKeys.length > 24) state.historyKeys.shift();
  return true;
}

export function getAllLegalActions(board, phase, player) {
  const actions = [];
  if (phase === 'placement') {
    for (let i = 0; i < 9; i++) {
      if (board[i] === 0) actions.push({ type: 'place', node: i });
    }
    return actions;
  }
  for (let from = 0; from < 9; from++) {
    if (board[from] === player) {
      const neighbors = ADJACENCY[from];
      for (let j = 0; j < neighbors.length; j++) {
        const to = neighbors[j];
        if (board[to] === 0) actions.push({ type: 'move', from, to });
      }
    }
  }
  return actions;
}