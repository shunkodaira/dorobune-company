// 泥舟カンパニー — Cloudflare Worker 版(公開用)
// ・静的ファイル: Workers Static Assets(public/)
// ・API: Node版 server.js と同じルート。ゲームロジック(game/llm/fatal/turn/memory-core)は共有
// ・状態: 対戦ごとに GameDO、プレイヤーの記憶は PlayerDO、IPごとのレート制限は LimitDO(すべて SQLite バックの Durable Object)
// ・音声キャッシュ: KV(TTS_CACHE)
import { DurableObject } from 'cloudflare:workers';
import G from '../game.js';
import LLM from '../llm.js';
import TURN from '../turn.js';
import MC from '../memory-core.js';
import CFG from '../config.js';
import SECRET from '../secret.js';
import * as TTS from './tts.js';

// ───── 公開用の乱用対策(APIクレジット保護)
const LIMITS = {
  textMax: 400,          // 1発言の最大文字数(超過分は切り捨て)
  turnsPerGame: 40,      // 1戦あたりの最大ターン
  bodyMax: 20000,        // リクエストボディ上限(バイト)
  ip: {                  // [回数, 秒] / IP
    new: [20, 3600],     // 新しい対戦: 20回/時
    turn: [15, 60],      // 発言: 15回/分
    tts: [40, 60],       // 音声: 40回/分
    hint: [10, 60],
    ladder: [60, 60],
    reset: [5, 60],
  },
  globalPerDay: { new: 600, turn: 6000, tts: 6000, hint: 1500 }, // 全体の1日上限(UTC日付ごと)
};

const UUID = /^[0-9a-f-]{36}$/;
const json = (code, obj, extra = {}) => new Response(JSON.stringify(obj), { status: code, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra } });

let booted = false;
function boot(env) {
  if (booted) return;
  for (const k of ['OPENAI_API_KEY', 'GEMINI_API_KEY', 'RANK_SECRET', 'LLM_PROVIDER', 'OPENAI_MODEL', 'TTS_PROVIDER', 'TTS_PLAYBACK_RATE', 'GEMINI_TTS_MODEL', 'GEMINI_TTS_FALLBACK_MODEL', 'TTS_MODEL', 'TTS'])
    if (env[k] != null && process.env[k] == null) process.env[k] = String(env[k]);
  if (!env.RANK_SECRET) throw new Error('RANK_SECRET is not set');
  SECRET.set(env.RANK_SECRET);
  booted = true;
}

// 対戦の保存形式(Node版 server.js の saveGames と同じ)
const ser = (g) => { const { stage, weakness, busy, hintBusy, ...rest } = g; return { ...rest, stageId: stage.id, weaknessId: weakness.id }; };
const deser = (o) => {
  const stage = G.STAGES[o.stageId]; if (!stage) return null;
  const weakness = stage.weaknesses.find(w => w.id === o.weaknessId); if (!weakness) return null;
  const { stageId, weaknessId, ...rest } = o; return { ...rest, stage, weakness };
};

// ───── 1対戦 = 1 Durable Object
export class GameDO extends DurableObject {
  constructor(ctx, env) { super(ctx, env); boot(env); this.g = null; }
  async load() { if (!this.g) { const o = await this.ctx.storage.get('g'); this.g = o ? deser(o) : null; } return this.g; }
  async save() { await this.ctx.storage.put('g', ser(this.g)); }
  async init(o) { this.g = deser(o); await this.save(); await this.ctx.storage.setAlarm(Date.now() + 3 * 3600e3); return true; }
  async alarm() { await this.ctx.storage.deleteAll(); this.g = null; } // 3時間で片付け
  async takeRemember() {
    const g = this.g;
    if (!g || g.status === 'playing' || g.memorized || !g.playerId) return null;
    g.memorized = true; await this.save(); return ser(g);
  }
  async turn(text) {
    const g = await this.load(); if (!g) return { code: 404, body: { error: 'game not found' } };
    G.checkTimeUp(g);
    if (g.status !== 'playing') { await this.save(); return { code: 409, body: { error: g.loseReason === 'time' ? 'timeup' : 'game over', ...G.publicState(g) }, remember: await this.takeRemember() }; }
    if (g.busy) return { code: 429, body: { error: 'busy' } };
    if (g.turn >= LIMITS.turnsPerGame) return { code: 429, body: { error: 'turn limit', message: `1戦の発言は${LIMITS.turnsPerGame}回までです` } };
    g.busy = true;
    try {
      const body = await TURN.handleTurn(g, String(text || '').slice(0, LIMITS.textMax));
      await this.save();
      return { code: 200, body, remember: await this.takeRemember() };
    } finally { g.busy = false; }
  }
  async timeout() {
    const g = await this.load(); if (!g) return { code: 404, body: { error: 'game not found' } };
    G.checkTimeUp(g); await this.save();
    return { code: 200, body: G.publicState(g), remember: await this.takeRemember() };
  }
  async hint() {
    const g = await this.load(); if (!g) return { code: 404, body: { error: 'game not found' } };
    G.checkTimeUp(g);
    if (g.status !== 'playing') { await this.save(); return { code: 409, body: { error: 'game over' }, remember: await this.takeRemember() }; }
    if ((g.hintsUsed || 0) >= G.HINT_MAX) return { code: 429, body: { error: 'no hints left', hintsLeft: 0 } };
    if (g.hintBusy) return { code: 429, body: { error: 'busy' } };
    g.hintBusy = true;
    try {
      let hints;
      try { hints = await LLM.hintSuggestions(g); } catch (e) { console.error('[hint]', e.message); }
      if (!hints || !hints.length) hints = LLM.mockHints(g);
      g.hintsUsed = (g.hintsUsed || 0) + 1; await this.save();
      return { code: 200, body: { hints, hintsLeft: G.HINT_MAX - g.hintsUsed, penalty: G.HINT_PENALTY } };
    } finally { g.hintBusy = false; }
  }
  async line(i) {
    const g = await this.load(); const h = g && g.history[Number(i)];
    return h && h.role === 'npc' ? { stageId: g.stage.id, text: h.text, expr: h.expr } : null;
  }
}

