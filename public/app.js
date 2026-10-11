// 泥舟カンパニー — クライアント
const $ = (id) => document.getElementById(id);
const RANK_KEY = 'dorobune-rank';
const getRankToken = () => localStorage.getItem(RANK_KEY) || '';
const VOICE_KEY = 'dorobune-voice2'; // v2: 既存ユーザーも一度だけ音声ONに戻す
localStorage.removeItem('dorobune-voice');
const PLAYER_KEY = 'dorobune-player'; // ボスの「過去の対戦の記憶」用のプレイヤーID(サーバ署名)
const getPlayer = () => localStorage.getItem(PLAYER_KEY) || '';
const STEP_COLORS = ['#f2f2f2', '#fff6c2', '#ffef8f', '#ffe75a', '#ffdd2a', '#ffd400', '#f5c400'];
let ladder = null, stageInfo = null, state = null, busy = false, timerId = null, deadline = 0, tts = localStorage.getItem(VOICE_KEY) !== 'off', serverTts = false, timeoutSent = false, pendingStage = null;

// ───── 波形
const BARS = 22;
for (const w of ['waveL', 'waveR']) for (let i = 0; i < BARS; i++) $(w).appendChild(document.createElement('span'));
let level = 0.15;
setInterval(() => {
  document.querySelectorAll('.wave span').forEach((s, i) => {
    const center = 1 - Math.abs((i % BARS) - BARS / 2) / (BARS / 2);
    s.style.height = (4 + Math.random() * 34 * level * (0.4 + center)) + 'px';
  });
}, 110);
const esc = (t) => String(t ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const post = (p, b) => fetch(p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b || {}) }).then(r => r.json());
const mmss = (sec) => `${Math.floor(sec / 60)}分${String(sec % 60).padStart(2, '0')}秒`;

// ───── 出世の階段
async function loadLadder() {
  stopRec(); clearInterval(timerId); stopVoice(); window.BGM && BGM.enter();
  ladder = await post('/api/ladder', { rankToken: getRankToken(), playerToken: getPlayer() });
  if (ladder.playerToken) localStorage.setItem(PLAYER_KEY, ladder.playerToken);
  $('provider').textContent = `LLM: ${ladder.provider}`;
  $('selectRank').textContent = ladder.rankName + (ladder.clear ? '(GAME CLEAR!)' : '');
  const n = ladder.steps.length;
  $('ladder').innerHTML = ladder.steps.map((s, i) => {
    const h = 40 + (i / (n - 1)) * 60;
    const cls = ['step', s.rank === ladder.rank ? 'current' : '', s.challengeable ? 'open' : '', s.rank < ladder.rank ? 'done' : '', !s.challengeable && s.rank > ladder.rank ? 'locked' : ''].join(' ');
    const badge = s.challengeable ? `<div class="st-badge ${s.boss.jump ? 'jump' : ''}">${s.boss.jump ? '+2 飛び級' : '+1 挑戦'}</div>` : '';
    const face = s.boss && (s.challengeable || s.rank < ladder.rank) ? `<img class="st-face" src="img/face_${s.boss.id}.jpg" alt="">` : (s.boss && s.rank > ladder.rank ? '<div class="st-lock">🔒</div>' : '');
    const me = s.rank === ladder.rank ? (ladder.clear ? '<div class="me">👑<span>社長!</span></div>' : '<div class="me">🚶<span>あなた</span></div>') : '';
    return `<div class="${cls}" data-rank="${s.rank}" style="--h:${h}%;--c:${STEP_COLORS[i % STEP_COLORS.length]}">${me}<div class="st-top">${badge}${face}</div><div class="st-name">${esc(s.name)}</div>${s.rank < ladder.rank && s.rank > 0 ? '<div class="st-check">✓</div>' : ''}</div>`;
  }).join('');
  document.querySelectorAll('.step.open').forEach(el => el.onclick = () => openChallenge(ladder.steps[Number(el.dataset.rank)]));
  $('result').classList.add('hidden'); $('challenge').classList.add('hidden'); $('select').classList.remove('hidden');
}
function openChallenge(step) {
  const b = step.boss; pendingStage = b.id;
  $('chFace').src = `img/face_${b.id}.jpg`;
  $('chBadge').textContent = b.jump ? `+2 飛び級チャレンジ(難易度UP・スコア×1.5)` : `+1 昇進チャレンジ`;
  $('chBadge').className = 'ch-badge ' + (b.jump ? 'jump' : '');
  $('chName').textContent = b.charName; $('chSub').textContent = b.charSub;
  $('chGoal').textContent = b.goal;
  $('chMeta').textContent = `⏱ 制限時間 ${Math.round(b.timeLimitSec / 60)}分 / 勝てば「${step.name}」に昇進、負ければ1段降格`;
  document.querySelector('.challenge-box').dataset.theme = b.theme;
  $('challenge').classList.remove('hidden');
}
$('chBack').onclick = () => $('challenge').classList.add('hidden');
$('chGo').onclick = () => start(pendingStage);
$('memResetBtn').onclick = async () => {
  if (!confirm('上司たちの「あなたとの過去の対戦の記憶」と社内の噂を消しますか？(役職はそのまま)')) return;
  await post('/api/memory/reset', { playerToken: getPlayer() }); alert('記憶をリセットしました。上司たちはあなたのことを忘れました。');
};
// ───── 対戦が見つからない(サーバ側で失効など)時: 生のエラーは出さず、キャラのまま案内する
const GONE_LINE = '……おっと、すまない。急な呼び出しで、話の途中だったのを忘れてしまった。悪いが、もう一度最初から聞かせてもらえるかな。';
const BUSY_LINE = (label) => `……(${label}は電話に出てしまった。少し待ってから、もう一度話しかけよう)`;
function gameGone() {
  clearInterval(timerId); stopRec(); stopVoice(); hideHints();
  if (state) state = { ...state, status: 'gone' };
  setNpc(GONE_LINE); setSteps(0); $('lostBox').classList.remove('hidden');
  $('sendBtn').disabled = true; $('micBtn').disabled = true;
}
$('lostRetry').onclick = () => { $('lostBox').classList.add('hidden'); start(stageInfo.id); };
$('lostLadder').onclick = () => { $('lostBox').classList.add('hidden'); loadLadder(); };
$('resetBtn').onclick = () => { if (confirm('役職をリセットして一般社員からやり直しますか？')) { localStorage.removeItem(RANK_KEY); loadLadder(); } };

