// Cloudflare Worker 版のボス音声(Node版 tts.js と同じ方式を fetch/Streams で実装)。キャッシュは KV(TTS_CACHE)
import { Buffer } from 'node:buffer';
import crypto from 'node:crypto';
import VOICES from '../voices.js';

const env_ = () => process.env;
const OPENAI_MODEL = () => env_().TTS_MODEL || 'gpt-4o-mini-tts';
const GEMINI_MODEL = () => env_().GEMINI_TTS_MODEL || 'gemini-3.8-flash-tts';
const GEMINI_FALLBACK_MODEL = () => env_().GEMINI_TTS_FALLBACK_MODEL || 'gemini-3.8-flash-lite-tts';
const hasGemini = () => !!env_().GEMINI_API_KEY;
const hasOpenAI = () => !!env_().OPENAI_API_KEY;
export const PROVIDER = () => {
  const p = (env_().TTS_PROVIDER || '').toLowerCase();
  if (p === 'openai' && hasOpenAI()) return 'openai';
  if (p === 'gemini' && hasGemini()) return 'gemini';
  return hasGemini() ? 'gemini' : 'openai';
};
export const enabled = () => (hasGemini() || hasOpenAI()) && env_().TTS !== 'off';
export const playbackRate = () => (PROVIDER() === 'gemini' ? Math.min(1.5, Math.max(0.8, +(env_().TTS_PLAYBACK_RATE || 1.1))) : 1);
export const modelName = () => (PROVIDER() === 'gemini' ? GEMINI_MODEL() : OPENAI_MODEL());

