// 泥舟カンパニー — スマホ用の補助(PCでは何もしない)
// ・visualViewport からキーボードの高さ(--kb)と下段の高さ(--bottom-h)を CSS 変数に
// ・立ち絵(スプライト)ステージかどうかを body.has-sprite に
// ・「気になるもの」を折りたたみ式に
(() => {
  const mq = matchMedia('(max-width:700px), (max-height:500px) and (orientation:landscape)');
  const root = document.documentElement, body = document.body;
  const $ = (id) => document.getElementById(id);
  function update() {
    const vv = window.visualViewport;
    const h = vv ? vv.height : innerHeight;
    const kb = vv ? Math.max(0, Math.round(innerHeight - vv.height - vv.offsetTop)) : 0;
    root.style.setProperty('--app-h', h + 'px');
    root.style.setProperty('--kb', (mq.matches ? kb : 0) + 'px');
    body.classList.toggle('kb-open', mq.matches && kb > 80);
    const br = document.querySelector('.bottom-row');
    if (br) root.style.setProperty('--bottom-h', br.offsetHeight + 'px');
    if (mq.matches && kb > 80 && (window.scrollY || document.scrollingElement.scrollTop)) window.scrollTo(0, 0); // iOS: キーボード表示で画面ごと持ち上がるのを戻す
  }
  if (window.visualViewport) { visualViewport.addEventListener('resize', update); visualViewport.addEventListener('scroll', update); }
  addEventListener('resize', update); addEventListener('orientationchange', () => setTimeout(update, 250));
  mq.addEventListener ? mq.addEventListener('change', update) : mq.addListener(update);
  if ('ResizeObserver' in window) { const br = document.querySelector('.bottom-row'); if (br) new ResizeObserver(update).observe(br); }
  const sp = $('sprite');
  const syncSprite = () => body.classList.toggle('has-sprite', !!sp && !sp.classList.contains('hidden'));
  if (sp) new MutationObserver(syncSprite).observe(sp, { attributes: true, attributeFilter: ['class'] });
  syncSprite();
  // 気になるもの: 見出しをタップで開閉(スマホのみ。初期は閉じる)
  const sc = document.querySelector('.scene-panel');
  if (sc) {
    const t = sc.querySelector('.ptitle'); t.setAttribute('role', 'button'); t.setAttribute('tabindex', '0'); t.setAttribute('aria-expanded', 'false');
    const toggle = () => { if (!mq.matches) return; const o = sc.classList.toggle('open'); t.setAttribute('aria-expanded', String(o)); };
    t.addEventListener('click', toggle); t.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
  }
  update(); setTimeout(update, 300);
})();
