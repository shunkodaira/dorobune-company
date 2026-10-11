// ボスのセリフ音声。TTS_PROVIDER=gemini|openai(既定: GEMINI_API_KEY があれば gemini、無ければ openai)
// ・gemini: Gemini TTS(Interactions API, gemini-3.8-flash-tts)。演技指示は speech_metadata.style に入れるので読み上げられない。
//   ストリーミング(24kHz/16bit/mono の生PCM)を受けながら WAV ヘッダを付けてそのまま流す(純JS・ffmpeg不要)
// ・gemini が失敗したら(ヘッダ送信前なら)自動で OpenAI TTS(gpt-4o-mini-tts, mp3)にフォールバック
// 同じセリフ・声・演技指示はディスクにキャッシュ
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const VOICES = require('./voices');

const OPENAI_MODEL = process.env.TTS_MODEL || 'gpt-4o-mini-tts';
const GEMINI_MODEL = process.env.GEMINI_TTS_MODEL || 'gemini-3.8-flash-tts';
// 無料枠はモデルごとに約3回/分。429 が出たら同じ声のまま Flash-Lite に切り替え、それも埋まっていたら OpenAI へ
const GEMINI_FALLBACK_MODEL = process.env.GEMINI_TTS_FALLBACK_MODEL || 'gemini-3.8-flash-lite-tts';
// 「retry in 21s」「retry in 18h55m19s」などから待ち秒数を読む(読めなければ60秒)
function retryAfterSec(msg) {
  const m = String(msg).match(/retry in ((?:\d+h)?(?:\d+m(?!s))?(?:[\d.]+s)?)/i);
  if (!m || !m[1]) return 60;
  const p = (u) => { const x = m[1].match(new RegExp('([\\d.]+)' + u)); return x ? +x[1] : 0; };
  return Math.max(5, Math.ceil(p('h') * 3600 + p('m(?!s)') * 60 + p('s')));
}
const cooldown = new Map(); // model → この時刻(ms)まで使わない
const CACHE = path.join(__dirname, 'tts-cache');
fs.mkdirSync(CACHE, { recursive: true });
const hasGemini = () => !!process.env.GEMINI_API_KEY;
const hasOpenAI = () => !!process.env.OPENAI_API_KEY;
const PROVIDER = () => {
  const p = (process.env.TTS_PROVIDER || '').toLowerCase();
  if (p === 'openai' && hasOpenAI()) return 'openai';
  if (p === 'gemini' && hasGemini()) return 'gemini';
  return hasGemini() ? 'gemini' : 'openai';
};
const enabled = () => (hasGemini() || hasOpenAI()) && process.env.TTS !== 'off';
// Gemini の声は少しゆったりなので、ブラウザ側で再生速度を上げる(TTS_PLAYBACK_RATE、既定1.1)。
// OpenAI にフォールバックした行は speed をその分下げて、体感速度をそろえる
const playbackRate = () => (PROVIDER() === 'gemini' ? Math.min(1.5, Math.max(0.8, +(process.env.TTS_PLAYBACK_RATE || 1.1))) : 1);
const modelName = () => (PROVIDER() === 'gemini' ? GEMINI_MODEL : OPENAI_MODEL);

// 読み上げ用に整形: ト書き(…)/（…）を除去、記号を整理
function clean(text) {
  return String(text || '')
    .replace(/[（(][^）)]{0,80}[）)]/g, '')
    .replace(/[「」『』]/g, '')
    .replace(/[<>]/g, '')
    .replace(/…+|\.{3,}/g, '…')
    .replace(/\n+/g, ' ')
    .trim()
    .slice(0, 1000);
}
const hash = (parts) => crypto.createHash('sha256').update(parts.join('\u0000')).digest('hex').slice(0, 32);

