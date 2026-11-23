import { WIN_LINES, checkWinner, getAllLegalActions } from './engine.js';

const AI_PLAYER = 2;
const HUMAN_PLAYER = 1;
const INF = 100000;

function applyActionClone(board, placed, action, player) {
  const nextBoard = board.slice();
  const nextPlaced = { 1: placed[1], 2: placed[2] };
  if (action.type === 'place') {
    nextBoard[action.node] = player;
    nextPlaced[player] += 1;
  } else {
    nextBoard[action.from] = 0;
    nextBoard[action.to] = player;
  }
  const nextPhase = nextPlaced[1] === 3 && nextPlaced[2] === 3 ? 'movement' : 'placement';
  return { nextBoard, nextPlaced, nextPhase };
}

function evaluateBoard(board) {
  let score = 0;
  if (board[4] === AI_PLAYER) score += 28;
  else if (board[4] === HUMAN_PLAYER) score -= 28;

  for (let i = 0; i < WIN_LINES.length; i++) {
    const [a, b, c] = WIN_LINES[i];
    let aiCount = 0;
    let huCount = 0;
    if (board[a] === AI_PLAYER) aiCount++;
    else if (board[a] === HUMAN_PLAYER) huCount++;
    if (board[b] === AI_PLAYER) aiCount++;
    else if (board[b] === HUMAN_PLAYER) huCount++;
    if (board[c] === AI_PLAYER) aiCount++;
    else if (board[c] === HUMAN_PLAYER) huCount++;

    if (aiCount === 2 && huCount === 0) score += 22;
    else if (huCount === 2 && aiCount === 0) score -= 24;
    else if (aiCount === 1 && huCount === 0) score += 4;
    else if (huCount === 1 && aiCount === 0) score -= 4;
  }
  return score;
}

function orderActions(actions, board, player) {
  return actions
    .map((a) => {
      let prio = 0;
      const target = a.type === 'place' ? a.node : a.to;
      if (target === 4) prio += 10;
      const test = board.slice();
      if (a.type === 'place') test[a.node] = player;
      else {
        test[a.from] = 0;
        test[a.to] = player;
      }
      if (checkWinner(test)) prio += 100;
      return { a, prio };
    })
    .sort((x, y) => y.prio - x.prio)
    .map((x) => x.a);
}

function findImmediateWin(board, placed, phase, player) {
  const actions = getAllLegalActions(board, phase, player);
  for (const act of actions) {
    const { nextBoard } = applyActionClone(board, placed, act, player);
    const win = checkWinner(nextBoard);
    if (win && win.winner === player) return act;
  }
  return null;
}

function findImmediateBlock(board, placed, phase) {
  const actions = getAllLegalActions(board, phase, AI_PLAYER);
  const humanThreat = findImmediateWin(board, placed, phase, HUMAN_PLAYER);
  if (!humanThreat) return null;
  const blockNode = humanThreat.type === 'place' ? humanThreat.node : humanThreat.to;
  return (
    actions.find((a) => (a.type === 'place' ? a.node === blockNode : a.to === blockNode)) || null
  );
}

function minimaxSearch(board, placed, phase, depth, alpha, beta, maximizing, tt, deadline, recentSet) {
  if (performance.now() > deadline) return { score: 0, timedOut: true };

  const win = checkWinner(board);
  if (win) {
    return {
      score: win.winner === AI_PLAYER ? 10000 + depth : -10000 - depth,
      timedOut: false,
    };
  }
  if (depth === 0) {
    return { score: evaluateBoard(board), timedOut: false };
  }

  const key = `${board.join('')}|${phase[0]}|${maximizing ? 2 : 1}|${depth}`;
  const cached = tt.get(key);
  if (cached !== undefined) {
    return { score: cached, timedOut: false };
  }

  const player = maximizing ? AI_PLAYER : HUMAN_PLAYER;
  const actions = orderActions(getAllLegalActions(board, phase, player), board, player);
  if (actions.length === 0) {
    return { score: 0, timedOut: false };
  }

  let best = maximizing ? -INF : INF;
  for (let i = 0; i < actions.length; i++) {
    const act = actions[i];
    const { nextBoard, nextPlaced, nextPhase } = applyActionClone(board, placed, act, player);
    const res = minimaxSearch(
      nextBoard,
      nextPlaced,
      nextPhase,
      depth - 1,
      alpha,
      beta,
      !maximizing,
      tt,
      deadline,
      recentSet
    );
    if (res.timedOut) return { score: 0, timedOut: true };

    let val = res.score;
    const stateKey = `${nextBoard.join('')}:${maximizing ? 1 : 2}`;
    if (recentSet.has(stateKey)) {
      val += maximizing ? -18 : 18;
    }

    if (maximizing) {
      if (val > best) best = val;
      if (best > alpha) alpha = best;
    } else {
      if (val < best) best = val;
      if (best < beta) beta = best;
    }
    if (beta <= alpha) break;
  }

  if (tt.size < 60000) tt.set(key, best);
  return { score: best, timedOut: false };
}