// ───── 対戦
// ---- ボスの表情差分(余裕/企み/焦り/驚き/怒り/納得)。切り替えは約250msのクロスフェード ----
let curExpr = null, exprSeq = 0; const exprCache = {};
const exprSrc = (e) => (stageInfo.img.sprite ? `img/${stageInfo.img.sprite}_${e}.webp` : `img/${stageInfo.img.bg}_${e}.jpg`);
const exprFace = (e) => `img/face_${stageInfo.id}_${e}.jpg`;
function loadImg(src) {
  if (!exprCache[src]) { const im = new Image(); im.src = src; exprCache[src] = (im.decode ? im.decode() : Promise.resolve()).catch(() => {}); }
  return exprCache[src];
}
function preloadExprs() { for (const e of stageInfo.exprs || []) { loadImg(exprSrc(e)); loadImg(exprFace(e)); } }
async function setExpr(e, instant) {
  if (!e || !stageInfo || !(stageInfo.exprs || []).includes(e) || e === curExpr) return;
  curExpr = e; const seq = ++exprSeq; const src = exprSrc(e), sprite = !!stageInfo.img.sprite;
  document.body.dataset.expr = e;
  await Promise.all([loadImg(src), loadImg(exprFace(e))]);
  if (seq !== exprSeq) return;
  $('faceImg').src = exprFace(e);
  const base = sprite ? $('sprite') : $('bg'), top = sprite ? $('sprite2') : $('bg2');
  const setBase = () => { if (sprite) base.src = src; else base.style.backgroundImage = `url(${src})`; };
  if (instant) { setBase(); return; }
  top.classList.remove('fade'); top.style.opacity = 0;
  if (sprite) top.src = src; else top.style.backgroundImage = `url(${src})`;
  void top.offsetWidth; top.classList.add('fade'); top.style.opacity = 1;
  setTimeout(() => { if (seq !== exprSeq) return; setBase(); requestAnimationFrame(() => { top.classList.remove('fade'); top.style.opacity = 0; }); }, 270);
}