// ───── プレイヤーの記憶(過去の対戦)
export class PlayerDO extends DurableObject {
  async list() { return (await this.ctx.storage.get('battles')) || []; }
  async add(rec) { const b = MC.trim([...(await this.list()), rec]); await this.ctx.storage.put('battles', b); return b.length; }
  async reset() { await this.ctx.storage.deleteAll(); return true; }
}

// ───── レート制限(キーごとのスライディングウィンドウ)
export class LimitDO extends DurableObject {
  async hit(kind, max, windowSec) {
    const now = Date.now(), from = now - windowSec * 1000;
    const list = ((await this.ctx.storage.get(kind)) || []).filter(t => t > from);
    if (list.length >= max) return { ok: false, retryAfter: Math.max(1, Math.ceil((list[0] + windowSec * 1000 - now) / 1000)) };
    list.push(now); await this.ctx.storage.put(kind, list);
    await this.ctx.storage.setAlarm(now + 24 * 3600e3);
    return { ok: true };
  }
  // 日ごとのカウンタ(全体上限用)
  async count(kind, max) {
    const key = kind + ':' + new Date().toISOString().slice(0, 10);
    const n = (await this.ctx.storage.get(key)) || 0;
    if (n >= max) return { ok: false };
    await this.ctx.storage.put(key, n + 1);
    await this.ctx.storage.setAlarm(Date.now() + 48 * 3600e3);
    return { ok: true };
  }
  async alarm() { await this.ctx.storage.deleteAll(); }
}

async function limit(env, req, kind) {
  let ip = req.headers.get('cf-connecting-ip') || 'unknown';
  if (ip.includes(':')) ip = ip.split(':').slice(0, 4).join(':') + '::/64'; // IPv6 は /64 単位
  const [max, sec] = LIMITS.ip[kind];
  const r = await env.LIMIT.getByName('ip:' + ip).hit(kind, max, sec);
  if (r.ok) {
    const day = LIMITS.globalPerDay[kind];
    if (day && !(await env.LIMIT.getByName('global').count(kind, day)).ok) return json(429, { error: 'daily limit', message: '本日の公開プレイ枠が上限に達しました。また明日お試しください。' });
    return null;
  }
  return json(429, { error: 'rate limited', message: `アクセスが集中しています。${r.retryAfter}秒ほど待ってからもう一度お試しください。`, retryAfter: r.retryAfter }, { 'retry-after': String(r.retryAfter) });
}

async function readBody(req) {
  const t = await req.text();
  if (t.length > LIMITS.bodyMax) throw Object.assign(new Error('body too large'), { code: 413 });
  try { return t ? JSON.parse(t) : {}; } catch { throw Object.assign(new Error('bad json'), { code: 400 }); }
}

// 対戦が終わったら、ボスの記憶に残す(LLMで短く要約。レスポンスは待たせない)
function remember(env, ctx, snap) {
  if (!snap) return;
  ctx.waitUntil((async () => {
    const g = deser(snap); if (!g || !g.playerId) return;
    const rec = MC.makeRecord(g, await MC.summarize(g, LLM.complete));
    await env.PLAYER.getByName(g.playerId).add(rec);
  })().catch(e => console.error('[memory]', e.message)));
}
const gameStub = (env, id) => (typeof id === 'string' && UUID.test(id) ? env.GAME.getByName(id) : null);
const reply = (env, ctx, r) => { remember(env, ctx, r.remember); return json(r.code, r.body); };