export function chooseAiMove(state, level = 'medium') {
  const { board, placed, phase, historyKeys } = state;
  const actions = getAllLegalActions(board, phase, AI_PLAYER);
  if (actions.length === 0) return null;

  const recentSet = new Set(historyKeys.slice(-8));

  const winNow = findImmediateWin(board, placed, phase, AI_PLAYER);
  if (winNow) return winNow;

  // Easy (~25%): takes wins & occasional blocks, otherwise playful legal moves
  if (level === 'easy') {
    if (Math.random() < 0.55) {
      const block = findImmediateBlock(board, placed, phase);
      if (block) return block;
    }
    const nonRepeating = actions.filter((a) => {
      const { nextBoard } = applyActionClone(board, placed, a, AI_PLAYER);
      return !recentSet.has(`${nextBoard.join('')}:1`);
    });
    const pool = nonRepeating.length ? nonRepeating : actions;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  // Medium (~50%): tactical wins, blocks, and center control
  if (level === 'medium') {
    const block = findImmediateBlock(board, placed, phase);
    if (block) return block;
    const centerAct = actions.find((a) => (a.type === 'place' ? a.node === 4 : a.to === 4));
    if (centerAct && Math.random() < 0.7) return centerAct;
    const scored = actions.map((a) => {
      const { nextBoard } = applyActionClone(board, placed, a, AI_PLAYER);
      const repPenalty = recentSet.has(`${nextBoard.join('')}:1`) ? -25 : 0;
      return { a, s: evaluateBoard(nextBoard) + repPenalty + (Math.random() * 14 - 7) };
    });
    scored.sort((x, y) => y.s - x.s);
    return scored[0].a;
  }

  // Hard (7-ply) & Impossible (up to 13-ply iterative deepening, non-blocking 320ms cap)
  const maxDepth = level === 'impossible' ? 13 : 7;
  const budgetMs = level === 'impossible' ? 320 : 180;
  const deadline = performance.now() + budgetMs;
  const ordered = orderActions(actions, board, AI_PLAYER);
  let bestAction = ordered[0];

  for (let depth = 2; depth <= maxDepth; depth++) {
    const tt = new Map();
    let iterBest = ordered[0];
    let iterBestScore = -INF;
    let timedOut = false;

    for (let i = 0; i < ordered.length; i++) {
      const act = ordered[i];
      const { nextBoard, nextPlaced, nextPhase } = applyActionClone(board, placed, act, AI_PLAYER);
      const res = minimaxSearch(
        nextBoard,
        nextPlaced,
        nextPhase,
        depth - 1,
        -INF,
        INF,
        false,
        tt,
        deadline,
        recentSet
      );
      if (res.timedOut) {
        timedOut = true;
        break;
      }
      let score = res.score;
      if (recentSet.has(`${nextBoard.join('')}:1`)) score -= 22;
      if (score > iterBestScore) {
        iterBestScore = score;
        iterBest = act;
      }
    }

    if (!timedOut) {
      bestAction = iterBest;
      if (iterBestScore >= 9000) break;
    } else {
      break;
    }
  }

  return bestAction;
}