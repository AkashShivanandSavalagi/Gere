import {
  createGameState,
  getValidTargets,
  applyPlacement,
  applyMovement,
} from './engine.js';
import { MatchClock } from './timers.js';
import { chooseAiMove } from './ai.js';
import {
  BOARD_SURFACES,
  toggleTheme,
  updateThemeButtons,
  getSavedBoard,
  saveBoard,
} from './theme.js';
import {
  showScreen,
  renderColorSwatches,
  renderBoardPicker,
  renderBoard,
  renderPlayerCards,
  renderTimers,
  startEmblemAnimation,
} from './ui.js';
import { renderQrSvgElement } from './qr.js';
import { OnlineClient } from './online.js';
import { initReviewsWidget } from './reviews.js';

const config = {
  mode: 'local', // 'local' | 'ai' | 'online'
  aiLevel: 'medium',
  timeMode: 'none',
  timeMinutes: 5,
  boardSurface: getSavedBoard(),
  p1: { name: 'P1', color: 'teal' },
  p2: { name: 'P2', color: 'terracotta' },
  onlineTimeMode: 'none',
  onlineTimeMinutes: 5,
};

let gameState = createGameState();
let matchClock = null;
let inputLocked = false;
let aiMoveHighlight = null;
let aiMoveHighlightTimer = null;
let lastTapAt = 0;
let onlineClient = null;
let onlineSnapshot = null;
let onlineTimerRaf = null;
let deferredInstallPrompt = null;

const reviews = initReviewsWidget();

// --- SERVICE WORKER & PWA INSTALL ---
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  document.getElementById('btn-install-pwa').classList.remove('hidden');
});

document.getElementById('btn-install-pwa').addEventListener('click', async () => {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  document.getElementById('btn-install-pwa').classList.add('hidden');
});

// --- SETUP PICKERS ---
function refreshSetupPickers() {
  renderColorSwatches(
    document.getElementById('swatches-p1'),
    config.p1.color,
    config.p2.color,
    (c) => {
      config.p1.color = c;
      refreshSetupPickers();
    }
  );
  renderColorSwatches(
    document.getElementById('swatches-p2'),
    config.p2.color,
    config.p1.color,
    (c) => {
      config.p2.color = c;
      refreshSetupPickers();
    }
  );
  renderColorSwatches(
    document.getElementById('swatches-ai-p1'),
    config.p1.color,
    null,
    (c) => {
      config.p1.color = c;
      config.p2.color = c === 'terracotta' ? 'indigo' : 'terracotta';
      refreshSetupPickers();
    }
  );
  renderColorSwatches(
    document.getElementById('swatches-online'),
    config.p1.color,
    null,
    (c) => {
      config.p1.color = c;
      refreshSetupPickers();
    }
  );
  renderBoardPicker(document.getElementById('local-board-picker'), config.boardSurface, (b) => {
    config.boardSurface = b;
    saveBoard(b);
    refreshSetupPickers();
  });
  renderBoardPicker(document.getElementById('ai-board-picker'), config.boardSurface, (b) => {
    config.boardSurface = b;
    saveBoard(b);
    refreshSetupPickers();
  });
}

function wirePillGroup(containerId, onSelect) {
  const el = document.getElementById(containerId);
  el.addEventListener('click', (e) => {
    const btn = e.target.closest('.pill-btn');
    if (!btn) return;
    for (const b of el.querySelectorAll('.pill-btn')) b.classList.remove('active');
    btn.classList.add('active');
    onSelect(btn.dataset.val);
  });
}

function setStatus(text) {
  document.getElementById('game-status-bar').textContent = text;
}

function openGameOver(title, subtitle) {
  document.getElementById('gameover-title').textContent = title;
  document.getElementById('gameover-subtitle').textContent = subtitle;
  document.getElementById('modal-gameover').classList.remove('hidden');
}

function closeGameOver() {
  document.getElementById('modal-gameover').classList.add('hidden');
}