async function start(stageId) {
  window.BGM && BGM.leave(); // ボスの声と被らないようにロビーBGMはフェードアウト
  $('lostBox').classList.add('hidden'); $('sendBtn').disabled = false; $('micBtn').disabled = false;
  stopRec();
  const q = new URLSearchParams(location.search).get('weakness'); // テスト用(サーバが ALLOW_FORCE_WEAKNESS のときのみ有効)
  const s = await post('/api/new', { stage: stageId, rankToken: getRankToken(), playerToken: getPlayer(), weakness: q || undefined });
  if (s.error) { alert(s.error === 'locked' ? 'この相手にはまだ挑戦できません' : s.error); return loadLadder(); }
  stageInfo = s.stageInfo; serverTts = !!s.tts;
  document.body.className = 'theme-' + stageInfo.theme + (stageInfo.showScene ? '' : ' no-scene');
  $('bg').style.backgroundImage = `url(img/${stageInfo.img.bg}.jpg)`;
  for (const id of ['sprite', 'sprite2']) $(id).classList.toggle('hidden', !stageInfo.img.sprite);
  if (stageInfo.img.sprite) $('sprite').src = `img/${stageInfo.img.sprite}.webp`;
  preloadExprs(); curExpr = null; setExpr(s.history[0] && s.history[0].expr, true);
  $('titleMain').textContent = stageInfo.rank === 6 ? '最終決戦' : `${stageInfo.rankName}戦`;
  $('objective').textContent = stageInfo.objective;
  if (!curExpr) $('faceImg').src = `img/face_${stageInfo.id}.jpg`;
  $('npcName').textContent = stageInfo.charName;
  $('gaugeLabel').textContent = stageInfo.gaugeLabel;
  startHints(stageInfo.tips);
  $('scene').innerHTML = s.scene.map(t => `<li>${esc(t)}</li>`).join('');
  $('select').classList.add('hidden'); $('challenge').classList.add('hidden'); $('result').classList.add('hidden');
  $('playerLine').classList.add('hidden'); $('delta').textContent = '';
  render(s); hideHints(); setHintCount(s.hintsLeft ?? 3);
  setNpc(stageInfo.intro + '\n\n' + s.history[0].text);
  speakLine(0, s.history[0].text);
  deadline = Date.now() + s.timeLeft * 1000; timeoutSent = false;
  clearInterval(timerId); timerId = setInterval(tick, 500); tick();
  setSteps(0);
}
function tick() {
  const left = Math.max(0, Math.round((deadline - Date.now()) / 1000));
  $('timer').textContent = `${String(Math.floor(left / 60)).padStart(2, '0')}:${String(left % 60).padStart(2, '0')}`;
  $('timer').classList.toggle('warn', left <= 60);
  if (left <= 0 && state && state.status === 'playing' && !timeoutSent) {
    // クライアントのタイマーが0 → サーバに確認(判定はサーバの経過時間)
    timeoutSent = true;
    post('/api/timeout', { id: state.id }).then(s => {
      if (s.error === 'game not found') return gameGone();
      if (s.status !== 'playing') onGameOverFromServer(s);
      else { deadline = Date.now() + s.timeLeft * 1000 + 300; timeoutSent = false; }
    }).catch(() => { timeoutSent = false; });
  }
}
function onGameOverFromServer(s) {
  if (state && state.status !== 'playing') return;
  stopRec(); busy = false;
  $('npcText').classList.remove('thinking');
  setNpc(s.history[s.history.length - 1].text);
  speakLine(s.history.length - 1, s.history[s.history.length - 1].text);
  render(s);
}
function setNpc(text) {
  $('npcText').classList.remove('thinking'); $('npcText').textContent = text; $('npcText').scrollTop = 0;
}
// ───── ボスの声: サーバの OpenAI TTS(/api/tts, ストリーム再生)。失敗したらブラウザの speechSynthesis
// 1つの <audio> を使い回す(最初のクリック/キーで「解錠」→ 以後は自動再生できる)。新しい台詞は前の台詞を止める
const voiceEl = new Audio(); voiceEl.preload = 'auto';
const SILENT = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';
let voiceSeq = 0, unlocked = false, pendingVoice = null, audioCtx = null;
function unlockAudio() {
  if (unlocked) return; unlocked = true;
  try { audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)(); audioCtx.resume(); } catch {}
  if (!voiceEl.src || voiceEl.src === SILENT || voiceEl.paused) { voiceEl.src = SILENT; voiceEl.play().catch(() => {}); }
}
['pointerdown', 'keydown', 'touchstart'].forEach(ev => window.addEventListener(ev, unlockAudio, { capture: true }));
function stopVoice() { voiceSeq++; pendingVoice = null; voiceEl.pause(); if ('speechSynthesis' in window) speechSynthesis.cancel(); $('voicePrompt')?.classList.add('hidden'); }
function speakLine(idx, text) {
  stopVoice();
  if (!tts || !text) return;
  if (!serverTts || !state) return say(text);
  const seq = voiceSeq, url = `/api/tts?id=${encodeURIComponent(state.id)}&i=${idx}`;
  let fell = false;
  const fallback = () => { if (fell || seq !== voiceSeq) return; fell = true; say(text); };
  voiceEl.onerror = () => { if (seq === voiceSeq && voiceEl.src.includes('/api/tts')) fallback(); };
  voiceEl.src = url;
  voiceEl.play().catch((e) => {
    if (seq !== voiceSeq) return;
    if (e && e.name === 'NotAllowedError') { pendingVoice = { idx, text }; $('voicePrompt').classList.remove('hidden'); return; } // 自動再生ブロック → ワンタップで再生
    if (e && e.name === 'AbortError') return;
    fallback();
  });
}
$('voicePrompt').onclick = () => { const p = pendingVoice; $('voicePrompt').classList.add('hidden'); unlocked = false; unlockAudio(); if (p) speakLine(p.idx, p.text); };
function say(text) {
  if (!('speechSynthesis' in window)) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text.replace(/[…]/g, '、'));
  u.lang = 'ja-JP'; u.pitch = 0.7; u.rate = 1.0;
  const v = speechSynthesis.getVoices().find(v => v.lang.startsWith('ja'));
  if (v) u.voice = v;
  speechSynthesis.speak(u);
}
function render(s, last) {
  state = s;
  const lastNpc = [...s.history].reverse().find(h => h.role === 'npc'); if (lastNpc) setExpr(lastNpc.expr);
  $('gaugeNum').textContent = s.gauge; $('gaugeBar').style.width = s.gauge + '%';
  $('gaugeBar').style.backgroundPosition = `${-s.gauge * 2}px 0`;
  let f = stageInfo.faces[0][1]; for (const [m, e] of stageInfo.faces) if (s.gauge >= m) f = e; $('face').textContent = f;
  if (last) {
    const d = $('delta'); d.className = 'delta ' + (last.delta > 0 ? 'up' : last.delta < 0 ? 'down' : '');
    d.textContent = `${last.delta > 0 ? '▲ +' : last.delta < 0 ? '▼ ' : '± '}${last.delta}　${last.reason || ''}`;
    if (last.delta < 0) { const b = document.querySelector('.bubble'); b.classList.remove('shake'); void b.offsetWidth; b.classList.add('shake'); }
  }
  if (s.status !== 'playing') {
    clearInterval(timerId);
    if (s.loseReason === 'time') $('timer').textContent = '00:00';
    if (s.rankToken) localStorage.setItem(RANK_KEY, s.rankToken); // 役職(署名付き)を保存
    setTimeout(() => showResult(s), s.loseReason === 'time' ? 3500 : 1800);
  }
}
// 進行状況は音声パネルの案内文で表示(0=待機 1=話す 2=解析 3=応答)
function setSteps(n) {
  if (recOn && n !== 2) return;
  const npc = stageInfo ? stageInfo.npcLabel : '上司';
  $('vpMsg').textContent = ['話したいことを、マイクに向かって話してください', '🎙️ 話す → AIが内容を解析 → ' + npc + 'が応答', '⏳ AIが内容を解析中…', '💬 ' + npc + 'が応答しました'][n];
  $('vpMsg').classList.toggle('active', n > 0);
}
let hintTimer = null;
function startHints(tips) {
  clearInterval(hintTimer); let i = 0;
  const show = () => { $('input').placeholder = 'ヒント:' + tips[i % tips.length]; i++; };
  show(); hintTimer = setInterval(show, 5000);
}
async function sendText(text) {
  text = text.trim();
  if (!text || busy || !state || state.status !== 'playing') return;
  busy = true; hideHints(); $('sendBtn').disabled = true; $('micBtn').disabled = true; $('input').value = '';
  $('playerLine').textContent = text; $('playerLine').classList.remove('hidden');
  setSteps(2); level = 0.35;
  $('npcText').classList.add('thinking'); $('npcText').textContent = `……(${stageInfo.npcLabel}は黙ってこちらを見ている)`;
  try {
    const s = await post('/api/turn', { id: state.id, text });
    if (s.error === 'game not found') { gameGone(); return; }
    if (s.error && !s.history) { setNpc(BUSY_LINE(stageInfo.npcLabel)); $('input').value = text; return; }
    if (s.error) { $('playerLine').textContent = text + '\n(時間切れ:この発言は届かなかった)'; busy = false; onGameOverFromServer(s); return; }
    if (s.status === 'playing') deadline = Date.now() + s.timeLeft * 1000;
    setSteps(3);
    setNpc(s.history[s.history.length - 1].text);
    speakLine(s.history.length - 1, s.history[s.history.length - 1].text);
    render(s, s.last);
  } catch (err) { console.warn('turn failed', err); setNpc(BUSY_LINE(stageInfo.npcLabel)); $('input').value = text; }
  finally { busy = false; level = 0.15; $('sendBtn').disabled = false; $('micBtn').disabled = false; setTimeout(() => setSteps(0), 2500); }
}

