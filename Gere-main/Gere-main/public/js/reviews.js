const VERDICTS = {
  1: 'First Move',
  2: 'Opening',
  3: 'Tactician',
  4: 'Master',
  5: 'Grandmaster',
};

const VIBES_HIGH = ['Clean', 'Strategic', 'Classic', 'Premium', 'Smooth', 'Challenging'];
const VIBES_LOW = ['Clean', 'Needs Polish', 'Too Fast', 'Challenging'];
const LOCAL_KEY = 'gere_offline_reviews';

export function initReviewsWidget() {
  const modal = document.getElementById('modal-reviews');
  const starsRow = document.getElementById('stars-row');
  const verdictEl = document.getElementById('review-verdict');
  const vibesEl = document.getElementById('review-vibes');
  const nameInput = document.getElementById('review-name');
  const commentInput = document.getElementById('review-comment');
  const counterEl = document.getElementById('review-counter');
  const summaryEl = document.getElementById('reviews-summary');
  const listEl = document.getElementById('reviews-list');
  const submitBtn = document.getElementById('btn-submit-review');

  let rating = 5;
  const selectedVibes = new Set();

  function renderStars() {
    starsRow.textContent = '';
    for (let i = 1; i <= 5; i++) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `star-btn${i <= rating ? ' active' : ''}`;
      btn.textContent = i <= rating ? '★' : '☆';
      btn.setAttribute('aria-label', `${i} star`);
      btn.addEventListener('click', () => {
        rating = i;
        selectedVibes.clear();
        renderStars();
        renderVibes();
      });
      starsRow.appendChild(btn);
    }
    verdictEl.textContent = VERDICTS[rating] || '';
  }

  function renderVibes() {
    vibesEl.textContent = '';
    const pool = rating >= 4 ? VIBES_HIGH : VIBES_LOW;
    for (const v of pool) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `pill-btn${selectedVibes.has(v) ? ' active' : ''}`;
      btn.textContent = v;
      btn.addEventListener('click', () => {
        if (selectedVibes.has(v)) selectedVibes.delete(v);
        else if (selectedVibes.size < 4) selectedVibes.add(v);
        renderVibes();
      });
      vibesEl.appendChild(btn);
    }
  }

  function renderList(data) {
    summaryEl.textContent =
      data.count > 0
        ? `Average ${data.average} ★ (${data.count} ${data.count === 1 ? 'review' : 'reviews'})`
        : 'Be the first to rate Gere';
    listEl.textContent = '';
    for (const item of (data.reviews || []).slice(0, 6)) {
      const card = document.createElement('div');
      card.className = 'review-item';

      const head = document.createElement('strong');
      head.textContent = `${item.name || 'Player'} · ${'★'.repeat(item.rating)}`;
      card.appendChild(head);

      if (item.vibes && item.vibes.length) {
        const vibeLine = document.createElement('span');
        vibeLine.className = 'mode-card-desc';
        vibeLine.textContent = item.vibes.join(' · ');
        card.appendChild(vibeLine);
      }

      if (item.comment) {
        const body = document.createElement('span');
        body.textContent = item.comment;
        card.appendChild(body);
      }
      listEl.appendChild(card);
    }
  }

  function loadLocalFallback() {
    try {
      const raw = JSON.parse(localStorage.getItem(LOCAL_KEY) || '[]');
      const sum = raw.reduce((acc, r) => acc + r.rating, 0);
      return {
        count: raw.length,
        average: raw.length ? Number((sum / raw.length).toFixed(2)) : 0,
        reviews: raw,
      };
    } catch {
      return { count: 0, average: 0, reviews: [] };
    }
  }

  async function fetchReviews() {
    try {
      const res = await fetch('/api/reviews');
      if (!res.ok) throw new Error('OFFLINE');
      const data = await res.json();
      renderList(data);
    } catch {
      renderList(loadLocalFallback());
    }
  }

  commentInput.addEventListener('input', () => {
    counterEl.textContent = `${commentInput.value.length}/300`;
  });

  submitBtn.addEventListener('click', async () => {
    const payload = {
      rating,
      name: nameInput.value.trim(),
      comment: commentInput.value.trim(),
      vibes: Array.from(selectedVibes),
    };
    submitBtn.disabled = true;
    try {
      const res = await fetch('/api/reviews', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error('OFFLINE');
      const data = await res.json();
      renderList(data);
    } catch {
      const local = loadLocalFallback();
      local.reviews.unshift({ ...payload, name: payload.name || 'Player', createdAt: Date.now() });
      try {
        localStorage.setItem(LOCAL_KEY, JSON.stringify(local.reviews.slice(0, 20)));
      } catch {
        // ignore
      }
      renderList(loadLocalFallback());
    } finally {
      submitBtn.disabled = false;
      commentInput.value = '';
      counterEl.textContent = '0/300';
      selectedVibes.clear();
      renderVibes();
    }
  });

  renderStars();
  renderVibes();

  return {
    open() {
      modal.classList.remove('hidden');
      fetchReviews();
    },
    close() {
      modal.classList.add('hidden');
    },
  };
}