// --- LOCAL & AI GAME LOOP ---
function renderCurrentGame() {
  const validTargets =
    gameState.winner === 0 && !gameState.endReason
      ? gameState.phase === 'placement'
        ? getValidTargets(gameState, null)
        : gameState.selectedNode !== null
          ? getValidTargets(gameState, gameState.selectedNode)
          : []
      : [];

  renderPlayerCards({
    p1: config.p1,
    p2: config.p2,
    turn: gameState.turn,
    placed: gameState.placed,
    moves: gameState.moves,
  });

  renderBoard({
    board: gameState.board,
    selectedNode: gameState.selectedNode,
    validTargets,
    p1Color: config.p1.color,
    p2Color: config.p2.color,
    winLine: gameState.winLine,
    aiMoveHighlight,
    onNodeClick: handleNodeClick,
  });

  if (gameState.winner !== 0) {
    const winName = gameState.winner === 1 ? config.p1.name : config.p2.name;
    setStatus(`${winName} wins!`);
  } else if (gameState.endReason === 'deadline') {
    setStatus('21-minute match deadline reached.');
  } else if (gameState.endReason === 'timeout_combined') {
    setStatus('Combined clock expired — Draw.');
  } else {
    const activeName = gameState.turn === 1 ? config.p1.name : config.p2.name;
    setStatus(
      gameState.phase === 'placement'
        ? `${activeName}: Place a pawn`
        : gameState.selectedNode !== null
          ? `${activeName}: Choose an adjacent empty node`
          : `${activeName}: Select a pawn to move`
    );
  }
}

function finishLocalMatch(reason, winnerNum) {
  if (matchClock) matchClock.stop();
  gameState.endReason = reason;
  gameState.winner = winnerNum;
  renderCurrentGame();

  if (winnerNum === 1 || winnerNum === 2) {
    const name = winnerNum === 1 ? config.p1.name : config.p2.name;
    const sub = reason === 'timeout' ? 'Victory on time' : '3 pawns aligned!';
    openGameOver(`${name} Wins`, sub);
  } else {
    const sub =
      reason === 'deadline' ? '21-minute hard deadline reached' : 'Combined clock expired';
    openGameOver('Match Ended', sub);
  }
}

function startLocalOrAiMatch() {
  stopOnlineLoops();
  closeGameOver();
  if (matchClock) matchClock.stop();
  if (aiMoveHighlightTimer !== null) clearTimeout(aiMoveHighlightTimer);
  aiMoveHighlightTimer = null;
  aiMoveHighlight = null;

  gameState = createGameState();
  inputLocked = false;
  saveBoard(config.boardSurface);

  const effectiveTimeMode = config.mode === 'ai' ? 'none' : config.timeMode;
  matchClock = new MatchClock({
    mode: effectiveTimeMode,
    minutes: config.timeMinutes,
    onTick: (snap) => renderTimers(snap),
    onExpire: (reason, winnerNum) => finishLocalMatch(reason, winnerNum),
  });

  showScreen('screen-game');
  renderTimers({
    mode: effectiveTimeMode,
    combinedMs: matchClock.combinedMs,
    p1Ms: matchClock.p1Ms,
    p2Ms: matchClock.p2Ms,
    activePlayer: 1,
  });
  renderCurrentGame();
  matchClock.start(1);
}

function triggerAiTurn() {
  if (config.mode !== 'ai' || gameState.turn !== 2 || gameState.winner !== 0 || gameState.endReason) {
    return;
  }
  if (aiMoveHighlightTimer !== null) clearTimeout(aiMoveHighlightTimer);
  aiMoveHighlightTimer = null;
  aiMoveHighlight = null;
  inputLocked = true;
  setStatus('PC is thinking...');
  setTimeout(() => {
    const act = chooseAiMove(gameState, config.aiLevel);
    if (act) {
      if (act.type === 'place') applyPlacement(gameState, act.node);
      else {
        if (applyMovement(gameState, act.from, act.to)) {
          aiMoveHighlight = { from: act.from, to: act.to };
        }
      }
    }
    if (matchClock) matchClock.setTurn(gameState.turn);
    if (gameState.winner !== 0) {
      finishLocalMatch('win', gameState.winner);
    } else {
      renderCurrentGame();
    }
    inputLocked = false;
    if (aiMoveHighlight !== null) {
      aiMoveHighlightTimer = setTimeout(() => {
        aiMoveHighlight = null;
        aiMoveHighlightTimer = null;
        renderCurrentGame();
      }, 1000);
    }
  }, 850);
}

