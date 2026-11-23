(function () {
  try {
    const saved = localStorage.getItem('gere_theme');
    const prefersDark =
      window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    const theme = saved === 'dark' || saved === 'light' ? saved : prefersDark ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', theme);
  } catch {
    document.documentElement.setAttribute('data-theme', 'light');
  }
})();