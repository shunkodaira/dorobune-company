// ───── 演出(タイプライター / VSカットイン / ゲージの大きな動き / 勝敗カットイン / 効果音)
// 効果音はすべて WebAudio でその場で合成(音源ファイルなし=ライセンス不要)。ON/OFF は「ボスの声」ボタンと共通
(() => {
  const RM = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const soundOn = () => (typeof tts === 'undefined' ? true : tts);
  let ctx = null, master = null;
  function ac() {
    if (!ctx) { try { ctx = new (window.AudioContext || window.webkitAudioContext)(); master = ctx.createGain(); master.gain.value = 0.5; master.connect(ctx.destination); } catch { return null; } }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  }
  ['pointerdown', 'keydown', 'touchstart'].forEach(ev => window.addEventListener(ev, () => ac(), { capture: true, once: true }));
  function noiseBuf(c, sec) { const b = c.createBuffer(1, Math.max(1, c.sampleRate * sec | 0), c.sampleRate), d = b.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; return b; }
  function env(c, g, t, a, peak, dec) { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + dec); }
  function osc(type, f0, f1, dur, peak, delay = 0) {
    const c = ac(); if (!c) return; const t = c.currentTime + delay, o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, t); if (f1) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    env(c, g, t, 0.005, peak, dur); o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.05);
  }
  function noise(dur, peak, filt, f0, f1, delay = 0, q = 1) {
    const c = ac(); if (!c) return; const t = c.currentTime + delay, s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    s.buffer = noiseBuf(c, dur + 0.05); f.type = filt; f.Q.value = q; f.frequency.setValueAtTime(f0, t); if (f1) f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    env(c, g, t, Math.min(0.08, dur / 3), peak, dur); s.connect(f); f.connect(g); g.connect(master); s.start(t); s.stop(t + dur + 0.05);
  }
  const SFX = {
    thud() { osc('sine', 150, 38, 0.45, 0.9); noise(0.12, 0.5, 'lowpass', 900, 200); },             // 判子をドンッ
    whoosh() { noise(0.42, 0.35, 'bandpass', 300, 3200, 0, 0.8); },                               // カットイン
    chime() { osc('triangle', 880, 0, 0.35, 0.35); osc('triangle', 1318.5, 0, 0.5, 0.3, 0.09); osc('sine', 1760, 0, 0.6, 0.15, 0.18); }, // 好反応
    buzz() { osc('sawtooth', 110, 0, 0.32, 0.22); osc('square', 116, 0, 0.32, 0.12); },          // 逆効果
    type() { noise(0.018, 0.035, 'highpass', 3000); },                                             // タイプ音(ごく小さく)
    tick() { osc('sine', 1250, 0, 0.06, 0.18); },                                                   // 残り30秒
    fanfare() { [523.3, 659.3, 784, 1046.5].forEach((f, i) => osc('triangle', f, 0, 0.5, 0.25, i * 0.09)); },
    gloom() { osc('sawtooth', 220, 110, 0.9, 0.12); osc('sine', 174.6, 87.3, 1.0, 0.25, 0.05); },
  };
  const play = (name) => { window.__lastSfx = name; if (soundOn()) try { SFX[name](); } catch {} };

  // ───── UIボタン音(イベント委譲。新しいボタンにも自動で付く)。音量は控えめ・pointerdown で即時
  Object.assign(SFX, {
    click() { osc('square', 2200, 1400, 0.025, 0.05); noise(0.012, 0.04, 'highpass', 4000); },                 // 通常ボタン
    confirm() { osc('triangle', 1567.98, 0, 0.12, 0.16); osc('sine', 2093, 0, 0.22, 0.12, 0.04); noise(0.02, 0.07, 'highpass', 5000); }, // 挑戦する(カチン)
    bonk() { osc('sine', 180, 90, 0.16, 0.22); },                                                                   // ロック中の段
    hover() { osc('sine', 1800, 0, 0.018, 0.025); },                                                                // 段にマウスを乗せた時
    micOn() { osc('sine', 660, 990, 0.09, 0.12); },
    micOff() { osc('sine', 990, 550, 0.09, 0.1); },
  });
  const CONFIRM = '#chGo, #lostRetry, #retryBtn, [data-sfx=confirm]';
  let lastUi = 0;
  document.addEventListener('pointerdown', (e) => {
    if (e.button > 0) return;
    const t = e.target.closest('button, [role=button], .hb-item, .step'); if (!t) return;
    if (t.disabled || t.matches('[aria-disabled=true]') || t.closest('.fx-layer')) return; // カットイン中は専用音のみ
    const now = performance.now(); if (now - lastUi < 40) return; lastUi = now;
    if (t.matches('.step')) return play(t.matches('.locked') ? 'bonk' : 'click');
    if (t.id === 'micBtn') return play(typeof recOn !== 'undefined' && recOn ? 'micOff' : 'micOn');
    if (t.dataset.sfx === 'none') return;
    play(t.matches(CONFIRM) ? 'confirm' : 'click');
  }, { capture: true });
  let lastHover = null;
  document.addEventListener('pointerover', (e) => {
    const t = e.target.closest && e.target.closest('.step.open'); if (!t || t === lastHover) { if (!t) lastHover = null; return; }
    lastHover = t; play('hover');
  });
  // ボスの声を一瞬下げる(効果音が埋もれないように)
  function duck(ms = 700) { const v = typeof voiceEl !== 'undefined' ? voiceEl : null; if (!v) return; const before = v.volume; v.volume = Math.min(before, 0.45); setTimeout(() => { v.volume = 1; }, ms); }

  // タイプライター: 1秒あたり約35文字。クリック/Enter(入力欄が空の時)で全文表示
  let typing = null;
  function type(el, text) {
    skipType(); el.textContent = '';
    if (RM || !text) { el.textContent = text; return; }
    const st = { el, text, i: 0, timer: null };
    st.timer = setInterval(() => {
      st.i = Math.min(text.length, st.i + 1); el.textContent = text.slice(0, st.i);
      if (st.i % 3 === 0 && /\S/.test(text[st.i - 1] || '')) play('type');
      if (st.i >= text.length) { clearInterval(st.timer); typing = null; }
    }, 1000 / 35);
    typing = st;
  }
  function skipType() { if (!typing) return false; clearInterval(typing.timer); typing.el.textContent = typing.text; typing = null; return true; }
  document.addEventListener('click', (e) => { if (typing && e.target.closest('.bubble, .dialogue')) skipType(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Enter' && typing && (!e.target.value || !e.target.matches('input,textarea'))) { if (skipType() && !e.target.matches('input,textarea')) e.preventDefault(); } });

  // オーバーレイ
  const layer = document.createElement('div'); layer.className = 'fx-layer'; document.body.appendChild(layer);
  const flash = document.createElement('div'); flash.className = 'fx-flash'; document.body.appendChild(flash);
  function clearLayer() { layer.innerHTML = ''; layer.className = 'fx-layer'; }
  function show(html, cls, ms, skippable = true) {
    return new Promise((resolve) => {
      clearLayer(); layer.innerHTML = html; layer.className = 'fx-layer on ' + cls;
      let done = false; const end = () => { if (done) return; done = true; layer.classList.add('out'); setTimeout(() => { clearLayer(); resolve(); }, RM ? 50 : 220); };
      const t = setTimeout(end, RM ? Math.min(ms, 900) : ms);
      if (skippable) layer.onclick = () => { clearTimeout(t); end(); };
    });
  }
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function vs(info, expr) {
    play('whoosh'); duck(1600);
    const face = `img/face_${info.id}_${expr || 'yoyu'}.jpg`;
    return show(`<div class="vs-band b1"></div><div class="vs-band b2"></div>
      <div class="vs-you"><div class="vs-rank">YOU</div><div class="vs-name">あなた</div></div>
      <div class="vs-mark ink" data-text="VS">VS</div>
      <div class="vs-boss"><img src="${face}" alt=""><div class="vs-info"><div class="vs-rank">${esc(info.rank === 6 ? '最終決戦' : info.rankName + '戦')}</div><div class="vs-name">${esc(info.charName)}</div><div class="vs-goal">${esc(info.objective)}</div></div></div>
      <div class="vs-skip">クリックでスキップ</div>`, 'vs', 1600);
  }

  const GOOD = ['効いている！', '刺さった！', '心が動いた！'], BAD = ['逆効果！', '地雷を踏んだ！', '怒らせた！'];
  function big(delta) {
    if (delta >= 15) {
      play('chime'); pop(GOOD[Math.random() * GOOD.length | 0], 'good'); flashOnce('good');
      for (const id of ['sprite', 'sprite2', 'bg', 'bg2']) { const el = document.getElementById(id); if (el) { el.classList.remove('fx-zoom'); void el.offsetWidth; el.classList.add('fx-zoom'); } }
    } else if (delta <= -10) {
      play('buzz'); pop(BAD[Math.random() * BAD.length | 0], 'bad'); flashOnce('bad');
      if (!RM) { document.body.classList.remove('fx-shake'); void document.body.offsetWidth; document.body.classList.add('fx-shake'); setTimeout(() => document.body.classList.remove('fx-shake'), 500); }
    }
  }
  function flashOnce(kind) { flash.className = 'fx-flash'; void flash.offsetWidth; flash.className = 'fx-flash on ' + kind; }
  function pop(text, kind) {
    const p = document.createElement('div'); p.className = 'fx-pop ink ' + kind; p.textContent = text; p.dataset.text = text; document.body.appendChild(p);
    setTimeout(() => p.remove(), 1300);
  }

  // 会心の一撃(致命的弱点を突いた): 集中線 + 白フラッシュ + 大見出し
  function critical(info, label) {
    play('whoosh'); setTimeout(() => { play('thud'); duck(1800); }, 180); setTimeout(() => play('chime'), 420); setTimeout(() => play('fanfare'), 900);
    flashOnce('good');
    if (!RM) { document.body.classList.remove('fx-shake'); void document.body.offsetWidth; document.body.classList.add('fx-shake'); setTimeout(() => document.body.classList.remove('fx-shake'), 500); }
    return show(`<div class="cr-lines"></div><div class="cr-burst"></div><div class="cr-title ink" data-text="会心の一撃！">会心の一撃！</div><div class="cr-sub">${esc(label || '')}</div><div class="cr-boss">${esc(info.charName)}の心を撃ち抜いた！</div><div class="vs-skip">クリックでスキップ</div>`, 'cr', 2300);
  }

  // 勝敗カットイン(結果画面の前)
  function outcome(s, info) {
    const won = s.status === 'won', timeUp = s.loseReason === 'time';
    if (timeUp) {
      play('tick'); setTimeout(() => play('gloom'), 250);
      return show(`<div class="oc-band lose"></div><div class="oc-clock">${window.ICON ? ICON('alarm') : ''}</div><div class="oc-title ink" data-text="タイムアップ">タイムアップ</div>`, 'oc oc-timeup', 1700);
    }
    if (won) {
      const clear = s.gameClear, joumu = s.stage === 'joumu';
      const stamp = clear ? 'GAME<br>CLEAR' : joumu ? '辞表' : esc(info.stampText || '承認');
      play('whoosh'); setTimeout(() => { play('thud'); duck(); }, 520); setTimeout(() => play('fanfare'), 700);
      return show(`<div class="oc-band ${clear ? 'gold' : 'win'}"></div><div class="oc-title ink" data-text="${clear ? '社長就任！' : '説得成功！'}">${clear ? '社長就任！' : '説得成功！'}</div><div class="oc-sub">${clear ? '泥舟カンパニーの頂点へ' : s.free ? 'フリー対戦' : joumu ? '常務、辞任' : '昇進'}</div><div class="oc-stamp ${clear ? 'gold' : joumu ? 'st-jihyo' : ''}">${stamp}</div>`, 'oc ' + (clear ? 'oc-clear' : 'oc-win'), 2100);
    }
    play('whoosh'); setTimeout(() => { play('thud'); duck(); }, 520); setTimeout(() => play('gloom'), 650);
    return show(`<div class="oc-band lose"></div><div class="oc-title ink" data-text="交渉決裂">交渉決裂</div><div class="oc-sub">${s.free ? 'フリー対戦' : '左遷'}</div><div class="oc-stamp lose">却下</div><div class="oc-snow"></div>`, 'oc oc-lose', 2000);
  }

  // 残り30秒: タイマーが赤く脈打ち、毎秒小さなチック音
  let lastTick = -1;
  function timerWarn(left, playing) {
    const t = document.getElementById('timer'); if (!t) return;
    const danger = playing && left > 0 && left <= 30;
    t.classList.toggle('danger', danger);
    if (danger && left !== lastTick) { lastTick = left; play('tick'); }
  }

  window.FX = { ac, critical, type, skipType, vs, big, outcome, timerWarn, play, RM };
})();