// --- UNIFIED NODE CLICK HANDLER (WITH DEBOUNCE & TURN-LOCK) ---
function handleNodeClick(node) {
  const now = performance.now();
  if (now - lastTapAt < 110) return;
  lastTapAt = now;
  if (inputLocked) return;

  if (config.mode === 'online') {
    handleOnlineNodeClick(node);
    return;
  }

  if (gameState.winner !== 0 || gameState.endReason) return;
  if (config.mode === 'ai' && gameState.turn !== 1) return;

  let moved = false;
  if (gameState.phase === 'placement') {
    moved = applyPlacement(gameState, node);
  } else {
    if (gameState.board[node] === gameState.turn) {
      gameState.selectedNode = gameState.selectedNode === node ? null : node;
      renderCurrentGame();
      return;
    }
    if (gameState.selectedNode !== null && gameState.board[node] === 0) {
      moved = applyMovement(gameState, gameState.selectedNode, node);
    }
  }

  if (moved) {
    if (matchClock) matchClock.setTurn(gameState.turn);
    if (gameState.winner !== 0) {
      finishLocalMatch('win', gameState.winner);
    } else {
      renderCurrentGame();
      if (config.mode === 'ai' && gameState.turn === 2) {
        triggerAiTurn();
      }
    }
  }
}

// --- ONLINE MULTIPLAYER ---
function stopOnlineLoops() {
  if (onlineTimerRaf !== null) {
    cancelAnimationFrame(onlineTimerRaf);
    onlineTimerRaf = null;
  }
}

function handleOnlineNodeClick(node) {
  if (!onlineSnapshot || onlineSnapshot.status !== 'playing' || !onlineSnapshot.game) return;
  const g = onlineSnapshot.game;
  const me = onlineClient.player;
  if (g.turn !== me) return;

  if (g.phase === 'placement') {
    if (g.board[node] === 0) {
      onlineClient.sendIntent({ type: 'PLACE_PAWN', node });
    }
    return;
  }

  if (g.board[node] === me) {
    gameState.selectedNode = gameState.selectedNode === node ? null : node;
    renderOnlineState(onlineSnapshot);
    return;
  }

  if (gameState.selectedNode !== null && g.board[node] === 0) {
    const from = gameState.selectedNode;
    gameState.selectedNode = null;
    onlineClient.sendIntent({ type: 'MOVE_PAWN', from, to: node });
  }
}

function renderOnlineState(snap) {
  onlineSnapshot = snap;
  if (snap.status === 'waiting') {
    showScreen('screen-online-wait');
    document.getElementById('wait-room-code').textContent = snap.roomCode;
    const qrBox = document.getElementById('wait-qr-box');
    qrBox.textContent = '';
    const inviteUrl = `${location.origin}${location.pathname}?room=${snap.roomCode}`;
    qrBox.appendChild(renderQrSvgElement(inviteUrl, 176));
    return;
  }

  showScreen('screen-game');
  saveBoard(config.boardSurface);

  const p1 = snap.players[1] || { name: 'P1', color: 'teal', connected: true };
  const p2 = snap.players[2] || { name: 'P2', color: 'terracotta', connected: true };
  const g = snap.game;
  const me = onlineClient.player;
  const opp = me === 1 ? p2 : p1;

  renderPlayerCards({
    p1,
    p2,
    turn: g.turn,
    placed: g.placed,
    moves: g.moves,
  });

  const tempState = {
    board: g.board,
    turn: g.turn,
    phase: g.phase,
    winner: g.winner,
    endReason: g.endReason,
  };
  const validTargets =
    snap.status === 'playing' && g.turn === me
      ? g.phase === 'placement'
        ? getValidTargets(tempState, null)
        : gameState.selectedNode !== null
          ? getValidTargets(tempState, gameState.selectedNode)
          : []
      : [];

  renderBoard({
    board: g.board,
    selectedNode: gameState.selectedNode,
    validTargets,
    p1Color: p1.color,
    p2Color: p2.color,
    winLine: g.winLine,
    onNodeClick: handleNodeClick,
  });

  if (!opp.connected && snap.status === 'playing') {
    setStatus('Opponent disconnected — waiting to reconnect...');
  } else if (snap.status === 'finished') {
    stopOnlineLoops();
    if (g.winner === 1 || g.winner === 2) {
      const winnerName = g.winner === 1 ? p1.name : p2.name;
      setStatus(`${winnerName} wins!`);
      openGameOver(
        `${winnerName} Wins`,
        g.endReason === 'resign' ? 'Opponent resigned' : 'Match complete'
      );
    } else {
      setStatus('Match ended.');
      openGameOver(
        'Match Ended',
        g.endReason === 'deadline' ? '21-minute deadline reached' : 'Clock expired'
      );
    }
  } else {
    closeGameOver();
    setStatus(g.turn === me ? 'Your turn' : `${opp.name}'s turn`);
  }

  stopOnlineLoops();
  if (snap.status === 'playing' && snap.timeMode !== 'none') {
    const receivedAt = performance.now();
    const tickOnlineClock = () => {
      if (!onlineSnapshot || onlineSnapshot.status !== 'playing') return;
      const elapsed = Math.max(0, performance.now() - receivedAt);
      const combinedMs = Math.max(0, g.clocks.combined - elapsed);
      const p1Ms = g.turn === 1 ? Math.max(0, g.clocks[1] - elapsed) : g.clocks[1];
      const p2Ms = g.turn === 2 ? Math.max(0, g.clocks[2] - elapsed) : g.clocks[2];
      renderTimers({
        mode: snap.timeMode,
        combinedMs,
        p1Ms,
        p2Ms,
        activePlayer: g.turn,
      });
      onlineTimerRaf = requestAnimationFrame(tickOnlineClock);
    };
    tickOnlineClock();
  } else {
    renderTimers({ mode: 'none', combinedMs: 0, p1Ms: 0, p2Ms: 0, activePlayer: 1 });
  }
}

