// 泥舟カンパニー — 手描き劇画風アイコン(インラインSVG)。絵文字は使わない
// ICON(name, label?) → SVG文字列。label があれば role="img"+aria-label、無ければ装飾(aria-hidden)
(function () {
  const K = '#111', Y = '#ffd400', W = '#fff', R = '#e8102b', B = '#6ec6ff';
  const S = `stroke="${K}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"`;
  const vein = (x, y) => `<path d="M${x - 3} ${y - 1}q2 0 2-2M${x + 3} ${y - 1}q-2 0-2-2M${x - 3} ${y + 3}q2 0 2 2M${x + 3} ${y + 3}q-2 0-2 2" fill="none" stroke="${R}" stroke-width="2" stroke-linecap="round"/>`;
  const drop = (x, y, s = 1) => `<path d="M${x} ${y}q${3 * s} ${4 * s} ${3 * s} ${6 * s}a${3 * s} ${3 * s} 0 0 1-${6 * s} 0q0-2 ${3 * s}-${6 * s}z" fill="${B}" stroke="${K}" stroke-width="1.6"/>`;
  const head = (fill = Y) => `<circle cx="16" cy="17" r="12.5" fill="${fill}" ${S}/>`;
  const blush = `<ellipse cx="9" cy="20.5" rx="2.2" ry="1.2" fill="${R}" opacity=".45"/><ellipse cx="23" cy="20.5" rx="2.2" ry="1.2" fill="${R}" opacity=".45"/>`;
  const gloom = `<path d="M10 7v4M13.5 5.5v5M17 5v5M20.5 5.5v4" stroke="#4a5bd6" stroke-width="1.6" stroke-linecap="round"/>`;
  const P = {
    // UI
    target: `<circle cx="16" cy="16" r="12.5" fill="${W}" ${S}/><circle cx="16" cy="16" r="8" fill="${R}" ${S}/><circle cx="16" cy="16" r="3.6" fill="${Y}" ${S}/><path d="M16 16L27 5M23.5 4.5L27 5l.5 3.5" fill="none" ${S}/>`,
    timer: `<path d="M13 3.5h6M16 3.5v3.5M24.5 8.5l2-2" fill="none" ${S}/><circle cx="16" cy="18" r="11" fill="${W}" ${S}/><path d="M16 18V11.5" stroke="${R}" stroke-width="2.8" stroke-linecap="round"/><path d="M16 18l4 3" ${S}/><circle cx="16" cy="18" r="1.6" fill="${K}"/><path d="M9.5 12.5l1 1M22.5 12.5l-1 1" stroke="${K}" stroke-width="1.6" stroke-linecap="round"/>`,
    speaker: `<path d="M4.5 12.5h5l7-6v19l-7-6h-5z" fill="${Y}" ${S}/><path d="M20.5 12q2.5 4 0 8M24 9q5 7 0 14" fill="none" ${S}/>`,
    mute: `<path d="M4.5 12.5h5l7-6v19l-7-6h-5z" fill="${Y}" ${S}/><path d="M20.5 12.5l7 7M27.5 12.5l-7 7" stroke="${R}" stroke-width="3.2" stroke-linecap="round"/>`,
    scroll: `<path d="M8 6.5h15.5a3 3 0 0 1 3 3v15H11" fill="${W}" ${S}/><path d="M8 6.5a3 3 0 0 0-3 3v1.5h6V9.5a3 3 0 0 0-3-3z" fill="${Y}" ${S}/><path d="M11 9.5v15a2.5 2.5 0 0 1-5 0v-1h18.5" fill="${W}" ${S}/><path d="M14.5 12h8M14.5 16h8M14.5 20h5" stroke="${K}" stroke-width="1.8" stroke-linecap="round"/>`,
    eyes: `<ellipse cx="10" cy="16" rx="6.2" ry="8.5" fill="${W}" ${S}/><ellipse cx="22" cy="16" rx="6.2" ry="8.5" fill="${W}" ${S}/><circle cx="12" cy="17" r="3" fill="${K}"/><circle cx="24" cy="17" r="3" fill="${K}"/><circle cx="13" cy="15.8" r="1" fill="${W}"/><circle cx="25" cy="15.8" r="1" fill="${W}"/>`,
    bulb: `<path d="M16 4a8.5 8.5 0 0 0-5 15.4c1 .8 1.5 1.8 1.5 3v.6h7v-.6c0-1.2.5-2.2 1.5-3A8.5 8.5 0 0 0 16 4z" fill="${Y}" ${S}/><path d="M12.5 26.5h7M13.5 29.5h5" ${S}/><path d="M13 10.5q1.5-2.5 4-2.5" fill="none" stroke="${W}" stroke-width="2" stroke-linecap="round"/><path d="M3 9l2.5 1M29 9l-2.5 1M16 0.8v1.2" stroke="${K}" stroke-width="2" stroke-linecap="round"/>`,
    close: `<path d="M8 8l16 16M24 8L8 24" stroke="${K}" stroke-width="6" stroke-linecap="round"/><path d="M8 8l16 16M24 8L8 24" stroke="${Y}" stroke-width="2.6" stroke-linecap="round"/>`,
    mic: `<rect x="11.5" y="3.5" width="9" height="16" rx="4.5" fill="${W}" ${S}/><path d="M7.5 15v1a8.5 8.5 0 0 0 17 0v-1M16 24.5v4M11.5 28.5h9" fill="none" ${S}/><path d="M14 9h4M14 13h4" stroke="${K}" stroke-width="1.6" stroke-linecap="round"/>`,
    hourglass: `<path d="M8 4h16M8 28h16" ${S}/><path d="M10 4v4l5 7.5v1L10 24v4h12v-4l-5-7.5v-1L22 8V4z" fill="${W}" ${S}/><path d="M12.5 9h7L16 14.5zM11.5 26l4.5-5 4.5 5z" fill="${Y}" stroke="${K}" stroke-width="1.4" stroke-linejoin="round"/>`,
    balloon: `<path d="M16 5c7.2 0 12 4.2 12 9.5S23.2 24 16 24c-1.2 0-2.3-.1-3.4-.3L6 28l1.8-5.6C5.4 20.6 4 17.7 4 14.5 4 9.2 8.8 5 16 5z" fill="${W}" ${S}/><circle cx="11" cy="14.5" r="1.7" fill="${K}"/><circle cx="16" cy="14.5" r="1.7" fill="${K}"/><circle cx="21" cy="14.5" r="1.7" fill="${K}"/>`,
    trophy: `<path d="M9.5 4.5h13v6.5a6.5 6.5 0 0 1-13 0z" fill="${Y}" ${S}/><path d="M9.5 7H5.5q0 6 5 7M22.5 7h4q0 6-5 7" fill="none" ${S}/><path d="M16 17.5v4.5M11 27.5h10l-1.2-5.5h-7.6z" fill="${Y}" ${S}/><path d="M13 7.5v4" stroke="${W}" stroke-width="2" stroke-linecap="round"/><path d="M16 8.2l.9 1.8 2 .3-1.4 1.4.3 2-1.8-.9-1.8.9.3-2-1.4-1.4 2-.3z" fill="${W}" stroke="${K}" stroke-width="1"/>`,
    alarm: `<path d="M6 9.5a4.5 4.5 0 0 1 6-5.5M26 9.5a4.5 4.5 0 0 0-6-5.5" fill="${Y}" ${S}/><path d="M9 27.5l2.5-3M23 27.5l-2.5-3" ${S}/><circle cx="16" cy="17" r="10.5" fill="${W}" ${S}/><path d="M16 17v-6.5M16 17l5 2.5" stroke="${R}" stroke-width="2.8" stroke-linecap="round"/><circle cx="16" cy="17" r="1.6" fill="${K}"/><path d="M1.5 14l2 .5M30.5 14l-2 .5M2.5 20l2-.5M29.5 20l-2-.5" stroke="${K}" stroke-width="1.8" stroke-linecap="round"/>`,
    cracker: `<path d="M4 28l6-17 11 11z" fill="${Y}" ${S}/><path d="M7 20l5 5M8.7 15l8.2 8.2" stroke="${R}" stroke-width="2" stroke-linecap="round"/><path d="M15 9q1-4 4-5M21 13q3-2 7-1M18 10.5l4-4" fill="none" ${S}/><circle cx="25" cy="5" r="1.6" fill="${R}"/><rect x="26" y="16" width="3" height="3" fill="${Y}" stroke="${K}" stroke-width="1.2" transform="rotate(20 27.5 17.5)"/><circle cx="12.5" cy="4.5" r="1.4" fill="${B}" stroke="${K}" stroke-width="1"/>`,
    chartDown: `<path d="M4.5 4.5v23h23" fill="none" ${S}/><path d="M8 9l5.5 5.5 4-3.5 7.5 9" fill="none" stroke="${K}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/><path d="M8 9l5.5 5.5 4-3.5 7.5 9" fill="none" stroke="${R}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/><path d="M19.5 21.5h6.5V15" fill="none" ${S}/>`,
    tie: `<path d="M12.5 4.5h7l-1.5 4h-4z" fill="${R}" ${S}/><path d="M14 8.5h4l3 14-5 5-5-5z" fill="${R}" ${S}/><path d="M14.5 13.5l4 3M13.5 18.5l5 3.5" stroke="${W}" stroke-width="1.4" stroke-linecap="round"/>`,
    heart: `<path d="M16 27S4 19.5 4 11.5A6 6 0 0 1 16 9a6 6 0 0 1 12 2.5C28 19.5 16 27 16 27z" fill="${R}" ${S}/><path d="M8.5 10.5q1-2 3-2" fill="none" stroke="${W}" stroke-width="2" stroke-linecap="round"/>`,
    star: `<path d="M16 3.5l3.7 7.6 8.3 1.2-6 5.9 1.4 8.3L16 22.6l-7.4 3.9 1.4-8.3-6-5.9 8.3-1.2z" fill="${Y}" ${S}/><path d="M12.5 12.5l1.5-.3" stroke="${W}" stroke-width="2" stroke-linecap="round"/>`,
    // 顔(ゲージ)
    furious: head('#ff9a3c') + `<path d="M8 11.5l6 3M24 11.5l-6 3" ${S}/><circle cx="11.5" cy="16" r="1.5" fill="${K}"/><circle cx="20.5" cy="16" r="1.5" fill="${K}"/><rect x="10" y="20" width="12" height="5" rx="1" fill="${W}" ${S}/><path d="M14 20v5M18 20v5" stroke="${K}" stroke-width="1.4"/>` + vein(25, 7),
    angry: head() + `<path d="M8.5 12l5.5 2.5M23.5 12L18 14.5" ${S}/><circle cx="12" cy="17" r="1.6" fill="${K}"/><circle cx="20" cy="17" r="1.6" fill="${K}"/><path d="M11.5 24q4.5-3.5 9 0" fill="none" ${S}/>` + vein(24, 8),
    annoyed: head() + `<path d="M8.5 15.5h6M17.5 15.5h6" ${S}/><path d="M10.5 15.5a1.6 1.6 0 0 0 3.2 0M19.5 15.5a1.6 1.6 0 0 0 3.2 0" fill="${K}"/><path d="M12 23h6.5l2-1" fill="none" ${S}/>`,
    thinking: head() + `<path d="M9 11.5q2.5-2 5-1M18.5 12.5h4.5" fill="none" ${S}/><circle cx="12" cy="15.5" r="1.6" fill="${K}"/><circle cx="20.5" cy="15.5" r="1.6" fill="${K}"/><path d="M13 22.5q3 1 6-1" fill="none" ${S}/><path d="M25 3.5q3.5 0 3.5 2.6c0 1.8-2.3 2-2.3 3.6M26.2 12v.1" fill="none" stroke="${K}" stroke-width="2.2" stroke-linecap="round"/>`,
    smirk: head() + `<path d="M8.5 14.5h6M17.5 14.5h6" ${S}/><path d="M10 14.5a2 2 0 0 0 4 0M19 14.5a2 2 0 0 0 4 0" fill="${K}"/><path d="M11 22q5 2 10-2.5" fill="none" ${S}/><path d="M9 11l4-.8M23 10.2l-4 .8" stroke="${K}" stroke-width="1.8" stroke-linecap="round"/>`,
    relieved: head() + `<path d="M9 16q2.5-2.5 5 0M18 16q2.5-2.5 5 0" fill="none" ${S}/><path d="M11.5 21.5q4.5 3.5 9 0" fill="none" ${S}/>` + blush,
    neutral: head() + `<circle cx="12" cy="15.5" r="1.6" fill="${K}"/><circle cx="20" cy="15.5" r="1.6" fill="${K}"/><path d="M11.5 22.5h9" ${S}/>`,
    skeptical: head() + `<path d="M8.5 13l5-1M18 10.5q2.5-1.5 5 0" fill="none" ${S}/><circle cx="12" cy="16" r="1.6" fill="${K}"/><circle cx="20.5" cy="15.5" r="2" fill="${K}"/><path d="M12 23l7-1" ${S}/>`,
    smile: head() + `<circle cx="12" cy="15.5" r="1.6" fill="${K}"/><circle cx="20" cy="15.5" r="1.6" fill="${K}"/><path d="M11 21q5 4 10 0" fill="none" ${S}/>` + blush,
    devil: `<path d="M7 9L5 2l6.5 4.5M25 9l2-7-6.5 4.5" fill="${R}" ${S}/>` + head('#ff6b5a') + `<path d="M8 11.5l6 3M24 11.5l-6 3" ${S}/><circle cx="12" cy="16" r="1.5" fill="${K}"/><circle cx="20" cy="16" r="1.5" fill="${K}"/><path d="M9 20.5q7 7 14 0z" fill="${W}" ${S}/><path d="M12 21l1 2.2 1-1.8M20 21l-1 2.2-1-1.8" fill="none" stroke="${K}" stroke-width="1.2"/>`,
    huffy: head() + `<path d="M8.5 12l5 2M23.5 12l-5 2" ${S}/><path d="M9.5 16.5q2 1.5 4 0M18.5 16.5q2 1.5 4 0" fill="none" ${S}/><path d="M12 24h8" ${S}/><path d="M7 25q-3 0-4 2.5q1.5-1 3-.5M25 25q3 0 4 2.5q-1.5-1-3-.5" fill="${W}" stroke="${K}" stroke-width="1.6" stroke-linejoin="round"/>`,
    sweat: head() + `<path d="M8.5 13q2.5-1.5 5 .5M23.5 13q-2.5-1.5-5 .5" fill="none" ${S}/><circle cx="12" cy="16.5" r="1.5" fill="${K}"/><circle cx="20" cy="16.5" r="1.5" fill="${K}"/><path d="M11.5 23.5q4.5-2.5 9 0" fill="none" ${S}/>` + drop(25, 6),
    panic: head('#d9f0ff') + gloom + `<circle cx="11.5" cy="16" r="3.2" fill="${W}" ${S}/><circle cx="20.5" cy="16" r="3.2" fill="${W}" ${S}/><circle cx="11.5" cy="16" r="1" fill="${K}"/><circle cx="20.5" cy="16" r="1" fill="${K}"/><path d="M10.5 24q1.8-2 3.6 0t3.6 0 3.6 0" fill="none" ${S}/>` + drop(26, 9, .9) + drop(4.5, 11, .7),
    dejected: head('#e2e2e2') + gloom + `<path d="M9 16.5q2.5 1.5 5 0M18 16.5q2.5 1.5 5 0" fill="none" ${S}/><path d="M11.5 24.5q4.5-3.5 9 0" fill="none" ${S}/>`,
  };
  // 絵文字(サーバの faces 設定)→ 顔アイコン。レベル判定は従来どおり
  const FACE = { '🤬': 'furious', '😠': 'angry', '😒': 'annoyed', '🤔': 'thinking', '😏': 'smirk', '😌': 'relieved', '😐': 'neutral', '🤨': 'skeptical', '🙂': 'smile', '😈': 'devil', '😤': 'huffy', '😓': 'sweat', '😰': 'panic', '😞': 'dejected' };
  const FACE_LABEL = { furious: '激怒', angry: '怒り', annoyed: '不機嫌', thinking: '考え中', smirk: 'にやり', relieved: 'ほっとした顔', neutral: '無表情', skeptical: '疑い', smile: 'にっこり', devil: '悪い笑み', huffy: 'ふんっ', sweat: '冷や汗', panic: '大焦り', dejected: 'がっくり' };
  function ICON(name, label, cls = '') {
    const body = P[name] || P.balloon;
    const a = label ? `role="img" aria-label="${String(label).replace(/"/g, '&quot;')}"><title>${label}</title` : 'aria-hidden="true"';
    return `<svg class="ico ico-${name} ${cls}" viewBox="0 0 32 32" focusable="false" ${a}>${body}</svg>`;
  }
  function face(emoji) { const k = FACE[emoji] || 'neutral'; return ICON(k, '表情: ' + FACE_LABEL[k], 'ico-face'); }
  // data-icon="name" を持つ要素の先頭にアイコンを差し込む(HTML側の静的アイコン用)
  function hydrate(root = document) { root.querySelectorAll('[data-icon]').forEach(el => { if (el.querySelector(':scope > svg.ico')) return; el.insertAdjacentHTML('afterbegin', ICON(el.dataset.icon, el.dataset.iconLabel || '')); }); }
  window.ICON = ICON; window.ICON.face = face; window.ICON.hydrate = hydrate; window.ICON.FACE = FACE;
  if (document.readyState !== 'loading') hydrate(); else document.addEventListener('DOMContentLoaded', () => hydrate());
})();