function retryAfterSec(msg) {
  const m = String(msg).match(/retry in ((?:\d+h)?(?:\d+m(?!s))?(?:[\d.]+s)?)/i);
  if (!m || !m[1]) return 60;
  const p = (u) => { const x = m[1].match(new RegExp('([\\d.]+)' + u)); return x ? +x[1] : 0; };
  return Math.max(5, Math.ceil(p('h') * 3600 + p('m(?!s)') * 60 + p('s')));
}
const cooldown = new Map();
function clean(text) {
  return String(text || '').replace(/[（(][^）)]{0,80}[）)]/g, '').replace(/[「」『』]/g, '').replace(/[<>]/g, '')
    .replace(/…+|\.{3,}/g, '…').replace(/\n+/g, ' ').trim().slice(0, 1000);
}
const hash = (parts) => crypto.createHash('sha256').update(parts.join('\u0000')).digest('hex').slice(0, 32);
const RATE = 24000;
function wavHeader(dataLen) {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(Math.min(0xffffffff, 36 + dataLen), 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(RATE, 24); h.writeUInt32LE(RATE * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(Math.min(0xffffffff - 36, dataLen), 40);
  return h;
}
const WAV_HEAD = { 'content-type': 'audio/wav', 'cache-control': 'private, max-age=86400' };
const MP3_HEAD = { 'content-type': 'audio/mpeg', 'cache-control': 'private, max-age=86400' };
const TTL = 30 * 24 * 3600;

async function cacheGet(env, key) {
  if (!env.TTS_CACHE) return null;
  const v = await env.TTS_CACHE.get(key, { type: 'arrayBuffer' });
  return v;
}
async function cachePut(env, key, buf) {
  if (!env.TTS_CACHE) return;
  try { await env.TTS_CACHE.put(key, buf, { expirationTtl: TTL }); } catch (e) { console.error('[tts cache put]', e.message); }
}

// ───── OpenAI(mp3)
const PAD = '……';
async function openaiSpeech(env, ctx, stageId, text) {
  const v = VOICES[stageId] || VOICES.bucho;
  const speed = +(v.speed / playbackRate()).toFixed(2);
  const key = 'o:' + hash(['v2', OPENAI_MODEL(), v.voice, speed, v.instructions, text]);
  const hit = await cacheGet(env, key);
  if (hit) return new Response(hit, { headers: { ...MP3_HEAD, 'x-tts': 'openai;cache=hit' } });
  const r = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: { authorization: `Bearer ${env_().OPENAI_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model: OPENAI_MODEL(), voice: v.voice, input: text + PAD, instructions: v.instructions + ' 最後の一文まで省略せずに読み切ること。', speed, response_format: 'mp3' }),
  });
  if (!r.ok) throw new Error(`openai tts ${r.status} ${(await r.text()).slice(0, 200)}`);
  const buf = await r.arrayBuffer();
  ctx.waitUntil(cachePut(env, key, buf));
  return new Response(buf, { headers: { ...MP3_HEAD, 'x-tts': 'openai;cache=miss' } });
}

// ───── Gemini(SSE の生PCM → WAV)。stream=true は最初の音が届いた時点から流す
function geminiKey(stageId, text, expr) {
  const v = (VOICES.GEMINI || {})[stageId] || { voice: 'Charon', style: '早口で' };
  const style = [v.style, (VOICES.EXPR_STYLE || {})[expr]].filter(Boolean).join('、');
  return { v, style, key: 'g:' + hash(['g1', v.voice, style, text]) };
}
async function geminiSpeech(env, ctx, { v, style, key }, text, stream, MODEL) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 9000);
  let r;
  try {
    r = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
      method: 'POST', signal: ac.signal,
      headers: { 'x-goog-api-key': env_().GEMINI_API_KEY, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: MODEL, stream: true,
        input: [{ type: 'user_input', content: [{ type: 'text', text, annotations: [{ type: 'speech_metadata', style }] }] }],
        response_format: { type: 'audio' },
        generation_config: { speech_config: [{ voice: v.voice }] },
      }),
    });
  } catch (e) { clearTimeout(timer); throw e; }
  if (!r.ok) {
    clearTimeout(timer);
    const msg = (await r.text()).slice(0, 300);
    if (r.status === 429) cooldown.set(MODEL, Date.now() + retryAfterSec(msg) * 1000);
    else if (r.status === 401 || r.status === 403 || /API key/i.test(msg)) cooldown.set(MODEL, Date.now() + 600e3);
    throw new Error(`gemini tts ${MODEL} ${r.status} ${msg.slice(0, 160)}`);
  }
  async function* pcmChunks() {
    const reader = r.body.getReader(); const dec = new TextDecoder();
    let sse = '', carry = null;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      sse += dec.decode(value, { stream: true });
      let i;
      while ((i = sse.indexOf('\n\n')) >= 0) {
        const ev = sse.slice(0, i); sse = sse.slice(i + 2);
        for (const line of ev.split('\n')) {
          if (!line.startsWith('data:')) continue;
          let j; try { j = JSON.parse(line.slice(5)); } catch { continue; }
          if (j.error) throw new Error('gemini tts stream error ' + JSON.stringify(j.error).slice(0, 200));
          if (j.event_type === 'step.delta' && j.delta && j.delta.type === 'audio' && j.delta.data) {
            let b = Buffer.from(j.delta.data, 'base64');
            if (carry) { b = Buffer.concat([carry, b]); carry = null; }
            if (b.length % 2) { carry = b.subarray(b.length - 1); b = b.subarray(0, b.length - 1); }
            if (b.length) yield b;
          }
        }
      }
    }
  }
  const it = pcmChunks();
  let first;
  try { first = await it.next(); } finally { clearTimeout(timer); }
  if (first.done) throw new Error('gemini tts: no audio');
  const all = [first.value];
  if (stream) {
    const { readable, writable } = new TransformStream();
    const w = writable.getWriter();
    ctx.waitUntil((async () => {
      let ok = true;
      try {
        await w.write(wavHeader(0xffffffff - 44)); await w.write(first.value);
        for (;;) { const n = await it.next(); if (n.done) break; all.push(n.value); await w.write(n.value); }
      } catch (e) { ok = false; console.error('[tts gemini] stream broke after start:', e.message); }
      try { await w.close(); } catch { /* client gone */ }
      if (ok) { const total = all.reduce((a, b) => a + b.length, 0); await cachePut(env, key, Buffer.concat([wavHeader(total), ...all])); }
    })());
    return new Response(readable, { headers: { ...WAV_HEAD, 'x-tts': 'gemini;cache=miss;stream' } });
  }
  for (;;) { const n = await it.next(); if (n.done) break; all.push(n.value); }
  const total = all.reduce((a, b) => a + b.length, 0);
  const wav = Buffer.concat([wavHeader(total), ...all]);
  ctx.waitUntil(cachePut(env, key, wav));
  return new Response(wav, { headers: { ...WAV_HEAD, 'x-tts': 'gemini;cache=miss', 'content-length': String(wav.length) } });
}

const fail = () => new Response(JSON.stringify({ error: 'tts failed' }), { status: 502, headers: { 'content-type': 'application/json' } });
export async function speech(env, ctx, stageId, rawText, { expr, stream } = {}) {
  const text = clean(rawText);
  if (!text) return new Response(null, { status: 204 });
  if (PROVIDER() === 'gemini') {
    const k = geminiKey(stageId, text, expr);
    const hit = await cacheGet(env, k.key);
    if (hit) return new Response(hit, { headers: { ...WAV_HEAD, 'x-tts': 'gemini;cache=hit', 'content-length': String(hit.byteLength) } });
    for (const model of [GEMINI_MODEL(), GEMINI_FALLBACK_MODEL()].filter((m, i, a) => m && a.indexOf(m) === i)) {
      if ((cooldown.get(model) || 0) > Date.now()) continue;
      try { return await geminiSpeech(env, ctx, k, text, stream, model); }
      catch (e) { console.error('[tts gemini fallback]', e.message); }
    }
    if (!hasOpenAI()) return fail();
  }
  try { return await openaiSpeech(env, ctx, stageId, text); }
  catch (e) { console.error('[tts error]', e.message); return fail(); }
}