function initOnlineClient() {
  if (onlineClient) onlineClient.disconnect();
  onlineClient = new OnlineClient({
    onState: (snap) => renderOnlineState(snap),
    onStatus: (st) => {
      if (st === 'reconnecting') setStatus('Reconnecting...');
    },
    onError: (msg) => {
      document.getElementById('online-lobby-error').textContent = msg;
    },
  });
}

// --- EVENT WIRING ---
document.getElementById('btn-home-theme').addEventListener('click', toggleTheme);
document.getElementById('btn-game-theme').addEventListener('click', toggleTheme);

document.getElementById('btn-mode-local').addEventListener('click', () => {
  config.mode = 'local';
  refreshSetupPickers();
  showScreen('screen-local-setup');
});

document.getElementById('btn-mode-ai').addEventListener('click', () => {
  config.mode = 'ai';
  refreshSetupPickers();
  showScreen('screen-ai-setup');
});

document.getElementById('btn-mode-online').addEventListener('click', () => {
  config.mode = 'online';
  document.getElementById('online-lobby-error').textContent = '';
  refreshSetupPickers();
  showScreen('screen-online-setup');
});

document.getElementById('btn-local-back').addEventListener('click', () => showScreen('screen-home'));
document.getElementById('btn-ai-back').addEventListener('click', () => showScreen('screen-home'));
document.getElementById('btn-online-back').addEventListener('click', () => showScreen('screen-home'));

wirePillGroup('local-time-mode', (val) => {
  config.timeMode = val;
  document.getElementById('local-time-mins').classList.toggle('hidden', val === 'none');
});
wirePillGroup('local-time-mins', (val) => {
  config.timeMinutes = Number(val);
});
wirePillGroup('ai-level-group', (val) => {
  config.aiLevel = val;
});
wirePillGroup('online-time-mode', (val) => {
  config.onlineTimeMode = val;
  document.getElementById('online-time-mins').classList.toggle('hidden', val === 'none');
});
wirePillGroup('online-time-mins', (val) => {
  config.onlineTimeMinutes = Number(val);
});

document.getElementById('btn-start-local').addEventListener('click', () => {
  config.p1.name = document.getElementById('input-p1-name').value.trim() || 'P1';
  config.p2.name = document.getElementById('input-p2-name').value.trim() || 'P2';
  startLocalOrAiMatch();
});

document.getElementById('btn-start-ai').addEventListener('click', () => {
  config.p1.name = document.getElementById('input-ai-name').value.trim() || 'P1';
  const labels = { easy: 'PC (Easy)', medium: 'PC (Med)', hard: 'PC (Hard)', impossible: 'PC (Max)' };
  config.p2.name = labels[config.aiLevel] || 'PC';
  if (config.p2.color === config.p1.color) {
    config.p2.color = config.p1.color === 'terracotta' ? 'indigo' : 'terracotta';
  }
  startLocalOrAiMatch();
});