// ───── WAV(24kHz/16bit/mono)
const RATE = 24000;
function wavHeader(dataLen) {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(Math.min(0xffffffff, 36 + dataLen), 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(RATE, 24); h.writeUInt32LE(RATE * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(Math.min(0xffffffff - 36, dataLen), 40);
  return h;
}

// ───── OpenAI(mp3 をストリームで転送)
// gpt-4o-mini-tts はまれに最後の一文を読み落とすので、末尾に「……」の間を足す(実測: 足すと9/9で全文読了)
const PAD = '……';
const WAV_HEAD = { 'content-type': 'audio/wav', 'cache-control': 'private, max-age=86400' };
async function openaiSpeech(stageId, text, res, expr) {
  const v = VOICES[stageId] || VOICES.bucho;
  const ex = (VOICES.EXPR_STYLE || {})[expr];
  const instr = v.instructions + (ex ? ` この台詞は${ex}言う。` : '') + ' 最後の一文まで省略せずに読み切ること。';
  const speed = +(v.speed / playbackRate()).toFixed(2);
  // 生PCM → 長さの正しい WAV(Safari の Blob/WebAudio でも確実に再生できる形式。Worker 版と同じ)
  const file = path.join(CACHE, hash([VOICES.VERSION, 'v3', OPENAI_MODEL, v.voice, speed, instr, text]) + '.wav');
  if (fs.existsSync(file)) { res.writeHead(200, { ...WAV_HEAD, 'x-tts': 'openai;cache=hit', 'content-length': fs.statSync(file).size }); return fs.createReadStream(file).pipe(res); }
  const t0 = Date.now();
  const r = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: { authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model: OPENAI_MODEL, voice: v.voice, input: text + PAD, instructions: instr, speed, response_format: 'pcm' }),
  });
  if (!r.ok) throw new Error(`openai tts ${r.status} ${(await r.text()).slice(0, 200)}`);
  let pcm = Buffer.from(await r.arrayBuffer());
  if (pcm.length % 2) pcm = pcm.subarray(0, pcm.length - 1);
  if (!pcm.length) throw new Error('openai tts: no audio');
  const wav = Buffer.concat([wavHeader(pcm.length), pcm]);
  res.writeHead(200, { ...WAV_HEAD, 'x-tts': 'openai;cache=miss', 'content-length': wav.length }); res.end(wav);
  fs.writeFile(file + '.tmp', wav, (e) => { if (!e) fs.rename(file + '.tmp', file, () => {}); });
  console.log(JSON.stringify({ tts: stageId, provider: 'openai', voice: v.voice, chars: text.length, bytes: wav.length, totalMs: Date.now() - t0 }));
}