// ───── ヒント(サーバのLLMが切り返し案を2〜3個。1戦3回まで・1回ごとにスコア-150)
function setHintCount(n) { $('hintLeft').textContent = n; $('hintBtn').disabled = n <= 0; $('hintBtn').classList.toggle('empty', n <= 0); }
function hideHints() { $('hintBox').classList.add('hidden'); }
$('hintClose').onclick = hideHints;
$('hintBtn').onclick = async () => {
  if (!state || state.status !== 'playing' || $('hintBtn').disabled) return;
  if (state.hintsUsed === undefined || !$('hintBox').dataset.warned) {
    if (!confirm(`ヒントを使いますか？(残り${$('hintLeft').textContent}回・使うたびにスコア -150)`)) return;
    $('hintBox').dataset.warned = '1';
  }
  $('hintBtn').disabled = true; $('hintBtn').classList.add('loading');
  $('hintList').innerHTML = '<div class="hb-loading">考え中…</div>'; $('hintBox').classList.remove('hidden');
  try {
    const r = await post('/api/hint', { id: state.id });
    if (r.error === 'game not found') { gameGone(); return; }
    if (r.error) { $('hintList').innerHTML = `<div class="hb-loading">${r.error === 'no hints left' ? 'ヒントはもう使い切った…' : 'ヒントを出せませんでした'}</div>`; if (r.hintsLeft === 0) setHintCount(0); return; }
    state.hintsUsed = 3 - r.hintsLeft;
    setHintCount(r.hintsLeft);
    $('hintList').innerHTML = r.hints.map((h, i) => `<button type="button" class="hb-item" data-i="${i}"><span class="hb-angle">${esc(h.angle)}</span><span class="hb-line">${esc(h.line)}</span></button>`).join('');
    document.querySelectorAll('.hb-item').forEach(el => el.onclick = () => { $('input').value = r.hints[Number(el.dataset.i)].line; $('input').focus(); hideHints(); setSteps(1); });
  } catch (e) { $('hintList').innerHTML = '<div class="hb-loading">通信エラー</div>'; }
  finally { $('hintBtn').classList.remove('loading'); if (Number($('hintLeft').textContent) > 0) $('hintBtn').disabled = false; }
};

