import { DurableObject } from 'cloudflare:workers';

const MAX_REVIEWS = 50;
const ALLOWED_VIBES = new Set([
  'Clean',
  'Strategic',
  'Classic',
  'Premium',
  'Smooth',
  'Challenging',
  'Needs Polish',
  'Too Fast',
]);

function jsonResp(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

function cleanText(str, maxLen) {
  if (typeof str !== 'string') return '';
  return str.replace(/[\x00-\x1F\x7F]/g, '').trim().slice(0, maxLen);
}

export class GereReviews extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx = ctx;
  }

  async loadData() {
    const data = await this.ctx.storage.get('reviews_data');
    return data || { count: 0, sum: 0, items: [] };
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === '/list' && request.method === 'GET') {
      const data = await this.loadData();
      const average = data.count > 0 ? Number((data.sum / data.count).toFixed(2)) : 0;
      return jsonResp({
        average,
        count: data.count,
        reviews: data.items.slice(0, 20),
      });
    }

    if (url.pathname === '/add' && request.method === 'POST') {
      let body;
      try {
        body = await request.json();
      } catch {
        return jsonResp({ error: 'INVALID_JSON' }, 400);
      }

      const rating = Number(body.rating);
      if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
        return jsonResp({ error: 'INVALID_RATING' }, 400);
      }

      const name = cleanText(body.name, 24) || 'Player';
      const comment = cleanText(body.comment, 300);
      const vibes = Array.isArray(body.vibes)
        ? body.vibes.filter((v) => typeof v === 'string' && ALLOWED_VIBES.has(v)).slice(0, 4)
        : [];

      const data = await this.loadData();
      const entry = {
        id: crypto.randomUUID(),
        rating,
        name,
        comment,
        vibes,
        createdAt: Date.now(),
      };

      data.count += 1;
      data.sum += rating;
      data.items.unshift(entry);
      if (data.items.length > MAX_REVIEWS) {
        data.items.length = MAX_REVIEWS;
      }

      await this.ctx.storage.put('reviews_data', data);
      const average = Number((data.sum / data.count).toFixed(2));
      return jsonResp(
        {
          average,
          count: data.count,
          reviews: data.items.slice(0, 20),
        },
        201
      );
    }

    return jsonResp({ error: 'NOT_FOUND' }, 404);
  }
}