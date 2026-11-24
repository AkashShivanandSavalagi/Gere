const API_URL = "/api/reviews";
const LOCAL_CACHE_KEY = "gere_public_reviews_cache_v1";

function injectReviewStyles() {
  if (document.getElementById("gere-reviews-styles")) return;
  const style = document.createElement("style");
  style.id = "gere-reviews-styles";
  style.textContent = `
    .gr-wrap { max-width: 680px; margin: 0 auto; font-family: inherit; }
    .gr-card { background: var(--surface, #1e293b); border: 1px solid var(--border, #334155); border-radius: 14px; padding: 18px; margin-bottom: 16px; color: var(--text, #f8fafc); }
    .gr-box { border: 1px solid var(--border, #334155); border-radius: 10px; padding: 14px; margin-bottom: 14px; background: rgba(15, 23, 42, 0.35); }
    .gr-box-private { border-color: #6d28d9; background: rgba(109, 40, 217, 0.12); }
    .gr-head { display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-bottom: 6px; }
    .gr-badge { font-size: 0.72rem; font-weight: 700; padding: 2px 8px; border-radius: 999px; text-transform: uppercase; }
    .gr-badge-pub { background: rgba(56, 189, 248, 0.18); color: #38bdf8; }
    .gr-badge-priv { background: rgba(139, 92, 246, 0.25); color: #c4b5fd; }
    .gr-hint { margin: 0 0 10px; font-size: 0.85rem; opacity: 0.78; }
    .gr-label { display: block; font-weight: 600; font-size: 0.9rem; margin: 10px 0 5px; }
    .gr-input, .gr-textarea { width: 100%; box-sizing: border-box; background: rgba(15, 23, 42, 0.7); color: inherit; border: 1px solid var(--border, #334155); border-radius: 8px; padding: 9px 11px; font: inherit; resize: vertical; }
    .gr-stars { display: inline-flex; gap: 4px; margin-bottom: 6px; }
    .gr-star { background: none; border: none; font-size: 1.9rem; cursor: pointer; color: #475569; padding: 0 2px; transition: transform 0.12s ease, color 0.12s ease; }
    .gr-star:hover { transform: scale(1.15); }
    .gr-star.active { color: #facc15; }
    .gr-meta { display: flex; justify-content: space-between; font-size: 0.78rem; opacity: 0.72; margin-top: 4px; }
    .gr-btn { width: 100%; background: #38bdf8; color: #0f172a; border: none; border-radius: 10px; padding: 11px 14px; font-size: 0.98rem; font-weight: 700; cursor: pointer; }
    .gr-btn:disabled { opacity: 0.6; cursor: not-allowed; }
    .gr-status { margin-top: 10px; font-size: 0.9rem; font-weight: 600; min-height: 1.3em; }
    .gr-status.ok { color: #22c55e; }
    .gr-status.err { color: #ef4444; }
    .gr-summary { display: flex; align-items: baseline; gap: 10px; margin-bottom: 12px; }
    .gr-avg { font-size: 1.8rem; font-weight: 800; color: #facc15; }
    .gr-item { border-top: 1px solid var(--border, #334155); padding: 12px 0; }
    .gr-item:first-child { border-top: none; padding-top: 0; }
    .gr-item-top { display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-bottom: 5px; }
    .gr-item-stars { color: #facc15; letter-spacing: 2px; margin-left: 6px; }
    .gr-item-date { font-size: 0.78rem; opacity: 0.7; }
    .gr-item-text { margin: 0; white-space: pre-wrap; word-break: break-word; }
  `;
  document.head.appendChild(style);
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function formatDate(isoString) {
  try {
    return new Date(isoString).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return "";
  }
}

/**
 * Mounts the interactive review form (Public Review + Private Admin Suggestion)
 * and public reviews list into the given container element or selector.
 */
export function mountReviews(target) {
  const container = typeof target === "string" ? document.querySelector(target) : target;
  if (!container) return;

  injectReviewStyles();
  container.textContent = "";

  const wrap = el("div", "gr-wrap");
  const form = el("form", "gr-card");
  form.noValidate = true;

  // --- Section 1: Public Review ---
  const pubBox = el("div", "gr-box");
  const pubHead = el("div", "gr-head");
  pubHead.append(el("strong", "", "Public Review"), el("span", "gr-badge gr-badge-pub", "Visible to Everyone"));
  const pubHint = el("p", "gr-hint", "Your rating and review will be shown publicly. Leave your name blank to stay anonymous.");

  const ratingLabel = el("label", "gr-label", "Your Star Rating *");
  const starsWrap = el("div", "gr-stars");
  starsWrap.setAttribute("role", "radiogroup");

  let selectedRating = 0;
  const starButtons = [];
  for (let i = 1; i <= 5; i++) {
    const btn = el("button", "gr-star", "★");
    btn.type = "button";
    btn.dataset.value = String(i);
    btn.setAttribute("aria-label", `${i} star${i > 1 ? "s" : ""}`);
    starButtons.push(btn);
    starsWrap.appendChild(btn);
  }

  const nameLabel = el("label", "gr-label", "Display Name (optional)");
  const nameInput = el("input", "gr-input");
  nameInput.type = "text";
  nameInput.maxLength = 40;
  nameInput.placeholder = "Anonymous";

  const pubLabel = el("label", "gr-label", "Public Feedback *");
  const pubInput = el("textarea", "gr-textarea");
  pubInput.rows = 3;
  pubInput.maxLength = 1000;
  pubInput.required = true;
  pubInput.placeholder = "What did you enjoy about Gere?";

  const pubMeta = el("div", "gr-meta");
  const pubCount = el("span", "", "0 / 1000");
  pubMeta.append(el("span", "", "No personal info is stored or shown."), pubCount);

  pubBox.append(pubHead, pubHint, ratingLabel, starsWrap, nameLabel, nameInput, pubLabel, pubInput, pubMeta);

  // --- Section 2: Private Suggestion to Admin ---
  const privBox = el("div", "gr-box gr-box-private");
  const privHead = el("div", "gr-head");
  privHead.append(el("strong", "", "Private Suggestion to Admin"), el("span", "gr-badge gr-badge-priv", "Admin Only · Hidden"));
  const privHint = el("p", "gr-hint", "Optional. Stored privately for the admin and never displayed publicly.");

  const privLabel = el("label", "gr-label", "Private Note / Bug Report / Suggestion (optional)");
  const privInput = el("textarea", "gr-textarea");
  privInput.rows = 3;
  privInput.maxLength = 1500;
  privInput.placeholder = "Write private feedback or suggestions directly for the admin...";

  const privMeta = el("div", "gr-meta");
  const privCount = el("span", "", "Completely hidden from public view.");
  const privCountNum = el("span", "", "0 / 1500");
  privMeta.append(privCount, privCountNum);

  privBox.append(privHead, privHint, privLabel, privInput, privMeta);

  // --- Submit & Status ---
  const submitBtn = el("button", "gr-btn", "Submit Review");
  submitBtn.type = "submit";
  const statusEl = el("div", "gr-status");
  statusEl.setAttribute("role", "status");
  statusEl.setAttribute("aria-live", "polite");

  form.append(pubBox, privBox, submitBtn, statusEl);

  // --- Public Reviews Feed ---
  const feedCard = el("section", "gr-card");
  const summaryBar = el("div", "gr-summary");
  const avgEl = el("span", "gr-avg", "0.0");
  const totalEl = el("span", "", "0 reviews");
  summaryBar.append(avgEl, totalEl);
  const listEl = el("div", "", "Loading reviews...");
  feedCard.append(summaryBar, listEl);

  wrap.append(form, feedCard);
  container.appendChild(wrap);

  // --- Interactions ---
  function renderStars(upTo) {
    starButtons.forEach((btn) => {
      const val = Number(btn.dataset.value);
      btn.classList.toggle("active", val <= upTo);
      btn.setAttribute("aria-checked", String(val === selectedRating));
    });
  }

  starButtons.forEach((btn) => {
    const val = Number(btn.dataset.value);
    btn.addEventListener("mouseenter", () => renderStars(val));
    btn.addEventListener("mouseleave", () => renderStars(selectedRating));
    btn.addEventListener("click", () => {
      selectedRating = val;
      renderStars(selectedRating);
    });
  });

  pubInput.addEventListener("input", () => {
    pubCount.textContent = `${pubInput.value.length} / 1000`;
  });

  privInput.addEventListener("input", () => {
    privCountNum.textContent = `${privInput.value.length} / 1500`;
  });

  function setStatus(msg, type = "") {
    statusEl.textContent = msg;
    statusEl.className = `gr-status ${type}`.trim();
  }

  function renderPublicReviews(data) {
    const avg = Number(data?.averageRating ?? 0);
    const total = Number(data?.totalReviews ?? 0);
    const reviews = Array.isArray(data?.reviews) ? data.reviews : [];

    avgEl.textContent = avg.toFixed(1);
    totalEl.textContent = `${total} ${total === 1 ? "review" : "reviews"}`;
    listEl.textContent = "";

    if (reviews.length === 0) {
      listEl.appendChild(el("p", "gr-hint", "No public reviews yet. Be the first to rate Gere!"));
      return;
    }

    reviews.forEach((item) => {
      const article = el("article", "gr-item");
      const top = el("div", "gr-item-top");
      const left = el("div");
      const safeRating = Math.max(1, Math.min(5, Number(item.rating) || 1));

      left.append(
        el("strong", "", item.displayName || "Anonymous"),
        el("span", "gr-item-stars", "★".repeat(safeRating) + "☆".repeat(5 - safeRating))
      );

      top.append(left, el("span", "gr-item-date", formatDate(item.createdAt)));
      article.append(top, el("p", "gr-item-text", item.publicComment || ""));
      listEl.appendChild(article);
    });
  }

  async function loadReviews() {
    try {
      const res = await fetch(API_URL, { headers: { Accept: "application/json" } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      try {
        localStorage.setItem(LOCAL_CACHE_KEY, JSON.stringify(data));
      } catch {
        // Ignore storage quota or private-mode restrictions
      }
      renderPublicReviews(data);
    } catch {
      try {
        const cached = localStorage.getItem(LOCAL_CACHE_KEY);
        if (cached) {
          renderPublicReviews(JSON.parse(cached));
          return;
        }
      } catch {
        try {
          localStorage.removeItem(LOCAL_CACHE_KEY);
        } catch {
          // Ignore
        }
      }
      listEl.textContent = "Unable to load reviews right now.";
    }
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    if (selectedRating < 1 || selectedRating > 5) {
      setStatus("Please select a star rating (1 to 5).", "err");
      return;
    }

    const publicComment = pubInput.value.trim();
    if (publicComment.length < 3) {
      setStatus("Public review must be at least 3 characters.", "err");
      return;
    }

    submitBtn.disabled = true;
    setStatus("Submitting...");

    try {
      const res = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rating: selectedRating,
          displayName: nameInput.value.trim(),
          publicComment,
          privateSuggestion: privInput.value.trim(),
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setStatus(data.error || "Failed to submit review.", "err");
        return;
      }

      const privMsg = data.privateSuggestionReceived
        ? " Your private suggestion was sent securely to the admin."
        : "";
      setStatus(`Thank you! Your public review is live.${privMsg}`, "ok");

      form.reset();
      selectedRating = 0;
      renderStars(0);
      pubCount.textContent = "0 / 1000";
      privCountNum.textContent = "0 / 1500";
      await loadReviews();
    } catch {
      setStatus("Network error. Please try again when online.", "err");
    } finally {
      submitBtn.disabled = false;
    }
  });

  loadReviews();
}