// ───── Gemini(SSE で生PCMを受け取り、WAVとして返す)
// stream=true: 最初の音が届いた時点でヘッダ(長さ不定)を送り、届いた分から流す(Chrome/Firefox向け)
// stream=false: 全部そろってから正しい長さのWAVを返す(Safari向け)
function geminiKey(stageId, text, expr) {
  const v = (VOICES.GEMINI || {})[stageId] || { voice: 'Charon', style: '早口で' };
  const style = [v.style, (VOICES.EXPR_STYLE || {})[expr]].filter(Boolean).join('、');
  return { v, style, file: path.join(CACHE, hash([VOICES.VERSION, 'g1', v.voice, style, text]) + '.wav') };
}
async function geminiSpeech(stageId, text, res, { expr, stream } = {}, MODEL = GEMINI_MODEL) {
  const { v, style, file } = geminiKey(stageId, text, expr);
  const head = WAV_HEAD;
  if (fs.existsSync(file)) { res.writeHead(200, { ...head, 'x-tts': 'gemini;cache=hit', 'content-length': fs.statSync(file).size }); return fs.createReadStream(file).pipe(res); }
  const t0 = Date.now();
  const ac = new AbortController();
  const firstTimer = setTimeout(() => ac.abort(), 9000); // 9秒たっても音が来なければ諦めてフォールバック
  const r = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
    method: 'POST', signal: ac.signal,
    headers: { 'x-goog-api-key': process.env.GEMINI_API_KEY, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: MODEL, stream: true,
      input: [{ type: 'user_input', content: [{ type: 'text', text, annotations: [{ type: 'speech_metadata', style }] }] }],
      response_format: { type: 'audio' },
      generation_config: { speech_config: [{ voice: v.voice }] },
    }),
  });
  if (!r.ok) {
    clearTimeout(firstTimer);
    const msg = (await r.text()).slice(0, 300);
    if (r.status === 429) cooldown.set(MODEL, Date.now() + retryAfterSec(msg) * 1000); // 無料枠: 分あたり/日あたりの上限あり
    else if (r.status === 401 || r.status === 403 || /API key/i.test(msg)) cooldown.set(MODEL, Date.now() + 600e3); // キー不正は10分間スキップ
    throw new Error(`gemini tts ${MODEL} ${r.status} ${msg.slice(0, 160)}`);
  }
  const pcm = []; let sent = false, first = 0, sse = '', carry = null, total = 0;
  const onPcm = (b) => {
    if (carry) { b = Buffer.concat([carry, b]); carry = null; }
    if (b.length % 2) { carry = b.subarray(b.length - 1); b = b.subarray(0, b.length - 1); }
    if (!b.length) return;
    if (!first) { first = Date.now() - t0; clearTimeout(firstTimer); }
    pcm.push(b); total += b.length;
    if (stream) {
      if (!sent) { res.writeHead(200, { ...head, 'x-tts': 'gemini;cache=miss;stream' }); res.write(wavHeader(0xffffffff - 44)); sent = true; }
      res.write(b);
    }
  };
  try {
    for await (const c of r.body) {
      sse += Buffer.from(c).toString('utf8');
      let i;
      while ((i = sse.indexOf('\n\n')) >= 0) {
        const ev = sse.slice(0, i); sse = sse.slice(i + 2);
        for (const line of ev.split('\n')) {
          if (!line.startsWith('data:')) continue;
          let j; try { j = JSON.parse(line.slice(5)); } catch { continue; }
          if (j.event_type === 'step.delta' && j.delta && j.delta.type === 'audio' && j.delta.data) onPcm(Buffer.from(j.delta.data, 'base64'));
          if (j.error) throw new Error('gemini tts stream error ' + JSON.stringify(j.error).slice(0, 200));
        }
      }
    }
  } catch (e) {
    clearTimeout(firstTimer);
    if (sent) { res.end(); console.error('[tts gemini] stream broke after start:', e.message); return; } // 途中まで流した分はそのまま
    throw e;
  }
  clearTimeout(firstTimer);
  if (!total) throw new Error('gemini tts: no audio');
  const wav = Buffer.concat([wavHeader(total), ...pcm]);
  if (sent) res.end();
  else { res.writeHead(200, { ...head, 'x-tts': 'gemini;cache=miss', 'content-length': wav.length }); res.end(wav); }
  fs.writeFile(file + '.tmp', wav, (e) => { if (!e) fs.rename(file + '.tmp', file, () => {}); });
  console.log(JSON.stringify({ tts: stageId, provider: 'gemini', model: MODEL, voice: v.voice, expr, stream: !!stream, chars: text.length, sec: +(total / (RATE * 2)).toFixed(2), firstAudioMs: first, totalMs: Date.now() - t0 }));
}

async function streamSpeech(stageId, rawText, res, opts = {}) {
  const text = clean(rawText);
  if (!text) { res.writeHead(204); return res.end(); }
  if (PROVIDER() === 'gemini') {
    // キャッシュ(声・演技指示・本文が同じなら Flash/Flash-Lite どちらの音でも再利用)
    const cached = geminiKey(stageId, text, opts.expr).file;
    if (fs.existsSync(cached)) { res.writeHead(200, { ...WAV_HEAD, 'x-tts': 'gemini;cache=hit', 'content-length': fs.statSync(cached).size }); return fs.createReadStream(cached).pipe(res); }
    for (const model of [GEMINI_MODEL, GEMINI_FALLBACK_MODEL].filter((m, i, a) => m && a.indexOf(m) === i)) {
      if ((cooldown.get(model) || 0) > Date.now()) continue;
      try { return await geminiSpeech(stageId, text, res, opts, model); }
      catch (e) { console.error('[tts gemini fallback]', e.message); if (res.headersSent) return; }
    }
    if (!hasOpenAI()) { res.writeHead(502, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ error: 'tts failed' })); }
    console.error('[tts] gemini unavailable → OpenAI TTS');
  }
  try { return await openaiSpeech(stageId, text, res, opts.expr); }
  catch (e) {
    console.error('[tts error]', e.message);
    if (!res.headersSent) { res.writeHead(502, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: 'tts failed' })); }
  }
}
module.exports = { streamSpeech, enabled, clean, PROVIDER, modelName, playbackRate, get MODEL() { return modelName(); }, VOICES };
