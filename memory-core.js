// ボスの記憶: 保存方法に依存しない部分(Node版 memory.js と Cloudflare Worker版で共有)
const crypto = require('crypto');
const SECRET = require('./secret');
const sig = (id) => crypto.createHmac('sha256', SECRET.get()).update('player:' + id).digest('hex').slice(0, 24);

// ───── プレイヤーID(署名付きトークン "uuid.sig")
function playerFromToken(tok) {
  const [id, s] = String(tok || '').split('.');
  if (!id || !/^[0-9a-f-]{36}$/.test(id) || !s) return null;
  const a = Buffer.from(s), b = Buffer.from(sig(id));
  return a.length === b.length && crypto.timingSafeEqual(a, b) ? id : null;
}
function newPlayer() { const id = crypto.randomUUID(); return { id, token: `${id}.${sig(id)}` }; }

// ボスごとに直近3戦、全体で30戦まで
const PER_BOSS = 3, TOTAL = 30;
function trim(list) {
  const keep = []; const cnt = {};
  for (const b of list.slice().reverse()) { cnt[b.boss] = (cnt[b.boss] || 0) + 1; if (cnt[b.boss] <= PER_BOSS && keep.length < TOTAL) keep.unshift(b); }
  return keep;
}

// ───── 対戦後の要約(LLM)。失敗したらコード側の簡易要約
const RESULT_JA = (b) => b.result === 'won' ? 'プレイヤーの勝ち(説得された)' : b.loseReason === 'time' ? 'プレイヤーの負け(時間切れ)' : 'プレイヤーの負け(交渉決裂)';
async function summarize(g, callLLM) {
  const transcript = g.history.map(h => (h.role === 'player' ? '若手: ' : `${g.stage.npcLabel}: `) + h.text.replace(/\s+/g, ' ').slice(0, 200)).join('\n').slice(-3500);
  const msgs = [
    { role: 'system', content: `あなたはゲームの記録係。以下は会社の上司(${g.stage.charName})と若手社員の交渉の記録。上司が次に同じ若手と会ったときに思い出す「記憶メモ」を作る。必ず次のJSONのみを出力:
{"summary": "上司の視点での一言要約(40字以内、口調は中立)", "tactics": ["若手が使った主な論点・証拠・作戦(各12字以内、最大3つ)"], "insults": 若手が暴言・失礼な発言をしたら true}` },
    { role: 'user', content: `結果: ${g.status === 'won' ? '若手の勝ち(上司が受け入れた)' : '若手の負け'}\n記録:\n${transcript}` },
  ];
  try {
    const o = JSON.parse((await callLLM(msgs)).match(/\{[\s\S]*\}/)[0]);
    return { summary: String(o.summary || '').slice(0, 60), tactics: (Array.isArray(o.tactics) ? o.tactics : []).map(t => String(t).slice(0, 20)).slice(0, 3), insults: !!o.insults };
  } catch (e) {
    const hits = g.log.flatMap(l => l.rule_hits || []);
    return { summary: g.status === 'won' ? '最後は筋の通った話で押し切られた' : '話がまとまらなかった', tactics: [], insults: hits.includes('暴言') };
  }
}
function makeRecord(g, s) {
  return { boss: g.stage.id, bossName: g.stage.charName, rank: g.stage.rank, result: g.status, loseReason: g.loseReason || null,
    timeUsedSec: Math.min(g.limitSec, Math.round(((g.finishedAt || Date.now()) - g.startedAt) / 1000)), turns: g.turn, ...s, at: new Date().toISOString() };
}

// ───── ボスへの注入テキスト
const ago = (iso) => { const m = Math.round((Date.now() - Date.parse(iso)) / 60000); return m < 60 ? `${m}分前` : m < 1440 ? `${Math.round(m / 60)}時間前` : `${Math.round(m / 1440)}日前`; };
function noteForBattles(all, stage) {
  const mine = all.filter(b => b.boss === stage.id);
  const others = all.filter(b => b.boss !== stage.id);
  if (!mine.length && !others.length) return { text: '', rematch: false, rumors: false };
  const lines = [];
  if (mine.length) {
    lines.push(`# この若手との過去の対戦(あなた自身の記憶。今回は${mine.length + 1}回目の対面)`);
    for (const b of mine) lines.push(`- ${ago(b.at)}: ${RESULT_JA(b)}。${b.summary}${b.tactics.length ? ` / 使ってきた論点: ${b.tactics.join('、')}` : ''}${b.insults ? ' / 失礼な暴言を吐かれた' : ''}(${Math.round(b.timeUsedSec / 60)}分ほど話した)`);
    const tac = [...new Set(mine.flatMap(b => b.tactics))];
    lines.push(`- 前回のことは覚えている。会話の中で自然に触れてよい(例:「またお前か」「前回は〜の話ばかりだったな」)。`);
    if (tac.length) lines.push(`- 前回と同じ論点(${tac.join('、')})を同じように繰り返されたら「それは前にも聞いた」と受け流し、mood_delta は通常の半分程度に抑える(新しい根拠・新しい切り口が加わっていれば普通に評価してよい)。`);
    if (mine.some(b => b.insults)) lines.push('- 前回暴言を吐かれたことは根に持っている。最初は警戒している。');
  }
  if (!mine.length) lines.push('# この若手と直接話すのは今回が初めて(「またお前か」などとは言わない。噂で名前を知っている程度)');
  // 噂: 他のボスとの対戦結果(上位の役員ほど社内の噂が耳に入る)
  const heard = others.filter(b => b.rank < stage.rank || stage.rank >= 4).slice(-4);
  if (heard.length) {
    lines.push('# 社内の噂で聞いている、この若手の評判(本人に「聞いたぞ」と触れてもよい。誇張しない)');
    for (const b of heard) lines.push(`- ${ago(b.at)}、${b.bossName}${b.result === 'won' ? 'を説き伏せたらしい' : b.loseReason === 'time' ? 'との話し合いで時間切れになったらしい' : 'を怒らせて交渉決裂したらしい'}${b.tactics.length ? `(${b.tactics[0]}の話をしたとか)` : ''}${b.insults ? '。しかも暴言を吐いたという話だ' : ''}`);
  }
  return { text: lines.join('\n'), rematch: mine.length > 0, rumors: heard.length > 0 };
}
module.exports = { playerFromToken, newPlayer, trim, summarize, makeRecord, noteForBattles };
