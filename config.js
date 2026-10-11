// ロビー(出世の階段画面)のBGM設定 — ここ1か所で差し替える
// 1) public/ 以下に BGM_FILE (既定: public/audio/bgm.mp3) があれば、それを優先してループ再生(ロイヤリティフリー音源用)
// 2) なければ YouTube 埋め込み(IFrame Player API・プレイヤーは画面に表示)で BGM_YOUTUBE_ID を再生
//    ※既定の動画は市販サウンドトラックのため、ローカルでの試遊専用。提出版ではロイヤリティフリー音源に差し替えること
// 3) どちらも空ならBGMなし
module.exports = {
  BGM_FILE: process.env.BGM_FILE || 'audio/bgm.mp3',
  BGM_YOUTUBE_ID: process.env.BGM_YOUTUBE_ID ?? 'o3k-yf5RhlU',
  BGM_VOLUME: 35, // 0-100
  // BGM_FILE を使う時のクレジット(CC BY のため表示必須。BGMカードに小さく表示)
  BGM_CREDIT: {
    title: 'Clash Defiant', artist: 'Kevin MacLeod', url: 'https://incompetech.com/',
    license: 'CC BY 4.0', licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
  },
};
