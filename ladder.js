// 出世の階段: 7段の役職と、各役職のボス(係長〜社長)。難易度は役職が上がるほど上昇
const VOICES = require('./voices');
const { STAGES: LEGACY, COMMON_INJECTION } = require('./stages');
const { BOSSES } = require('./bosses');

const RANKS = ['一般社員', '係長', '課長', '部長', '常務', '専務', '社長'];

// 役職ごとの難易度: 初期ゲージ / delta上限 / 制限時間(分) / 基礎点
const DIFF = {
  1: [38, 33, 10], 2: [36, 31, 12], 3: [33, 28, 14], 4: [33, 24, 15], 5: [32, 22, 15], 6: [26, 19, 15], // [開始ゲージ, delta上限, 制限分]
};
const THEME = (r) => (r <= 2 ? 'blue' : r <= 3 ? 'cyan' : r <= 5 ? 'crimson' : 'gold');

const STAGES = {};
for (const b of [...BOSSES, LEGACY.bucho, LEGACY.joumu]) {
  const [start, deltaMax, min] = DIFF[b.rank];
  STAGES[b.id] = {
    ...b, voice: VOICES[b.id], start, deltaMax, deltaMin: -30, timeLimitSec: min * 60, scoreBase: 300 * b.rank,
    theme: THEME(b.rank), rankName: RANKS[b.rank], promoteTo: RANKS[b.rank],
    showScene: b.rank <= 3, // 役員クラスは「気になるもの」なし(難化)
  };
}
const BY_RANK = {};
for (const s of Object.values(STAGES)) BY_RANK[s.rank] = s;

// 飛び級(+2)挑戦の補正: 初期ゲージ-5 / delta上限-3 / 時間-2分 / スコア×1.5
const JUMP = { start: -5, deltaMax: -3, timeSec: -120, scoreMul: 1.5 };

module.exports = { RANKS, STAGES, BY_RANK, JUMP, COMMON_INJECTION };
