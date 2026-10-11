// ボスの「過去の対戦の記憶」。プレイヤーID(署名付き)ごとに data/memory.json に保存(再起動しても残る)
// 保存方法に依存しない部分(署名・要約・ボスへの注入テキスト)は memory-core.js(Worker版と共有)
const fs = require('fs');
const path = require('path');
const C = require('./memory-core');

const DIR = path.join(__dirname, 'data');
const FILE = path.join(DIR, 'memory.json');
fs.mkdirSync(DIR, { recursive: true });

// ───── 保存
let db = { players: {} };
try { db = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { /* 初回 */ }
let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const tmp = FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(db, null, 1));
    fs.renameSync(tmp, FILE);
  }, 200);
}
function battles(pid) { return (pid && db.players[pid]?.battles) || []; }
function add(pid, rec) {
  const p = db.players[pid] || (db.players[pid] = { battles: [] });
  p.battles.push(rec);
  p.battles = C.trim(p.battles); save();
}
function reset(pid) { if (pid && db.players[pid]) { delete db.players[pid]; save(); } }

async function record(g, callLLM) {
  if (!g.playerId || g.memorized) return; g.memorized = true;
  const rec = C.makeRecord(g, await C.summarize(g, callLLM));
  add(g.playerId, rec);
  console.log(JSON.stringify({ memory: g.playerId.slice(0, 8), ...rec }));
  return rec;
}
const noteFor = (pid, stage) => C.noteForBattles(battles(pid), stage);
module.exports = { playerFromToken: C.playerFromToken, newPlayer: C.newPlayer, record, noteFor, reset, battles };