// ───── 結果画面
function jireiHTML(s) {
  const demote = s.rankAfter !== s.rankBefore ? `<b>${esc(s.rankAfter)}</b>に降格のうえ、` : '';
  return `<div class="jirei"><h4>辞令</h4>${esc(s.rankBefore)} あなた 殿<br>来月一日付で${demote}<b>${esc(s.exile)}</b>への異動を命ずる。<div class="jirei-sign">${s.exileSigner.startsWith('泥舟カンパニー') ? esc(s.exileSigner).replace(' ', '<br>') : '泥舟カンパニー<br>' + esc(s.exileSigner)}<span class="seal">印</span></div></div>`;
}
function showResult(s) {
  const won = s.status === 'won', timeUp = s.loseReason === 'time', isJoumu = s.stage === 'joumu';
  let v = '';
  if (won) v = isJoumu ? '<div class="jihyo"><span>辞表</span><small>大和瀬</small></div>' : `<div class="stamp"><span>${esc(stageInfo.stampText)}</span><small>${esc(stageInfo.charName.split(' ')[0])}</small></div>`;
  else {
    const base = timeUp ? `<div class="timeup"><img src="img/${['crimson', 'gold'].includes(stageInfo.theme) ? 'empty_joumu' : 'empty_bucho'}.jpg" alt=""><span>時間切れ</span></div>` : '<div class="rejected">決裂</div>';
    v = `<div class="fail-stack">${base}<div class="jirei-wrap late">${jireiHTML(s)}</div></div>`;
  }
  $('visual').innerHTML = v;
  $('clearBanner').classList.toggle('hidden', !s.gameClear);
  $('resultTitle').textContent = won ? stageInfo.winTitle : timeUp ? stageInfo.timeUpTitle : stageInfo.loseTitle;
  $('resultMsg').textContent = won
    ? (s.gameClear ? '泥舟カンパニーの頂点に立った！ あなたが新しい社長だ！' : `${stageInfo.charName}を説得した！${s.jump ? '(飛び級成功！)' : ''}`)
    : timeUp ? `時間切れ。${stageInfo.npcLabel}は次の予定へ去っていった…そして届いた左遷の辞令。`
    : `${stageInfo.npcLabel}との交渉は決裂。あなたは左遷されてしまった…`;
  $('score').innerHTML = (won ? `SCORE ${s.score} 点${s.jump ? ' <small>(飛び級×1.5)</small>' : ''}${s.hintsUsed ? ` <small>(ヒント${s.hintsUsed}回 −${s.hintsUsed * 150})</small>` : ''}` : 'SCORE 0 点') + `<span class="time-used">⏱ 使用時間 ${mmss(s.timeUsed)}${won ? '(残り ' + mmss(s.timeLeft) + ' × 2点ボーナス)' : ''}</span>`;
  const rc = $('rankChange');
  rc.className = 'rank-change ' + (won ? 'promo' : 'demo');
  rc.innerHTML = won
    ? `<div class="rc-head">🎉 発令</div><div class="rc-row"><span class="rc-before">${esc(s.rankBefore)}</span><span class="rc-arrow">➜</span><span class="rc-after">${esc(s.rankAfter)}</span></div><div class="rc-note">${s.gameClear ? '本日付をもって <b>代表取締役社長</b> に任ずる' : `本日付をもって <b>${esc(s.rankAfter)}</b> に任ずる`} <span class="seal">印</span></div>`
    : `<div class="rc-head">📉 左遷${s.rankAfter !== s.rankBefore ? '・降格' : ''}</div><div class="rc-row"><span class="rc-same">${esc(s.rankBefore)}</span><span class="rc-arrow">➜</span><span class="rc-exile">${esc(s.rankAfter)}(${esc(s.exile.replace(/\(.*\)$/, ''))})</span></div>`;
  $('reveal').textContent = `${stageInfo.npcLabel}の弱点は「${s.weakness}」だった`;
  // もう一回: 新しい役職からまだ挑戦できる相手なら表示
  $('retryBtn').classList.add('hidden');
  post('/api/ladder', { rankToken: getRankToken() }).then(l => { const st = l.steps.find(x => x.boss && x.boss.id === s.stage); if (st && st.challengeable) $('retryBtn').classList.remove('hidden'); });
  renderResultStats(s.skills);
  $('result').classList.remove('hidden');
}
const STAT_NAMES = { logic: ['論理力', '🧑‍💼'], empathy: ['共感力', '🤝'], presentation: ['プレゼン力', '💬'], trust: ['信頼度', '⭐'] };
function renderResultStats(skills) {
  const box = $('resultStats'); box.innerHTML = '<div class="rs-title">あなたのステータス</div>';
  const ks = Object.keys(STAT_NAMES);
  ks.forEach((k, i) => {
    const v = skills?.[k] || { lv: 1, pct: 0 };
    const row = document.createElement('div'); row.className = 'rs-row ' + k; row.style.animationDelay = (0.3 + i * 0.25) + 's';
    row.innerHTML = `<span class="rs-icon">${STAT_NAMES[k][1]}</span><span class="rs-name">${STAT_NAMES[k][0]}</span><div class="rs-bar"><i></i></div><span class="rs-lv">Lv.<b>1</b></span>`;
    box.appendChild(row);
    setTimeout(() => {
      row.querySelector('i').style.width = v.pct + '%';
      let lv = 1; const b = row.querySelector('b');
      const t = setInterval(() => { if (lv >= v.lv) { clearInterval(t); row.classList.add('done'); return; } b.textContent = ++lv; }, 220);
    }, 500 + i * 250);
  });
  const pct = (k) => skills?.[k]?.pct || 0, lvOf = (k) => skills?.[k]?.lv || 1;
  const sorted = ks.slice().sort((a, b) => pct(b) - pct(a));
  const best = sorted[0], worst = sorted[sorted.length - 1];
  $('statComment').textContent = '';
  setTimeout(() => {
    let msg;
    if (!pct(best)) msg = '次はもっと話してみよう！';
    else if (lvOf(best) === lvOf(worst) && pct(best) - pct(worst) < 8) msg = lvOf(best) >= 4 ? `全能力 Lv.${lvOf(best)} のバランス型！ 隙のない説得力だ。` : `全能力 Lv.${lvOf(best)} で横並び。次は得意分野をひとつ伸ばしてみよう！`;
    else msg = `一番の武器は「${STAT_NAMES[best][0]}」(Lv.${lvOf(best)})。次は「${STAT_NAMES[worst][0]}」を磨こう！`;
    $('statComment').textContent = msg;
  }, 1800);
}

