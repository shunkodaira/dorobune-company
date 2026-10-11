// 依存ゼロの Node サーバ (node server.js)
const http = require('http');
const fs = require('fs');
const path = require('path');
const G = require('./game');
const EX = require('./expr');
const { askNpc, resolveProvider, mockReply, complete, openingLine, hintSuggestions, mockHints } = require('./llm');
const MEM = require('./memory');
const TTS = require('./tts');

const PORT = Number(process.env.PORT || 3456);
const games = new Map();

// 進行中の対戦をディスクに保存(サーバ再起動で対戦が消えないように)。終了済み・2時間以上前のものは捨てる
const GAMES_FILE = process.env.GAMES_FILE || path.join(__dirname, 'data', 'games.json');
const GAME_TTL_MS = 2 * 60 * 60 * 1000, DONE_TTL_MS = 15 * 60 * 1000;
function keepGame(g, now) {
  if (now - g.startedAt > GAME_TTL_MS) return false;
  return g.status === 'playing' || now - (g.finishedAt || g.startedAt) < DONE_TTL_MS; // 結果画面の読み上げ用に終了直後は少し残す
}
function saveGames() {
  try {
    const now = Date.now(), list = [];
    for (const g of games.values()) {
      if (!keepGame(g, now)) { games.delete(g.id); continue; }
      const { stage, weakness, busy, hintBusy, ...rest } = g;
      list.push({ ...rest, stageId: stage.id, weaknessId: weakness.id });
    }
    fs.mkdirSync(path.dirname(GAMES_FILE), { recursive: true });
    fs.writeFileSync(GAMES_FILE + '.tmp', JSON.stringify(list));
    fs.renameSync(GAMES_FILE + '.tmp', GAMES_FILE);
  } catch (e) { console.error('[games save]', e.message); }
}
function loadGames() {
  try {
    if (!fs.existsSync(GAMES_FILE)) return;
    const now = Date.now(); let n = 0;
    for (const o of JSON.parse(fs.readFileSync(GAMES_FILE, 'utf8'))) {
      const stage = G.STAGES[o.stageId]; if (!stage) continue;
      const weakness = stage.weaknesses.find(w => w.id === o.weaknessId); if (!weakness) continue;
      const { stageId, weaknessId, ...rest } = o;
      const g = { ...rest, stage, weakness };
      if (keepGame(g, now)) { games.set(g.id, g); n++; }
    }
    console.log(`[games] restored ${n} game(s) from disk`);
  } catch (e) { console.error('[games load]', e.message); }
}
const PUB = path.join(__dirname, 'public');

function send(res, code, obj) { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(obj)); }
function readBody(req) {
  return new Promise((ok, ng) => { let b = ''; req.on('data', c => { b += c; if (b.length > 1e5) req.destroy(); }); req.on('end', () => { try { ok(b ? JSON.parse(b) : {}); } catch (e) { ng(e); } }); });
}

async function handleTurn(g, text) {
  const st = g.stage;
  text = String(text || '').slice(0, 400);
  const rules = G.analyzeRules(g, text, g.history.filter(h => h.role === 'player').map(h => h.text));
  let ans;
  try { ans = await askNpc(g, rules, text); }
  catch (e) { console.error('[LLM error → mock]', e.message); ans = { ...mockReply(g, rules, text), provider: 'mock(fallback)' }; }
  if (g.status !== 'playing') return G.publicState(g); // 応答待ちの間に時間切れ確定済み

  // コード側でクランプ: ステージの範囲 + ルール検出時の上限
  let delta = G.clamp(Math.round(ans.mood_delta), g.deltaMin, g.deltaMax);
  delta = Math.min(delta, rules.cap);
  if (rules.floor != null) delta = Math.max(delta, rules.floor);
  if (!rules.hits.length) delta = Math.max(delta, -8); // 地雷・暴言なしの軽いミスは最大 -8 まで
  G.addSkills(g, ans.skills || {}, rules);
  g.turn += 1;
  g.gauge = G.clamp(g.gauge + delta, 0, 100);
  g.history.push({ role: 'player', text });

  let reply = ans.reply;
  if (g.gauge >= 100) { G.finish(g, 'won'); reply = st.winLine; } // 勝利時はLLMの台詞を捨てて、折れる台詞で統一
  else if (g.gauge <= 0) { G.finish(g, 'lost', 'zero'); reply += '\n\n' + st.loseZeroLine; }
  const expr = EX.pick(st.id, ans.expression, delta, g.gauge, g.status);
  g.history.push({ role: 'npc', text: reply, expr });
  G.checkTimeUp(g); // 応答待ちの間に時間切れになった場合
  const entry = { stage: st.id, turn: g.turn, player: text, reply, llm_delta: ans.mood_delta, applied_delta: delta, reason: ans.reason, expr, llm_expr: ans.expression, rule_hits: rules.hits, gauge: g.gauge, provider: ans.provider, retried: ans.retried, unresolved: ans.unresolved };
  g.log.push(entry);
  console.log(JSON.stringify({ game: g.id.slice(0, 8), ...entry }));
  return { ...G.publicState(g), last: { delta, reason: ans.reason, ruleHits: rules.hits, expr } };
}

