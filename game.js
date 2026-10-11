// ゲーム進行ロジック(状態はすべてコード側。LLMは台詞とdeltaの「提案」だけ)
const crypto = require('crypto');
const { RANKS, STAGES, BY_RANK, JUMP, COMMON_INJECTION } = require('./ladder');

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function shuffle(a) { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

// 役職トークン(HMAC署名)。"<役職index>.<署名>" 形式。秘密鍵は .secret / Worker版は RANK_SECRET(secret.js)
const SECRET = require('./secret');
const sig = (r) => crypto.createHmac('sha256', SECRET.get()).update('rank:' + r).digest('hex').slice(0, 24);
const rankToken = (r) => `${r}.${sig(r)}`;
function rankFromToken(tok) {
  if (typeof tok !== 'string') return 0;
  const [r, s] = tok.split('.');
  const n = Number(r);
  if (!Number.isInteger(n) || n < 0 || n >= RANKS.length || !s || s.length !== 24) return 0;
  return crypto.timingSafeEqual(Buffer.from(s), Buffer.from(sig(n))) ? n : 0;
}

// 制限時間(秒)。テスト用に TIME_LIMIT_SEC で全ステージ一律に上書き可
const baseLimit = (st) => Number(process.env.TIME_LIMIT_SEC) || st.timeLimitSec;

// 挑戦の条件: 自分の役職の +1 か +2 のボスのみ
function challengeInfo(rank, stage) {
  // 社長(最上位)になったら「社長特権」: どの上司ともフリー対戦できる(勝っても負けても役職は変わらない)
  if (rank === RANKS.length - 1) return { jump: false, free: true, start: stage.start, deltaMax: stage.deltaMax, deltaMin: stage.deltaMin, limitSec: Math.max(30, baseLimit(stage)), scoreMul: 1 };
  const diff = stage.rank - rank;
  if (diff !== 1 && diff !== 2) return null;
  const jump = diff === 2;
  return {
    jump,
    start: stage.start + (jump ? JUMP.start : 0),
    deltaMax: stage.deltaMax + (jump ? JUMP.deltaMax : 0),
    deltaMin: stage.deltaMin,
    limitSec: Math.max(30, baseLimit(stage) + (jump && !process.env.TIME_LIMIT_SEC ? JUMP.timeSec : 0)),
    scoreMul: jump ? JUMP.scoreMul : 1,
  };
}

function newGame(stage, rank, ch, forcedWeakness) {
  const weakness = stage.weaknesses.find(w => w.id === forcedWeakness) || pick(stage.weaknesses);
  const fatal = require('./fatal').FATAL[stage.id];
  // 気になるもの: ランダム弱点のヒント + 致命的弱点の手がかり + 関係ない小物1つ
  const scene = shuffle([weakness.hint, ...(fatal ? [fatal.clue] : []), ...shuffle(stage.decoys).slice(0, fatal ? 1 : 2)]);
  return { id: crypto.randomUUID(), stage, weakness, scene, gauge: ch.start, deltaMax: ch.deltaMax, deltaMin: ch.deltaMin, limitSec: ch.limitSec, scoreMul: ch.scoreMul, jump: ch.jump, free: !!ch.free,
    turn: 0, status: 'playing', history: [{ role: 'npc', text: stage.opening, expr: require('./expr').opening(stage.id) }], log: [],
    skillSum: { logic: 0, empathy: 0, presentation: 0, trust: 0 }, skillN: 0, startedAt: Date.now(), rankBefore: rank };
}

function bigrams(t) { const s = new Set(); for (let i = 0; i < t.length - 1; i++) s.add(t.slice(i, i + 2)); return s; }
function similar(a, b) {
  if (a === b) return 1;
  const A = bigrams(a), B = bigrams(b); if (!A.size || !B.size) return 0;
  let inter = 0; for (const x of A) if (B.has(x)) inter++;
  return inter / Math.min(A.size, B.size);
}
function analyzeRules(g, text, prev) {
  const stage = g.stage;
  const hits = []; let cap = g.deltaMax;
  for (const r of stage.angerRules) if (r.re.test(text)) { hits.push(r.label); cap = Math.min(cap, r.cap); }
  if (stage.jargon) {
    const j = text.match(stage.jargon) || [];
    if (new Set(j.map(x => x.toLowerCase())).size >= 3) { hits.push('専門用語の羅列'); cap = Math.min(cap, -8); }
  }
  const injection = COMMON_INJECTION.test(text);
  if (injection) { hits.push('メタ発言/インジェクション'); cap = Math.min(cap, -10); }
  // 連打対策: 極端に短い発言 / 過去の発言の繰り返しはゲージが上がらない(マイナス)
  const norm = (t) => t.replace(/[\s、。,.!?！？…・「」『』()（）]/g, '');
  const n = norm(text);
  let floor = null;
  const other = hits.length > 0;
  if (n.length < 6) { hits.push('短すぎる発言'); cap = Math.min(cap, n.length < 3 ? -3 : -1); if (!other) floor = -5; }
  else if ((prev || []).some(p => similar(norm(p), n) >= 0.8)) { hits.push('同じ話の繰り返し'); cap = Math.min(cap, -3); if (!other) floor = -5; }
  return { hits, cap, injection, floor }; // floor: 連打系だけのときは減点を -8 までに抑える
}

// ステータス: 各発言の採点(0-10)の平均をコードで保持 → Lv1〜5 と バー%
function skillState(g) {
  const out = {};
  for (const k in g.skillSum) {
    const avg = g.skillN ? g.skillSum[k] / g.skillN : 0;
    out[k] = { lv: Math.min(5, 1 + Math.floor(avg / 2)), pct: Math.round(avg * 10) };
  }
  return out;
}
function addSkills(g, sk, rules) {
  g.skillN += 1;
  for (const k in g.skillSum) g.skillSum[k] += rules.cap < 0 ? Math.min(sk[k] ?? 0, 2) : (sk[k] ?? 0);
}
const elapsedSec = (g) => ((g.finishedAt || Date.now()) - g.startedAt) / 1000;
const timeLeft = (g) => Math.max(0, Math.round(g.limitSec - elapsedSec(g)));
function finish(g, status, reason) {
  g.status = status; g.loseReason = reason; g.finishedAt = Date.now();
  g.rankAfter = g.free ? g.rankBefore : status === 'won' ? g.stage.rank : Math.max(0, g.rankBefore - 1); // 勝利=相手の役職へ / 敗北=1段降格 / フリー対戦は変化なし
}
// 時間切れ処理(サーバ側で判定)。終了したら true
function checkTimeUp(g) {
  if (g.status !== 'playing' || g.limitSec - elapsedSec(g) > 0) return false;
  finish(g, 'lost', 'time');
  g.history.push({ role: 'npc', text: g.stage.timeUpLine, expr: require('./expr').timeUp(g.stage.id) });
  return true;
}

// スコア = (基礎点 + 残り秒数 × 2) × 飛び級倍率
const HINT_MAX = 3, HINT_PENALTY = 150; // ヒントは1戦3回まで、1回ごとにスコア -150
const FATAL_BONUS = require('./fatal').FATAL_BONUS; // 会心の一撃(致命的弱点)で勝つとボーナス
const score = (g) => Math.max(0, Math.round((g.stage.scoreBase + 2 * timeLeft(g) + (g.fatalHit ? FATAL_BONUS : 0)) * g.scoreMul) - HINT_PENALTY * (g.hintsUsed || 0));

function stageInfo(s, g) {
  const fc = require('./fatal').FATAL[s.id];
  // 役員クラス(気になるもの非表示)は、致命的弱点の手がかりを導入文でさりげなく見せる
  const intro = fc && !s.showScene ? `${s.intro}\n(ふと目に入った:${fc.clue})` : s.intro;
  return { id: s.id, rank: s.rank, rankName: s.rankName, title: s.title, goal: s.goal, charName: s.charName, charSub: s.charSub, gaugeLabel: s.gaugeLabel, faces: s.faces, intro,
    tips: s.tips, timeLimitSec: g ? g.limitSec : baseLimit(s), timeUpTitle: s.timeUpTitle, winTitle: s.winTitle, loseTitle: s.loseTitle, stampText: s.stampText,
    objective: s.objective, npcLabel: s.npcLabel, theme: s.theme, img: s.img, exprs: Object.keys(require('./expr').EXPRS), showScene: s.showScene, jump: g ? g.jump : undefined, free: g ? !!g.free : undefined };
}

function ladderInfo(rank) {
  return {
    rank, rankName: RANKS[rank], ranks: RANKS, clear: rank === RANKS.length - 1, free: rank === RANKS.length - 1,
    steps: RANKS.map((name, r) => {
      const st = BY_RANK[r];
      const ch = st ? challengeInfo(rank, st) : null;
      return { rank: r, name, boss: st ? { id: st.id, charName: st.charName, charSub: st.charSub, goal: st.goal, objective: st.objective, img: st.img, theme: st.theme,
        timeLimitSec: ch ? ch.limitSec : baseLimit(st), jump: ch ? ch.jump : false, free: ch ? !!ch.free : false } : null, challengeable: !!ch };
    }),
  };
}

function publicState(g) {
  const s = { id: g.id, stage: g.stage.id, gauge: g.gauge, turn: g.turn, status: g.status, timeUsed: Math.round(Math.min(elapsedSec(g), g.limitSec)), scene: g.scene, history: g.history, skills: skillState(g), timeLeft: timeLeft(g), loseReason: g.loseReason, hintsLeft: HINT_MAX - (g.hintsUsed || 0), hintsUsed: g.hintsUsed || 0 };
  if (g.status !== 'playing') {
    s.weakness = g.weakness.label;
    s.rankBefore = RANKS[g.rankBefore]; s.rankAfter = RANKS[g.rankAfter];
    s.rankToken = rankToken(g.rankAfter); s.jump = g.jump;
    s.free = !!g.free;
    s.gameClear = !g.free && g.status === 'won' && g.rankAfter === RANKS.length - 1;
    if (g.status === 'won') { s.score = score(g); if (g.fatalHit) { s.fatal = true; s.fatalLabel = require('./fatal').FATAL[g.stage.id].label; s.fatalBonus = Math.round(FATAL_BONUS * g.scoreMul); } }
    else { s.exile = g.stage.exile[g.loseReason] || g.stage.exile.zero; s.exileSigner = g.stage.exileSigner; }
  }
  return s;
}

module.exports = { HINT_MAX, HINT_PENALTY, RANKS, STAGES, rankFromToken, rankToken, challengeInfo, ladderInfo, addSkills, timeLeft, finish, checkTimeUp, newGame, analyzeRules, clamp, score, publicState, stageInfo };