// ───── 音声入力(Web Speech API, ja-JP)
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let rec = null, recOn = false, finalText = '';
if (!SR) { $('vpMsg').textContent = 'このブラウザは音声入力非対応です。下の欄に入力してください'; $('micBtn').disabled = true; $('micLabel').textContent = '(Chrome / Edge 推奨)'; }
function startRec() {
  if (!SR || busy) return;
  rec = new SR(); rec.lang = 'ja-JP'; rec.interimResults = true; rec.continuous = true; finalText = '';
  rec.onresult = (e) => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) { const r = e.results[i]; if (r.isFinal) finalText += r[0].transcript; else interim += r[0].transcript; }
    $('input').value = finalText + interim; level = 0.9;
    setTimeout(() => { if (recOn) level = 0.5; }, 300);
  };
  rec.onerror = (e) => { $('vpMsg').textContent = e.error === 'not-allowed' ? 'マイクが許可されていません。下の欄に入力してください' : '音声認識エラー: ' + e.error; };
  rec.onend = () => { const t = $('input').value; const wasOn = recOn; setRecUI(false); if (wasOn && t.trim()) sendText(t); };
  rec.start(); setRecUI(true);
}
function stopRec() { if (rec && recOn) rec.stop(); }
function setRecUI(on) {
  recOn = on; $('micBtn').classList.toggle('rec', on); level = on ? 0.5 : 0.15;
  $('micLabel').textContent = on ? '話し終わったらもう一度押して送信' : '音声で送信';
  $('vpMsg').textContent = on ? '聞き取り中…' : '話したいことを、マイクに向かって話してください';
}
$('micBtn').onclick = () => recOn ? stopRec() : startRec();