async function api(req, env, ctx, url) {
  const P = url.pathname, M = req.method;
  if (M === 'GET' && P === '/api/health') return json(200, { ok: true, provider: LLM.resolveProvider(), tts: TTS.enabled() ? TTS.modelName() : false, ttsProvider: TTS.enabled() ? TTS.PROVIDER() : null, runtime: 'cloudflare-workers' });
  if (M === 'GET' && P === '/api/bgm') {
    if (CFG.BGM_FILE) return json(200, { type: 'file', src: CFG.BGM_FILE, volume: CFG.BGM_VOLUME, credit: CFG.BGM_CREDIT || null });
    return json(200, { type: 'none' });
  }
  if (M === 'POST' && P === '/api/ladder') {
    const rl = await limit(env, req, 'ladder'); if (rl) return rl;
    const body = await readBody(req);
    const pl = MC.playerFromToken(body.playerToken) ? { token: body.playerToken } : MC.newPlayer();
    return json(200, { ...G.ladderInfo(G.rankFromToken(body.rankToken)), provider: LLM.resolveProvider(), playerToken: pl.token });
  }
  if (M === 'POST' && P === '/api/new') {
    const body = await readBody(req);
    const stage = G.STAGES[body.stage];
    if (!stage) return json(400, { error: 'unknown stage' });
    const rank = G.rankFromToken(body.rankToken);
    const ch = G.challengeInfo(rank, stage);
    if (!ch) return json(403, { error: 'locked', rank });
    const rl = await limit(env, req, 'new'); if (rl) return rl;
    const g = G.newGame(stage, rank, ch);
    g.playerId = MC.playerFromToken(body.playerToken);
    const battles = g.playerId ? await env.PLAYER.getByName(g.playerId).list() : [];
    const note = MC.noteForBattles(battles, stage);
    g.memoryNote = note.text; g.memFlags = note;
    if (note.rematch || note.rumors) {
      try { g.history[0].text = await LLM.openingLine(g); } catch (e) { console.error('[opening]', e.message); }
      g.startedAt = Date.now();
    }
    await env.GAME.getByName(g.id).init(ser(g));
    return json(200, { ...G.publicState(g), stageInfo: G.stageInfo(stage, g), provider: LLM.resolveProvider(), tts: TTS.enabled(), ttsRate: TTS.playbackRate() });
  }
  if (M === 'POST' && P === '/api/turn') {
    const body = await readBody(req);
    const st = gameStub(env, body.id); if (!st) return json(404, { error: 'game not found' });
    const rl = await limit(env, req, 'turn'); if (rl) return rl;
    return reply(env, ctx, await st.turn(body.text));
  }
  if (M === 'POST' && P === '/api/timeout') {
    const body = await readBody(req);
    const st = gameStub(env, body.id); if (!st) return json(404, { error: 'game not found' });
    return reply(env, ctx, await st.timeout());
  }
  if (M === 'POST' && P === '/api/hint') {
    const body = await readBody(req);
    const st = gameStub(env, body.id); if (!st) return json(404, { error: 'game not found' });
    const rl = await limit(env, req, 'hint'); if (rl) return rl;
    return reply(env, ctx, await st.hint());
  }
  if (M === 'GET' && P === '/api/tts') {
    if (!TTS.enabled()) return json(503, { error: 'tts disabled' });
    const st = gameStub(env, url.searchParams.get('id')); if (!st) return json(404, { error: 'line not found' });
    const rl = await limit(env, req, 'tts'); if (rl) return rl;
    const line = await st.line(url.searchParams.get('i'));
    if (!line) return json(404, { error: 'line not found' });
    return TTS.speech(env, ctx, line.stageId, line.text, { expr: line.expr, stream: url.searchParams.get('s') === '1' });
  }
  if (M === 'POST' && P === '/api/memory/reset') {
    const rl = await limit(env, req, 'reset'); if (rl) return rl;
    const body = await readBody(req);
    const pid = MC.playerFromToken(body.playerToken);
    if (!pid) return json(400, { error: 'bad player' });
    await env.PLAYER.getByName(pid).reset(); return json(200, { ok: true });
  }
  return json(404, { error: 'not found' });
}

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(req);
    try { boot(env); return await api(req, env, ctx, url); }
    catch (e) { if (e.code) return json(e.code, { error: e.message }); console.error(e); return json(500, { error: 'server error' }); }
  },
};
