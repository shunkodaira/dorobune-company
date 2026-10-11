// 1ターンの処理(Node版 server.js と Cloudflare Worker版で共有)
const G = require('./game');
const EX = require('./expr');
const { askNpc, mockReply, complete } = require('./llm');
const FT = require('./fatal');

async function handleTurn(g, text) {
  const st = g.stage;
  text = String(text || '').slice(0, 400);
  const rules = G.analyzeRules(g, text, g.history.filter(h => h.role === 'player').map(h => h.text));
  // 致命的弱点(会心の一撃): コードの前提チェックを通った発言だけ、LLM審判に並行で判定させる
  const pre = FT.precheck(g, text, rules);
  const fatalP = pre.ok ? FT.judge(g, text, complete).catch(e => { console.error('[fatal judge]', e.message); return { hit: false, reason: 'judge-error' }; }) : Promise.resolve({ hit: false, reason: pre.why });
  let ans;
  try { ans = await askNpc(g, rules, text); }
  catch (e) { console.error('[LLM error → mock]', e.message); ans = { ...mockReply(g, rules, text), provider: 'mock(fallback)' }; }
  const fj = await fatalP;
  if (g.status !== 'playing') return G.publicState(g); // 応答待ちの間に時間切れ確定済み
  if (pre.ok && fj.hit && !g.fatalHit) return fatalWin(g, text, ans, rules, fj);

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
  const entry = { stage: st.id, turn: g.turn, player: text, reply, llm_delta: ans.mood_delta, applied_delta: delta, reason: ans.reason, expr, llm_expr: ans.expression, rule_hits: rules.hits, fatal_check: pre.ok ? 'judge:' + fj.reason : pre.why, gauge: g.gauge, provider: ans.provider, retried: ans.retried, unresolved: ans.unresolved };
  g.log.push(entry);
  console.log(JSON.stringify({ game: g.id.slice(0, 8), ...entry }));
  return { ...G.publicState(g), last: { delta, reason: ans.reason, ruleHits: rules.hits, expr } };
}

// 会心の一撃: ゲージを一気に100にして即勝利。台詞はボス固有の「折れる」台詞
function fatalWin(g, text, ans, rules, fj) {
  const st = g.stage, f = FT.FATAL[st.id];
  const delta = 100 - g.gauge;
  G.addSkills(g, ans.skills || {}, rules);
  g.turn += 1; g.gauge = 100; g.fatalHit = true;
  g.history.push({ role: 'player', text });
  G.finish(g, 'won');
  const expr = EX.pick(st.id, null, delta, 100, 'won');
  g.history.push({ role: 'npc', text: f.winLine, expr });
  const reason = '会心の一撃！ ' + f.label;
  const entry = { stage: st.id, turn: g.turn, player: text, reply: f.winLine, fatal: true, judge: fj.reason, applied_delta: delta, gauge: 100, provider: ans.provider };
  g.log.push(entry);
  console.log(JSON.stringify({ game: g.id.slice(0, 8), ...entry }));
  return { ...G.publicState(g), last: { delta, reason, ruleHits: [], expr, fatal: true } };
}

module.exports = { handleTurn };
