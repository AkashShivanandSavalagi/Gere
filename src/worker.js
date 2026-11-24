export { GereRoom } from "./room-do.js";
export { GereReviews } from "./reviews-do.js";

function timingSafeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const enc = new TextEncoder();
  const bufA = enc.encode(a);
  const bufB = enc.encode(b);
  if (bufA.length !== bufB.length) return false;
  let diff = 0;
  for (let i = 0; i < bufA.length; i++) {
    diff |= bufA[i] ^ bufB[i];
  }
  return diff === 0;
}

// Inside your default export's async fetch(request, env, ctx):
async function handleReviewRoutes(request, env) {
  const url = new URL(request.url);

  // Public reviews API: GET /api/reviews and POST /api/reviews
  if (url.pathname === "/api/reviews" && (request.method === "GET" || request.method === "POST")) {
    const id = env.GERE_REVIEWS.idFromName("global");
    const stub = env.GERE_REVIEWS.get(id);
    const forwardUrl = new URL("/public", request.url);
    return stub.fetch(new Request(forwardUrl, request));
  }

  // Admin-only private suggestions API: GET /api/admin/suggestions
  if (url.pathname === "/api/admin/suggestions" && request.method === "GET") {
    const authHeader = request.headers.get("Authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";

    if (!env.ADMIN_SECRET || !timingSafeEqual(token, env.ADMIN_SECRET)) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json; charset=utf-8" },
      });
    }

    const id = env.GERE_REVIEWS.idFromName("global");
    const stub = env.GERE_REVIEWS.get(id);
    const forwardUrl = new URL("/admin/suggestions", request.url);
    return stub.fetch(new Request(forwardUrl, { method: "GET" }));
  }

  return null;
}
