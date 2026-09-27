/* Post-round AI summary. POST /api/summary with the round and player context (JSON) and the
   player's Supabase access token as "Authorization: Bearer <token>". Returns { summary }.
   Needs ANTHROPIC_API_KEY in the Vercel project. Signed-in users only, capped per day. */

const Anthropic = require('@anthropic-ai/sdk').default;

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://kbudyxkbrpjweoeuoxmk.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_AIwcj1B58bJLL5rR3ebYMg_C0e_wZ5_';
const DAILY_LIMIT = 10;
const MAX_BODY = 24 * 1024;

const SYSTEM = `You are a friendly, expert golf coach writing a short debrief for an amateur golfer right after their round.
Write 4 short paragraphs, 130 words at most, in plain text (no headings, no bullet points, no markdown).
1. One sentence on how the round went overall, relative to their handicap.
2. Where the strokes went, using the actual numbers you were given (putts, greens, fairways, penalties, doubles, scrambling, specific holes) compared with the benchmark for their target handicap.
3. One genuine positive from the round.
4. This week's practice: recommend exactly two drills, using the exact drill names from the list provided, and say why each one fits.
Be specific and encouraging. Never invent numbers or drills that are not in the data.`;

function json(res, status, body) { res.statusCode = status; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(body)); }

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  let raw = '';
  for await (const chunk of req) { raw += chunk; if (raw.length > MAX_BODY) throw Object.assign(new Error('too large'), { status: 413 }); }
  return JSON.parse(raw || '{}');
}

/* Counts one summary for the caller and returns today's total. Also proves the token is valid. */
async function takeQuota(token) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/golf_ai_take_quota`, {
    method: 'POST', headers: { apikey: SUPABASE_KEY, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: '{}',
  });
  if (r.status === 401 || r.status === 403) return null;
  if (!r.ok) throw new Error('quota check failed: ' + r.status);
  return r.json();
}

async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'method_not_allowed' });
  if (!process.env.ANTHROPIC_API_KEY) return json(res, 501, { error: 'not_configured' });
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return json(res, 401, { error: 'sign_in_required' });

  let body;
  try { body = await readBody(req); } catch (e) { return json(res, e.status || 400, { error: 'bad_request' }); }
  if (!body || !body.round || JSON.stringify(body).length > MAX_BODY) return json(res, 400, { error: 'bad_request' });

  let used;
  try { used = await takeQuota(token); } catch (e) { return json(res, 502, { error: 'quota_unavailable' }); }
  if (used == null) return json(res, 401, { error: 'sign_in_required' });
  if (used > DAILY_LIMIT) return json(res, 429, { error: 'daily_limit', limit: DAILY_LIMIT });

  const client = new Anthropic();
  try {
    const response = await client.beta.messages.create({
      model: 'claude-opus-5',
      max_tokens: 16000,
      output_config: { effort: 'low' },
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: SYSTEM,
      messages: [{ role: 'user', content: 'Here is the round and the player context as JSON:\n\n' + JSON.stringify(body) }],
    });
    if (response.stop_reason === 'refusal') return json(res, 422, { error: 'refused' });
    const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
    if (!text) return json(res, 502, { error: 'empty' });
    res.setHeader('Cache-Control', 'no-store');
    return json(res, 200, { summary: text, remaining: Math.max(0, DAILY_LIMIT - used) });
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) return json(res, 429, { error: 'busy' });
    if (e instanceof Anthropic.AuthenticationError) return json(res, 501, { error: 'not_configured' });
    if (e instanceof Anthropic.APIError) return json(res, 502, { error: 'upstream_error' });
    return json(res, 500, { error: 'server_error' });
  }
}

module.exports = handler;
