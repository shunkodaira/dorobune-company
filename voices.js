// ボスごとの声。openai = OpenAI TTS(gpt-4o-mini-tts)の voice + instructions / gemini = Gemini TTS の prebuilt voice + style(読み上げられない演技指示)
const JA = '日本語のセリフを、自然な日本語の発音とイントネーションで演じてください。';
module.exports = {
  kakaricho: { voice: 'marin', speed: 1.35, instructions: JA + 'テンポよく速めに話す。30代後半の女性の経理係長。冷静で事務的、早口ぎみで一語一語はっきり。感情は抑えめだが、規程違反には冷たく鋭い口調。ため息まじりの皮肉も少し。' },
  kacho: { voice: 'ash', speed: 1.35, instructions: JA + 'テンポよく速めに話す。40代の元ラグビー部の熱血な男性課長。声が大きく豪快で、体育会系の勢いのある話し方。笑うときは豪快に、怒ると迫力がある。' },
  bucho: { voice: 'onyx', speed: 1.3, instructions: JA + 'テンポよく速めに話す。50代後半の昔ながらの頑固な男性部長。低くぶっきらぼうで、少し不機嫌。語尾を投げるように言い、間は短めにテンポよく話す。納得したときは渋々とした照れが混じる。' },
  joumu: { voice: 'verse', speed: 1.25, instructions: JA + 'テンポよく速めに話す。60代の悪徳常務(男性)。ねっとりとした慇懃無礼な話し方で、余裕たっぷりに相手を見下す。小さく鼻で笑う。追い詰められると声がうわずり、早口になる。' },
  senmu: { voice: 'ballad', speed: 1.3, instructions: JA + 'テンポよく速めに話す。60代の豪快な男性専務。よく通る太い声で、ガハハと笑うような陽気さ。ただし海外の話になると急に真剣で重みのある声になる。' },
  shacho: { voice: 'cedar', speed: 1.2, instructions: JA + 'テンポよく速めに話す。68歳の威厳ある男性社長。低く落ち着いた声で、落ち着いているがテンポよく話す。寡黙で重厚。感情はほとんど表に出さないが、一言一言に圧がある。' },
};
// Gemini TTS(gemini-3.8-flash-tts)用。style は speech_metadata.style に入るので読み上げられない
module.exports.GEMINI = {
  kakaricho: { voice: 'Kore', style: 'とても速いテンポで、間を詰めて。冷静かつ事務的に。冷ややかで鋭い口調' },
  kacho: { voice: 'Fenrir', style: 'とても速いテンポで、間を詰めて。声が大きく豪快に。体育会系の勢いで' },
  bucho: { voice: 'Algenib', style: 'とても速いテンポで、間を詰めて。ぶっきらぼうに不機嫌そうに。低い声で' },
  joumu: { voice: 'Algieba', style: '速いテンポで、ねっとりと慇懃無礼に、余裕たっぷりに' },
  senmu: { voice: 'Sadachbia', style: 'とても速いテンポで、間を詰めて。豪快で陽気に、よく通る声で' },
  shacho: { voice: 'Charon', style: '速いテンポで、間を詰めて。低く落ち着いた重厚な口調で、威厳をもって' },
};
// 表情(expr.js)ごとの一言を style に足す
module.exports.EXPR_STYLE = { yoyu: '余裕たっぷりに', takurami: '含み笑いを浮かべながら', aseri: '焦って声がうわずり気味に', odoroki: '驚いて', ikari: '怒りをにじませて', nattoku: '少し表情を和らげて' };
