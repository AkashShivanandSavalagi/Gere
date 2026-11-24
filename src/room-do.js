import { DurableObject } from "cloudflare:workers";

const MAX_NAME_LEN = 40;
const MAX_PUBLIC_LEN = 1000;
const MAX_PRIVATE_LEN = 1500;
const PUBLIC_PAGE_LIMIT = 50;

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function cleanText(value, maxLen) {
  if (typeof value !== "string") return "";
  return value.replace(/\r\n/g, "\n").trim().slice(0, maxLen);
}

export class GereReviews extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.#initSchema();
  }

  #initSchema() {
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS public_reviews (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        display_name TEXT NOT NULL,
        rating INTEGER NOT NULL CHECK(rating >= 1 AND rating <= 5),
        public_comment TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS admin_suggestions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        review_id INTEGER,
        suggestion TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
  }

  async fetch(request) {
    const url = new URL(request.url);

    // Public: List reviews + aggregate stats (NEVER touches admin_suggestions)
    if (request.method === "GET" && url.pathname === "/public") {
      return this.#handleGetPublicReviews();
    }

    // Public: Submit a review + optional private admin suggestion
    if (request.method === "POST" && url.pathname === "/public") {
      return this.#handleCreateReview(request);
    }

    // Admin-only: Read private suggestions (auth enforced in worker.js)
    if (request.method === "GET" && url.pathname === "/admin/suggestions") {
      return this.#handleGetAdminSuggestions();
    }

    return jsonResponse({ error: "Not found" }, 404);
  }

  #handleGetPublicReviews() {
    const statsRow = this.sql
      .exec(`
        SELECT
          COUNT(*) AS total_reviews,
          ROUND(AVG(rating), 2) AS average_rating
        FROM public_reviews
      `)
      .one();

    const rows = this.sql
      .exec(
        `
        SELECT id, display_name, rating, public_comment, created_at
        FROM public_reviews
        ORDER BY id DESC
        LIMIT ?
        `,
        PUBLIC_PAGE_LIMIT
      )
      .toArray();

    return jsonResponse({
      totalReviews: Number(statsRow?.total_reviews ?? 0),
      averageRating: Number(statsRow?.average_rating ?? 0),
      reviews: rows.map((r) => ({
        id: r.id,
        displayName: r.display_name,
        rating: r.rating,
        publicComment: r.public_comment,
        createdAt: r.created_at,
      })),
    });
  }

  async #handleCreateReview(request) {
    let body;
    try {
      body = await request.json();
    } catch {
      return jsonResponse({ error: "Invalid JSON payload." }, 400);
    }

    const rating = Number(body?.rating);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      return jsonResponse({ error: "Rating must be a whole number from 1 to 5." }, 400);
    }

    const displayName = cleanText(body?.displayName, MAX_NAME_LEN) || "Anonymous";
    const publicComment = cleanText(body?.publicComment, MAX_PUBLIC_LEN);
    const privateSuggestion = cleanText(body?.privateSuggestion, MAX_PRIVATE_LEN);

    if (publicComment.length < 3) {
      return jsonResponse(
        { error: "Public review must be at least 3 characters long." },
        400
      );
    }

    const createdAt = new Date().toISOString();

    // 1. Save public review
    const inserted = this.sql
      .exec(
        `
        INSERT INTO public_reviews (display_name, rating, public_comment, created_at)
        VALUES (?, ?, ?, ?)
        RETURNING id
        `,
        displayName,
        rating,
        publicComment,
        createdAt
      )
      .one();

    // 2. Save private suggestion separately if provided
    let privateSaved = false;
    if (privateSuggestion.length > 0) {
      this.sql.exec(
        `
        INSERT INTO admin_suggestions (review_id, suggestion, created_at)
        VALUES (?, ?, ?)
        `,
        inserted.id,
        privateSuggestion,
        createdAt
      );
      privateSaved = true;
    }

    return jsonResponse(
      {
        ok: true,
        review: {
          id: inserted.id,
          displayName,
          rating,
          publicComment,
          createdAt,
        },
        privateSuggestionReceived: privateSaved,
      },
      201
    );
  }

  #handleGetAdminSuggestions() {
    const rows = this.sql
      .exec(`
        SELECT id, review_id, suggestion, created_at
        FROM admin_suggestions
        ORDER BY id DESC
        LIMIT 200
      `)
      .toArray();

    return jsonResponse({
      totalSuggestions: rows.length,
      suggestions: rows.map((r) => ({
        id: r.id,
        reviewId: r.review_id,
        suggestion: r.suggestion,
        createdAt: r.created_at,
      })),
    });
  }
}
