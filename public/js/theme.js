export const BOARD_SURFACES = [
  { id: 'parchment', label: 'Parchment' },
  { id: 'walnut', label: 'Walnut' },
  { id: 'slate', label: 'Slate Navy' },
  { id: 'sage', label: 'Sage Stone' },
  { id: 'forest', label: 'Forest' },
  { id: 'obsidian', label: 'Obsidian Mist' },
];

export const PAWN_COLORS = [
  { id: 'teal', label: 'Teal' },
  { id: 'terracotta', label: 'Terracotta' },
  { id: 'indigo', label: 'Indigo' },
  { id: 'crimson', label: 'Crimson' },
  { id: 'emerald', label: 'Emerald' },
  { id: 'slate', label: 'Slate' },
  { id: 'plum', label: 'Plum' },
  { id: 'ochre', label: 'Ochre' },
];

export function getTheme() {
  return document.documentElement.getAttribute('data-theme') || 'light';
}

export function setTheme(theme) {
  const next = theme === 'dark' ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', next);
  try {
    localStorage.setItem('gere_theme', next);
  } catch {
    // ignore storage restrictions
  }
  updateThemeButtons(next);
}

export function toggleTheme() {
  setTheme(getTheme() === 'dark' ? 'light' : 'dark');
}

export function updateThemeButtons(theme = getTheme()) {
  const glyph = theme === 'dark' ? '☀' : '☾';
  for (const id of ['btn-home-theme', 'btn-game-theme']) {
    const btn = document.getElementById(id);
    if (btn) btn.textContent = glyph;
  }
}

export function getSavedBoard() {
  try {
    const saved = localStorage.getItem('gere_board');
    if (BOARD_SURFACES.some((b) => b.id === saved)) return saved;
  } catch {
    // ignore
  }
  return 'parchment';
}

export function saveBoard(surfaceId) {
  if (!BOARD_SURFACES.some((b) => b.id === surfaceId)) return;
  try {
    localStorage.setItem('gere_board', surfaceId);
  } catch {
    // ignore
  }
  const frame = document.getElementById('board-frame');
  if (frame) frame.setAttribute('data-board', surfaceId);
}