// ───── その他UI
$('form').addEventListener('submit', (e) => { e.preventDefault(); sendText($('input').value); });
$('input').addEventListener('input', () => { if (!recOn) setSteps($('input').value ? 1 : 0); });
function ttsUI() { $('ttsBtn').classList.toggle('on', tts); $('ttsBtn').textContent = tts ? '🔊' : '🔇'; $('ttsBtn').title = tts ? 'ボスの声:ON(クリックでミュート)' : 'ボスの声:OFF(クリックでON)'; }
ttsUI();
$('ttsBtn').onclick = () => {
  tts = !tts; localStorage.setItem(VOICE_KEY, tts ? 'on' : 'off'); ttsUI();
  if (!tts) return stopVoice();
  const h = state?.history || []; const i = h.length - 1;
  if (i >= 0 && h[i].role === 'npc') speakLine(i, h[i].text);
};
$('logBtn').onclick = () => {
  $('log').innerHTML = (state?.history || []).map(h => `<div class="l ${h.role}"><b>${h.role === 'player' ? 'あなた' : esc(stageInfo.charName)}</b>${esc(h.text)}</div>`).join('');
  $('logOverlay').classList.remove('hidden');
};
$('logClose').onclick = () => $('logOverlay').classList.add('hidden');
$('retryBtn').onclick = () => start(state.stage);
$('toSelectBtn').onclick = () => loadLadder();
loadLadder();