// 対戦が終わったら、ボスの記憶に残す(LLMで短く要約。レスポンスは待たせない)
function remember(g) {
  if (g.status === 'playing' || g.memorized || !g.playerId) return;
  MEM.record(g, complete).catch(e => console.error('[memory]', e.message));
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'POST' && req.url.startsWith('/api/')) res.on('finish', saveGames); // 状態が変わりうる操作のあとに書き出す
  try {
    const url = new URL(req.url, 'http://x');
    if (req.method === 'POST' && url.pathname === '/api/ladder') {
      const body = await readBody(req);
      // プレイヤーID(過去の対戦の記憶用)。無い/不正なら新規発行
      const pl = MEM.playerFromToken(body.playerToken) ? { token: body.playerToken } : MEM.newPlayer();
      return send(res, 200, { ...G.ladderInfo(G.rankFromToken(body.rankToken)), provider: resolveProvider(), playerToken: pl.token });
    }
    if (req.method === 'POST' && url.pathname === '/api/new') {
      const body = await readBody(req);
      const stage = G.STAGES[body.stage];
      if (!stage) return send(res, 400, { error: 'unknown stage' });
      // 役職(署名トークン)を検証し、+1/+2 の相手にしか挑戦できない
      const rank = G.rankFromToken(body.rankToken);
      const ch = G.challengeInfo(rank, stage);
      if (!ch) return send(res, 403, { error: 'locked', rank });
      const g = G.newGame(stage, rank, ch, process.env.ALLOW_FORCE_WEAKNESS ? body.weakness : undefined);
      g.playerId = MEM.playerFromToken(body.playerToken);
      const note = MEM.noteFor(g.playerId, stage);
      g.memoryNote = note.text; g.memFlags = note;
      if (note.rematch || note.rumors) {
        // 再戦/噂あり → 第一声をLLMで作る(過去に触れる)。失敗したら固定の台詞
        try { g.history[0].text = await openingLine(g); } catch (e) { console.error('[opening]', e.message); }
        g.startedAt = Date.now(); // 第一声の生成待ちは制限時間に含めない
      }
      games.set(g.id, g);
      if (games.size > 1000) games.delete(games.keys().next().value);
      return send(res, 200, { ...G.publicState(g), stageInfo: G.stageInfo(stage, g), provider: resolveProvider(), tts: TTS.enabled(), ttsRate: TTS.playbackRate() });
    }
    if (req.method === 'POST' && url.pathname === '/api/turn') {
      const body = await readBody(req);
      const g = games.get(body.id);
      if (!g) return send(res, 404, { error: 'game not found' });
      G.checkTimeUp(g);
      if (g.status !== 'playing') return send(res, 409, { error: g.loseReason === 'time' ? 'timeup' : 'game over', ...G.publicState(g) });
      if (g.busy) return send(res, 429, { error: 'busy' });
      g.busy = true;
      try { return send(res, 200, await handleTurn(g, body.text)); } finally { g.busy = false; remember(g); }
    }
    if (req.method === 'POST' && url.pathname === '/api/timeout') {
      // 制限時間切れ(サーバ側の経過時間で判定するのでクライアントは早めに終わらせられない)
      const body = await readBody(req);
      const g = games.get(body.id);
      if (!g) return send(res, 404, { error: 'game not found' });
      G.checkTimeUp(g); remember(g);
      return send(res, 200, G.publicState(g));
    }
    if (req.method === 'GET' && url.pathname === '/api/tts') {
      // ボスのセリフ音声。読むのはこのゲームの履歴にある上司のセリフだけ(任意テキストのTTSプロキシにしない)
      if (!TTS.enabled()) return send(res, 503, { error: 'tts disabled' });
      const g = games.get(url.searchParams.get('id'));
      const h = g && g.history[Number(url.searchParams.get('i'))];
      if (!h || h.role !== 'npc') return send(res, 404, { error: 'line not found' });
      return await TTS.streamSpeech(g.stage.id, h.text, res, { expr: h.expr, stream: url.searchParams.get('s') === '1' });
    }
    if (req.method === 'POST' && url.pathname === '/api/hint') {
      // ヒント(1戦3回まで・1回ごとにスコア減点)。回数はサーバで管理
      const body = await readBody(req);
      const g = games.get(body.id);
      if (!g) return send(res, 404, { error: 'game not found' });
      G.checkTimeUp(g); remember(g);
      if (g.status !== 'playing') return send(res, 409, { error: 'game over' });
      if ((g.hintsUsed || 0) >= G.HINT_MAX) return send(res, 429, { error: 'no hints left', hintsLeft: 0 });
      if (g.hintBusy) return send(res, 429, { error: 'busy' });
      g.hintBusy = true;
      try {
        let hints;
        try { hints = await hintSuggestions(g); } catch (e) { console.error('[hint]', e.message); }
        if (!hints || !hints.length) hints = mockHints(g);
        g.hintsUsed = (g.hintsUsed || 0) + 1;
        console.log(JSON.stringify({ game: g.id.slice(0, 8), hint: g.hintsUsed, hints }));
        return send(res, 200, { hints, hintsLeft: G.HINT_MAX - g.hintsUsed, penalty: G.HINT_PENALTY });
      } finally { g.hintBusy = false; }
    }
    if (req.method === 'POST' && url.pathname === '/api/memory/reset') {
      const body = await readBody(req);
      const pid = MEM.playerFromToken(body.playerToken);
      if (!pid) return send(res, 400, { error: 'bad player' });
      MEM.reset(pid); return send(res, 200, { ok: true });
    }
    if (req.method === 'GET' && url.pathname === '/api/bgm') {
      const C = require('./config');
      const file = C.BGM_FILE && path.join(PUB, path.normalize(C.BGM_FILE).replace(/^(\.\.[\/\\])+/, ''));
      if (file && file.startsWith(PUB) && fs.existsSync(file)) return send(res, 200, { type: 'file', src: C.BGM_FILE, volume: C.BGM_VOLUME, credit: C.BGM_CREDIT || null });
      if (C.BGM_YOUTUBE_ID) return send(res, 200, { type: 'youtube', id: C.BGM_YOUTUBE_ID, volume: C.BGM_VOLUME });
      return send(res, 200, { type: 'none' });
    }
    if (req.method === 'GET' && url.pathname === '/api/health') return send(res, 200, { ok: true, provider: resolveProvider(), tts: TTS.enabled() ? TTS.MODEL : false, ttsProvider: TTS.enabled() ? TTS.PROVIDER() : null });
    const p = url.pathname === '/' ? '/index.html' : url.pathname;
    const fp = path.join(PUB, path.normalize(p).replace(/^(\.\.[\/\\])+/, ''));
    if (!fp.startsWith(PUB) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { res.writeHead(404); return res.end('not found'); }
    const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.json': 'application/json', '.mp3': 'audio/mpeg', '.woff': 'font/woff', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4' };
    // キャッシュ対策: 毎回再検証(ETag が同じなら 304)。更新後にリロード不要で新しいUI/画像が出る
    const stt = fs.statSync(fp), etag = `"${stt.size.toString(36)}-${Math.round(stt.mtimeMs).toString(36)}"`;
    if (req.headers['if-none-match'] === etag) { res.writeHead(304, { etag, 'cache-control': 'no-cache' }); return res.end(); }
    res.writeHead(200, { 'content-type': types[path.extname(fp)] || 'application/octet-stream', etag, 'cache-control': 'no-cache' });
    fs.createReadStream(fp).pipe(res);
  } catch (e) { console.error(e); if (!res.headersSent) send(res, 500, { error: e.message }); else res.end(); }
});
loadGames();
server.listen(PORT, () => console.log(`bucho-ai listening on http://localhost:${PORT}  provider=${resolveProvider()}`));
