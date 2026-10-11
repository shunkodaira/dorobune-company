// ボスの表情(立ち絵の差分)。LLMが返す expression を検証し、無効ならゲージの動きから決める
const EXPRS = { yoyu: '余裕', takurami: '企み', aseri: '焦り', odoroki: '驚き', ikari: '怒り', nattoku: '納得' };
const BY_LABEL = Object.fromEntries(Object.entries(EXPRS).map(([k, v]) => [v, k]));
// ボスごとの癖: 開幕の顔 / 大きく動いた時 / 勝利目前 / 決着
const PROFILE = {
  kakaricho: { open: 'yoyu', rise: 'odoroki', near: 'nattoku', win: 'nattoku', mid: 'yoyu' },
  kacho: { open: 'yoyu', rise: 'odoroki', near: 'nattoku', win: 'nattoku', mid: 'yoyu' },
  bucho: { open: 'yoyu', rise: 'odoroki', near: 'nattoku', win: 'nattoku', mid: 'yoyu' },
  joumu: { open: 'takurami', rise: 'aseri', near: 'aseri', win: 'aseri', mid: 'takurami' },
  senmu: { open: 'takurami', rise: 'odoroki', near: 'nattoku', win: 'nattoku', mid: 'yoyu' },
  shacho: { open: 'yoyu', rise: 'odoroki', near: 'nattoku', win: 'nattoku', mid: 'yoyu' },
};
const prof = (id) => PROFILE[id] || PROFILE.bucho;
const parse = (v) => (v in EXPRS ? v : BY_LABEL[String(v || '').trim()] || null);
const opening = (id) => prof(id).open;
const timeUp = (id) => (prof(id).open === 'takurami' ? 'takurami' : 'yoyu');

// ゲージ変化からの既定値
function fromDelta(id, delta, gauge) {
  const p = prof(id);
  if (delta <= -10) return 'ikari';
  if (delta < 0) return gauge < 40 ? 'ikari' : p.mid;
  if (gauge >= 80) return p.near;
  if (delta >= 15) return p.rise;
  if (gauge >= 55 && delta >= 5) return id === 'joumu' ? 'aseri' : 'nattoku';
  return p.mid;
}

// LLMの提案を採用するか(ゲージの動きと矛盾していれば既定値)
function pick(id, llmExpr, delta, gauge, status) {
  const p = prof(id);
  if (status === 'won') return p.win;
  if (status === 'lost') return 'ikari';
  const def = fromDelta(id, delta, gauge);
  const e = parse(llmExpr);
  if (!e) return def;
  if (delta <= -10 && !['ikari', 'takurami'].includes(e)) return def; // 大きく下がったのに上機嫌はおかしい
  if (delta >= 10 && e === 'ikari') return def; // 大きく上がったのに怒りはおかしい
  if (delta < 0 && e === 'nattoku') return def;
  if (gauge >= 80 && delta >= 0 && !['aseri', 'nattoku', 'odoroki'].includes(e)) return p.near;
  return e;
}

module.exports = { EXPRS, parse, pick, opening, timeUp, fromDelta };
