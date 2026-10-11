// ボスのセリフを OpenAI TTS で音声化(/v1/audio/speech, gpt-4o-mini-tts)。同じセリフはディスクにキャッシュ
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const VOICES = require('./voices');

const MODEL = process.env.TTS_MODEL || 'gpt-4o-mini-tts';
const CACHE = path.join(__dirname, 'tts-cache');
fs.mkdirSync(CACHE, { recursive: true });
const enabled = () => !!process.env.OPENAI_API_KEY && process.env.TTS !== 'off';

// 読み上げ用に整形: ト書き(…)/（…）を除去、記号を整理
function clean(text) {
  return String(text || '')
    .replace(/[（(][^）)]{0,80}[）)]/g, '')
    .replace(/[「」『』]/g, '')
    .replace(/…+|\.{3,}/g, '…')
    .replace(/\n+/g, ' ')
    .trim()
    .slice(0, 1000);
}
// gpt-4o-mini-tts はまれに最後の一文を読み落とすので、末尾に「……」の間を足す(実測: 足すと9/9で全文読了)
const PAD = '……';
const keyOf = (stageId, text) => {
  const v = VOICES[stageId] || VOICES.bucho;
  return crypto.createHash('sha256').update(['v2', MODEL, v.voice, v.speed, v.instructions, text].join('\u0000')).digest('hex').slice(0, 32);
};

// res に mp3 をストリームで返す(初回は OpenAI から受けつつ転送、終わったらキャッシュに保存)
async function streamSpeech(stageId, rawText, res) {
  const text = clean(rawText);
  if (!text) { res.writeHead(204); return res.end(); }
  const file = path.join(CACHE, keyOf(stageId, text) + '.mp3');
  const head = { 'content-type': 'audio/mpeg', 'cache-control': 'private, max-age=86400' };
  if (fs.existsSync(file)) { res.writeHead(200, { ...head, 'x-tts-cache': 'hit', 'content-length': fs.statSync(file).size }); return fs.createReadStream(file).pipe(res); }
  const v = VOICES[stageId] || VOICES.bucho;
  const t0 = Date.now();
  const r = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: { authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model: MODEL, voice: v.voice, input: text + PAD, instructions: v.instructions + ' 最後の一文まで省略せずに読み切ること。', speed: v.speed, response_format: 'mp3' }),
  });
  if (!r.ok) {
    const msg = (await r.text()).slice(0, 300);
    console.error('[tts error]', r.status, msg);
    res.writeHead(502, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ error: 'tts failed', status: r.status }));
  }
  res.writeHead(200, { ...head, 'x-tts-cache': 'miss' });
  const chunks = []; let first = 0;
  for await (const c of r.body) { if (!first) first = Date.now() - t0; chunks.push(Buffer.from(c)); res.write(c); }
  res.end();
  const buf = Buffer.concat(chunks);
  fs.writeFile(file + '.tmp', buf, (e) => { if (!e) fs.rename(file + '.tmp', file, () => {}); });
  console.log(JSON.stringify({ tts: stageId, voice: v.voice, chars: text.length, bytes: buf.length, firstByteMs: first, totalMs: Date.now() - t0 }));
}
module.exports = { streamSpeech, enabled, clean, MODEL, VOICES };
