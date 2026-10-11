// 泥舟カンパニー — 漫画の吹き出し(SVGで形を描く。枠線は形に沿う)
// 形: normal(角丸+しっぽ) / calm(まるい・やわらか) / think(もくもく雲) / nervous(ふるえる波線) / angry(ギザギザ) / shout(爆発トゲ・黄色)
(function () {
  const NS = 'http://www.w3.org/2000/svg';
  const PAD = 40; // SVG はボックスより PAD px 大きく描き、トゲ・しっぽをはみ出させる
  const RM = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const STYLES = ['normal', 'calm', 'think', 'nervous', 'angry', 'shout'];

  // 乱数(行ごとに固定: 同じ台詞なら同じギザギザ)
  function rng(seed) { let s = (seed >>> 0) || 1; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
  const hash = (t) => { let h = 2166136261; for (const c of String(t)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };

  // 角丸長方形の外周を時計回りに n 点サンプリング(位置 + 外向き法線)
  function perimeter(x0, y0, x1, y1, r, step) {
    const w = x1 - x0, h = y1 - y0; r = Math.min(r, w / 2, h / 2);
    const segs = [
      ['L', x0 + r, y0, x1 - r, y0, 0, -1], ['A', x1 - r, y0 + r, -Math.PI / 2, 0],
      ['L', x1, y0 + r, x1, y1 - r, 1, 0], ['A', x1 - r, y1 - r, 0, Math.PI / 2],
      ['L', x1 - r, y1, x0 + r, y1, 0, 1], ['A', x0 + r, y1 - r, Math.PI / 2, Math.PI],
      ['L', x0, y1 - r, x0, y0 + r, -1, 0], ['A', x0 + r, y0 + r, Math.PI, Math.PI * 1.5],
    ];
    const lens = segs.map(s => s[0] === 'L' ? Math.hypot(s[3] - s[1], s[4] - s[2]) : r * Math.PI / 2);
    const total = lens.reduce((a, b) => a + b, 0);
    const n = Math.max(12, Math.round(total / step)), pts = [];
    for (let i = 0; i < n; i++) {
      let d = (i / n) * total, k = 0;
      while (k < segs.length - 1 && d > lens[k]) { d -= lens[k]; k++; }
      const s = segs[k], t = lens[k] ? d / lens[k] : 0;
      if (s[0] === 'L') pts.push({ x: s[1] + (s[3] - s[1]) * t, y: s[2] + (s[4] - s[2]) * t, nx: s[5], ny: s[6], u: i / n });
      else { const a = s[3] + (s[4] - s[3]) * t; pts.push({ x: s[1] + r * Math.cos(a), y: s[2] + r * Math.sin(a), nx: Math.cos(a), ny: Math.sin(a), u: i / n }); }
    }
    return pts;
  }
  const poly = (pts) => 'M' + pts.map(p => p.x.toFixed(1) + ' ' + p.y.toFixed(1)).join('L') + 'Z';
  function smooth(pts) { // 点列を滑らかな閉曲線に(中点を結ぶ二次ベジェ)
    const m = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }), n = pts.length;
    let d = 'M' + m(pts[n - 1], pts[0]).x.toFixed(1) + ' ' + m(pts[n - 1], pts[0]).y.toFixed(1);
    for (let i = 0; i < n; i++) { const p = pts[i], q = m(p, pts[(i + 1) % n]); d += `Q${p.x.toFixed(1)} ${p.y.toFixed(1)} ${q.x.toFixed(1)} ${q.y.toFixed(1)}`; }
    return d + 'Z';
  }
  function roundRect(x0, y0, x1, y1, r) {
    r = Math.min(r, (x1 - x0) / 2, (y1 - y0) / 2);
    return `M${x0 + r} ${y0}H${x1 - r}A${r} ${r} 0 0 1 ${x1} ${y0 + r}V${y1 - r}A${r} ${r} 0 0 1 ${x1 - r} ${y1}H${x0 + r}A${r} ${r} 0 0 1 ${x0} ${y1 - r}V${y0 + r}A${r} ${r} 0 0 1 ${x0 + r} ${y0}Z`;
  }

  // 本体の形
  function body(style, w, h, seed) {
    const x0 = PAD, y0 = PAD, x1 = PAD + w, y1 = PAD + h, R = rng(seed);
    switch (style) {
      case 'calm': return roundRect(x0, y0, x1, y1, Math.min(h / 2, 64));
      case 'think': { // もくもく: 外周の点を外側にふくらむ弧で結ぶ
        const pts = perimeter(x0 + 6, y0 + 6, x1 - 6, y1 - 6, Math.min(h / 2, 46), 30 + R() * 4);
        let d = `M${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
        for (let i = 1; i <= pts.length; i++) { const a = pts[i - 1], b = pts[i % pts.length]; const r = Math.hypot(b.x - a.x, b.y - a.y) * (0.56 + R() * 0.08); d += `A${r.toFixed(1)} ${r.toFixed(1)} 0 0 1 ${b.x.toFixed(1)} ${b.y.toFixed(1)}`; }
        return d + 'Z';
      }
      case 'nervous': { // 小刻みな波線
        const pts = perimeter(x0, y0, x1, y1, 26, 7), k = Math.round(pts.length / 5.5);
        return smooth(pts.map(p => { const o = 3.2 * Math.sin(p.u * Math.PI * 2 * k); return { x: p.x + p.nx * o, y: p.y + p.ny * o }; }));
      }
      case 'angry': { // ギザギザ(細かいトゲ)
        const pts = perimeter(x0 + 4, y0 + 4, x1 - 4, y1 - 4, 30, 15);
        return poly(pts.map((p, i) => { const o = i % 2 ? 9 + R() * 8 : -3; return { x: p.x + p.nx * o, y: p.y + p.ny * o }; }));
      }
      case 'shout': { // 爆発(大きく不揃いなトゲ)
        const pts = perimeter(x0 + 6, y0 + 6, x1 - 6, y1 - 6, 34, 21);
        return poly(pts.map((p, i) => { const o = i % 2 ? 13 + R() * 14 : -2 - R() * 3; return { x: p.x + p.nx * o, y: p.y + p.ny * o }; }));
      }
      default: return roundRect(x0, y0, x1, y1, Math.min(22, h / 2));
    }
  }
  // しっぽ: side=top|left, at=辺上の位置(px), tip=(dx,dy) 先端, 根元は内側に食い込ませて本体の枠線を隠す
  function tail(t, w, h, style) {
    const bw = style === 'shout' || style === 'angry' ? 30 : 26, inset = 16;
    if (t.side === 'top') {
      const bx = PAD + t.at, y = PAD;
      return `M${bx - bw / 2} ${y + inset}L${bx - bw / 2} ${y + 2}L${bx + t.dx} ${y + t.dy}L${bx + bw / 2} ${y + 2}L${bx + bw / 2} ${y + inset}Z`;
    }
    const by = PAD + t.at, x = PAD; // left
    return `M${x + inset} ${by - bw / 2}L${x + 2} ${by - bw / 2}L${x + t.dx} ${by + t.dy}L${x + 2} ${by + bw / 2}L${x + inset} ${by + bw / 2}Z`;
  }
  function el(tag, attrs, parent) { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); parent && parent.appendChild(e); return e; }

  function draw(host) {
    const st = host._bb; if (!st) return;
    const w = host.offsetWidth, h = host.offsetHeight; if (!w || !h) return;
    let svg = host.querySelector(':scope > svg.bb-svg');
    if (!svg) { svg = el('svg', { class: 'bb-svg', 'aria-hidden': 'true' }); host.prepend(svg); }
    svg.setAttribute('width', w + PAD * 2); svg.setAttribute('height', h + PAD * 2);
    svg.setAttribute('viewBox', `0 0 ${w + PAD * 2} ${h + PAD * 2}`);
    svg.innerHTML = '';
    const tl = typeof st.tail === 'function' ? st.tail(w, h) : st.tail;
    const g = el('g', { class: 'bb-g' }, svg), style = st.style;
    const d = body(style, w, h, st.seed);
    let t = null, dots = [];
    if (style === 'think') { // 雲のしっぽは小さな丸
      const [ox, oy] = tl.side === 'top' ? [PAD + tl.at, PAD] : [PAD, PAD + tl.at];
      const ux = tl.dx, uy = tl.dy, L = Math.hypot(ux, uy) || 1;
      dots = [[0.55, 7], [1.05, 4.5]].map(([f, r]) => [ox + ux / L * (L * f + 6), oy + uy / L * (L * f + 6), r]);
    } else t = tail(tl, w, h, style);
    if (t) el('path', { d: t, class: 'bb-tail-line' }, g);
    el('path', { d, class: 'bb-body' }, g);
    if (style === 'calm') el('path', { d: roundRect(PAD + 5, PAD + 5, PAD + w - 5, PAD + h - 5, Math.min(h / 2 - 5, 59)), class: 'bb-inner' }, g);
    if (t) el('path', { d: t, class: 'bb-tail-fill' }, g);
    for (const [cx, cy, r] of dots) el('circle', { cx, cy, r, class: 'bb-dot' }, g);
    // ポップのアンカー = しっぽの先
    const ax = tl.side === 'top' ? PAD + tl.at + tl.dx : PAD + tl.dx, ay = tl.side === 'top' ? PAD + tl.dy : PAD + tl.at + tl.dy;
    svg.style.transformOrigin = `${ax}px ${ay}px`;
  }
  const ro = 'ResizeObserver' in window ? new ResizeObserver(es => es.forEach(e => draw(e.target))) : null;

  // host の吹き出しを style に。tailFn(w,h) → {side, at, dx, dy}
  function set(host, style, opts = {}) {
    if (!STYLES.includes(style)) style = 'normal';
    const prev = host._bb && host._bb.style;
    host._bb = { style, seed: opts.seed ?? hash(style + Date.now()), tail: opts.tail || { side: 'top', at: 40, dx: 20, dy: -24 } };
    host.classList.add('bb'); STYLES.forEach(s => host.classList.toggle('bb-' + s, s === style));
    if (ro && !host._bbObs) { ro.observe(host); host._bbObs = true; }
    draw(host);
    if ((opts.pop || prev !== style) && !RM) { const svg = host.querySelector(':scope > svg.bb-svg'); if (svg) { svg.classList.remove('bb-pop'); void svg.getBoundingClientRect(); svg.classList.add('bb-pop'); } }
  }
  function redraw(host) { draw(host); }

  // ボスの台詞の形: 表情(expr) + ゲージ変化 + 文面の手がかり
  function pickBoss(text, expr, delta = 0, status) {
    const t = String(text || ''), bang = (t.match(/[！!]/g) || []).length, dots = (t.match(/…/g) || []).length, q = /[？?]/.test(t);
    const bangRun = /[！!]{2,}|[！!][？?]|[？?][！!]/.test(t);
    if (status === 'won') return expr === 'aseri' ? 'nervous' : 'calm';
    if (expr === 'ikari') return delta <= -12 || bangRun || bang >= 3 ? 'shout' : 'angry';
    if (expr === 'odoroki') return bangRun || bang >= 2 || delta >= 15 ? 'shout' : 'nervous';
    if (expr === 'aseri') return 'nervous';
    if (expr === 'nattoku') return 'calm';
    if (delta <= -10) return 'angry';
    if (bangRun || bang >= 3) return 'shout';
    if ((dots >= 4 && q) || (/^[\s「]*…/.test(t) && q) || dots >= 6) return 'think';
    return 'normal';
  }
  function pickPlayer(text) {
    const t = String(text || '');
    if (/[！!]{2,}/.test(t) || (t.match(/[！!]/g) || []).length >= 3) return 'shout';
    if (/^[…\s]*…/.test(t) || (t.match(/…/g) || []).length >= 3) return 'think';
    return 'normal';
  }
  window.Bubble = { set, redraw, pickBoss, pickPlayer, hash, STYLES };
})();