document.getElementById('btn-create-room').addEventListener('click', async () => {
  const errEl = document.getElementById('online-lobby-error');
  errEl.textContent = '';
  initOnlineClient();
  try {
    await onlineClient.createRoom({
      name: document.getElementById('input-online-name').value.trim() || 'P1',
      color: config.p1.color,
      timeMode: config.onlineTimeMode,
      timeMinutes: config.onlineTimeMinutes,
    });
  } catch (err) {
    errEl.textContent = err.message;
  }
});

document.getElementById('btn-join-room').addEventListener('click', async () => {
  const errEl = document.getElementById('online-lobby-error');
  errEl.textContent = '';
  const code = document.getElementById('input-room-code').value.trim().toUpperCase();
  if (code.length !== 6) {
    errEl.textContent = 'Enter a valid 6-character room code.';
    return;
  }
  initOnlineClient();
  try {
    await onlineClient.joinRoom({
      roomCode: code,
      name: document.getElementById('input-online-name').value.trim() || 'P2',
      color: config.p1.color,
    });
  } catch (err) {
    errEl.textContent = err.message;
  }
});

document.getElementById('btn-copy-invite').addEventListener('click', async () => {
  if (!onlineClient || !onlineClient.roomCode) return;
  const inviteUrl = `${location.origin}${location.pathname}?room=${onlineClient.roomCode}`;
  try {
    await navigator.clipboard.writeText(inviteUrl);
    document.getElementById('wait-status-text').textContent = 'Invite link copied!';
  } catch {
    document.getElementById('wait-status-text').textContent = inviteUrl;
  }
});

document.getElementById('btn-wait-cancel').addEventListener('click', () => {
  if (onlineClient) onlineClient.disconnect();
  showScreen('screen-home');
});

document.getElementById('btn-game-board').addEventListener('click', () => {
  const idx = BOARD_SURFACES.findIndex((b) => b.id === config.boardSurface);
  const next = BOARD_SURFACES[(idx + 1) % BOARD_SURFACES.length];
  config.boardSurface = next.id;
  saveBoard(next.id);
});

document.getElementById('btn-game-restart').addEventListener('click', () => {
  if (config.mode === 'online') {
    if (onlineClient) onlineClient.sendIntent({ type: 'RESIGN' });
  } else {
    startLocalOrAiMatch();
  }
});

document.getElementById('btn-game-back').addEventListener('click', () => {
  if (matchClock) matchClock.stop();
  stopOnlineLoops();
  if (onlineClient) onlineClient.disconnect();
  closeGameOver();
  showScreen('screen-home');
});

document.getElementById('btn-gameover-rematch').addEventListener('click', () => {
  if (config.mode === 'online') {
    if (onlineClient) onlineClient.sendIntent({ type: 'REMATCH' });
    setStatus('Rematch requested — waiting for opponent...');
    closeGameOver();
  } else {
    startLocalOrAiMatch();
  }
});

document.getElementById('btn-gameover-rate').addEventListener('click', () => {
  closeGameOver();
  reviews.open();
});

document.getElementById('btn-gameover-home').addEventListener('click', () => {
  if (matchClock) matchClock.stop();
  stopOnlineLoops();
  if (onlineClient) onlineClient.disconnect();
  closeGameOver();
  showScreen('screen-home');
});

document.getElementById('btn-open-rules').addEventListener('click', () => {
  document.getElementById('modal-rules').classList.remove('hidden');
});
document.getElementById('btn-close-rules').addEventListener('click', () => {
  document.getElementById('modal-rules').classList.add('hidden');
});

document.getElementById('btn-open-reviews').addEventListener('click', () => reviews.open());
document.getElementById('btn-close-reviews').addEventListener('click', () => reviews.close());

// --- BOOT SEQUENCE ---
updateThemeButtons();
saveBoard(config.boardSurface);
startEmblemAnimation();

const params = new URLSearchParams(location.search);
const inviteRoom = params.get('room');

setTimeout(() => {
  if (inviteRoom && /^[A-Z0-9]{6}$/i.test(inviteRoom)) {
    config.mode = 'online';
    document.getElementById('input-room-code').value = inviteRoom.toUpperCase();
    refreshSetupPickers();
    showScreen('screen-online-setup');
    return;
  }

  initOnlineClient();
  if (onlineClient.tryResumeSession()) {
    config.mode = 'online';
    return;
  }
  onlineClient = null;
  showScreen('screen-home');
}, 1350);