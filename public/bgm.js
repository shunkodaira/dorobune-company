// ───── ロビーBGM(出世の階段画面だけで流す)。設定はサーバの config.js(/api/bgm)
// ・ローカルの mp3 があればそれを、無ければ YouTube IFrame Player API(プレイヤーは小さく表示したまま)で再生
// ・ブラウザの自動再生制限のため、最初のクリック/キー操作のあとに再生開始。ループ再生
// ・音符ボタンでON/OFF(localStorageに記憶)。対戦開始でフェードアウトして一時停止、階段に戻ると再開
(() => {
  const KEY = 'dorobune-bgm';
  const $ = (id) => document.getElementById(id);
  let cfg = null, enabled = localStorage.getItem(KEY) !== 'off', inLobby = false, gestured = false;
  let yt = null, ytReady = false, audio = null, failed = false, fadeT = null, vol = 35;
  const card = $('bgmCard');

  function note(msg) { failed = true; $('bgmNote').textContent = msg; $('bgmNote').classList.remove('hidden'); $('bgmFrame').classList.add('hidden'); syncBtn(); }
  function syncBtn() {
    $('bgmToggle').innerHTML = enabled && !failed ? ICON('music', 'BGM ON') : ICON('mute', 'BGM OFF');
    $('bgmToggle').title = enabled ? 'BGMをオフにする' : 'BGMをオンにする';
    $('bgmLabel').textContent = failed ? 'BGM' : enabled ? 'BGM ON' : 'BGM OFF';
  }
  function setVol(v) { if (audio) audio.volume = v / 100; else if (yt && ytReady) yt.setVolume(v); }
  function fade(to, ms, done) {
    clearInterval(fadeT); let cur = audio ? audio.volume * 100 : (yt && ytReady ? yt.getVolume() : 0);
    const step = (to - cur) / Math.max(1, ms / 50);
    fadeT = setInterval(() => { cur += step; if ((step >= 0 && cur >= to) || (step < 0 && cur <= to)) { cur = to; clearInterval(fadeT); setVol(cur); done && done(); } else setVol(cur); }, 50);
  }
  function play() {
    if (!cfg || failed || !enabled || !inLobby || !gestured) return;
    if (audio) { audio.volume = 0; audio.play().then(() => fade(vol, 800)).catch(() => {}); }
    else if (yt && ytReady) { yt.setVolume(0); yt.playVideo(); fade(vol, 800); }
  }
  function pause(ms = 600) {
    const stop = () => { if (audio) audio.pause(); else if (yt && ytReady) yt.pauseVideo(); };
    if (ms) fade(0, ms, stop); else { clearInterval(fadeT); stop(); }
  }

  function initYouTube(id) {
    $('bgmFrame').classList.remove('hidden');
    const s = document.createElement('script'); s.src = 'https://www.youtube.com/iframe_api';
    s.onerror = () => note('BGMを読み込めませんでした(オフライン?)');
    document.head.appendChild(s);
    const timeout = setTimeout(() => { if (!ytReady) note('BGMを読み込めませんでした'); }, 12000);
    window.onYouTubeIframeAPIReady = () => {
      yt = new YT.Player('bgmPlayer', {
        width: 200, height: 113, videoId: id,
        playerVars: { autoplay: 0, loop: 1, playlist: id, controls: 1, modestbranding: 1, playsinline: 1, rel: 0 },
        events: {
          onReady: () => { clearTimeout(timeout); ytReady = true; failed = false; $('bgmNote').classList.add('hidden'); syncBtn(); setVol(0); play(); },
          onStateChange: (e) => { if (e.data === YT.PlayerState.ENDED && inLobby && enabled) { yt.seekTo(0); yt.playVideo(); } },
          onError: (e) => { clearTimeout(timeout); note([101, 150].includes(e.data) ? `この曲は埋め込み再生できません(${e.data})` : `BGMを再生できません(${e.data})`); },
        },
      });
    };
  }

  async function init() {
    try { cfg = await fetch('/api/bgm').then(r => r.json()); } catch { cfg = { type: 'none' }; }
    if (!cfg || cfg.type === 'none') { card.remove(); return; }
    vol = cfg.volume ?? 35;
    if (cfg.type === 'file') { audio = new Audio(cfg.src); audio.loop = true; audio.preload = 'auto'; $('bgmFrame').classList.add('hidden'); card.classList.add('file');
      const c = cfg.credit; if (c) { const el = $('bgmCredit'); el.innerHTML = `♪ "${c.title}" ${c.artist} (<a href="${c.url}" target="_blank" rel="noopener">incompetech.com</a>)<br><a href="${c.licenseUrl}" target="_blank" rel="noopener">${c.license}</a>`; el.classList.remove('hidden'); } }
    else initYouTube(cfg.id);
    syncBtn(); if (inLobby) card.classList.remove('hidden');
  }

  $('bgmToggle').addEventListener('click', (e) => {
    e.stopPropagation(); gestured = true;
    enabled = !enabled; localStorage.setItem(KEY, enabled ? 'on' : 'off'); syncBtn();
    if (enabled) play(); else pause(300);
  });
  const onGesture = () => { if (gestured) return; gestured = true; play(); };
  ['pointerdown', 'keydown', 'touchstart'].forEach(ev => window.addEventListener(ev, onGesture, { capture: true }));

  window.BGM = {
    enter() { inLobby = true; if (cfg && cfg.type !== 'none') card.classList.remove('hidden'); play(); },
    state() { return { type: cfg && cfg.type, failed, enabled, inLobby, playing: audio ? !audio.paused : yt && ytReady ? yt.getPlayerState() === 1 : false }; },
    leave() { inLobby = false; card.classList.add('hidden'); pause(600); },
  };
  syncBtn(); init();
})();
