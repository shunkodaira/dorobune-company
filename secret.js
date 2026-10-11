// 署名用の秘密鍵。Node版は .secret ファイル(無ければ生成)、Cloudflare Worker版は RANK_SECRET(Worker secret)を使う
let cached = null;
function get() {
  if (cached) return cached;
  if (process.env.RANK_SECRET) return (cached = process.env.RANK_SECRET);
  const fs = require('fs'), path = require('path'), crypto = require('crypto');
  const file = path.join(__dirname, '.secret');
  if (!fs.existsSync(file)) fs.writeFileSync(file, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
  return (cached = fs.readFileSync(file, 'utf8').trim());
}
function set(v) { cached = v; }
module.exports = { get, set };
