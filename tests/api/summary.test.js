const test = require('node:test'); const assert = require('node:assert');
const handler = require('../../api/summary.js');
const res = () => ({ h: {}, setHeader(k, v) { this.h[k] = v; }, end(b) { this.body = JSON.parse(b); } });
const call = async (req) => { const r = res(); await handler(req, r); return r; };
const post = (token, body) => ({ method: 'POST', headers: token ? { authorization: 'Bearer ' + token } : {}, body: body || { round: { grossScore: 85 } } });
let mode = 'ok', sent = null;
global.fetch = async (url, o) => {
  url = String(url);
  if (url.includes('supabase.co')) return new Response(JSON.stringify(mode === 'limit' ? 11 : 1), { status: o.headers.Authorization === 'Bearer good' ? 200 : 401, headers: { 'content-type': 'application/json' } });
  sent = JSON.parse(o.body);
  return new Response(JSON.stringify({ id: 'm', type: 'message', role: 'assistant', model: 'claude-opus-5', stop_reason: mode === 'refuse' ? 'refusal' : 'end_turn', content: mode === 'refuse' ? [] : [{ type: 'text', text: 'Nice round.' }], usage: { input_tokens: 1, output_tokens: 1 } }), { status: 200, headers: { 'content-type': 'application/json' } });
};

test('guards: method, key, sign-in, quota, size', async () => {
  assert.equal((await call({ method: 'GET', headers: {} })).statusCode, 405);
  delete process.env.ANTHROPIC_API_KEY; assert.equal((await call(post('good'))).statusCode, 501);
  process.env.ANTHROPIC_API_KEY = 'sk-test';
  assert.equal((await call(post(null))).statusCode, 401);
  assert.equal((await call(post('bad'))).statusCode, 401);
  mode = 'limit'; assert.equal((await call(post('good'))).statusCode, 429); mode = 'ok';
  assert.equal((await call(post('good', { round: { x: 'a'.repeat(30000) } }))).statusCode, 400);
});
test('calls Claude and returns the summary; handles refusals', async () => {
  const ok = await call(post('good')); assert.equal(ok.statusCode, 200); assert.equal(ok.body.summary, 'Nice round.');
  assert.equal(sent.model, 'claude-opus-5'); assert.equal(sent.fallbacks, 'default'); assert.deepEqual(sent.output_config, { effort: 'low' });
  mode = 'refuse'; assert.equal((await call(post('good'))).statusCode, 422); mode = 'ok';
});
