// クチコミ返信アシスタントの返信案（テンプレート）。純粋関数のため単体テスト対象。
type Topic = { keys: RegExp; thanks?: string; sorry?: string };
const TOPICS: Topic[] = [
  { keys: /待ち|待た|遅|時間がかか|混/, sorry: "お待たせしてしまい、大変申し訳ございませんでした。ご案内とご提供の流れを見直してまいります。" },
  { keys: /美味|おいし|うま|味/, thanks: "お料理を気に入っていただけたとのこと、スタッフ一同とても励みになります。" },
  { keys: /接客|スタッフ|店員|対応/, thanks: "スタッフの対応にも触れていただき、ありがとうございます。", sorry: "スタッフの対応でご不快な思いをおかけし、申し訳ございません。教育を徹底いたします。" },
  { keys: /清潔|きれい|綺麗|汚/, thanks: "店内の清潔さにも目を向けていただき、うれしく思います。", sorry: "店内の清掃が行き届いておらず、申し訳ございません。" },
  { keys: /高い|値段|価格|コスパ/, sorry: "価格に見合うご満足をお届けできるよう、内容を見直してまいります。" },
];

const OPEN: Record<string, string[]> = {
  polite: ["この度はご来店いただき、誠にありがとうございました。", "数あるお店の中からお選びいただき、ありがとうございます。", "ご来店ならびに温かいクチコミを、ありがとうございます。"],
  friendly: ["ご来店ありがとうございました！", "クチコミありがとうございます！", "お越しいただきありがとうございました！"],
  brief: ["ご来店ありがとうございました。", "クチコミありがとうございます。", "ご利用ありがとうございました。"],
};

const POSITIVE = /良|よか|丁寧|親切|美味|おいし|うま|きれい|綺麗|清潔|満足|最高|ありがと|助か/;
const NEGATIVE = /悪|不快|遅|待た|待ち|汚|高い|残念|ひど|冷た|雑|不満|がっかり/;

/** 話題ごとに、その話題に触れた文の調子でお礼かお詫びかを決める（文に手がかりがなければ評価で決める）。 */
function topicLines(review: string, negativeRating: boolean): string[] {
  const sentences = review.split(/[。！!？?\n]|けど|けれど|が、/).map((x) => x.trim()).filter(Boolean);
  const out: string[] = [];
  for (const t of TOPICS) {
    const sentence = sentences.find((x) => t.keys.test(x));
    if (!sentence) continue;
    const neg = NEGATIVE.test(sentence) ? true : POSITIVE.test(sentence) ? false : negativeRating;
    const line = neg ? t.sorry ?? t.thanks : t.thanks ?? t.sorry;
    if (line) out.push(line);
  }
  return out;
}

const NEG_HEAD = ["貴重なご意見をいただき、ありがとうございます。", "ご来店いただき、また率直なご感想をお寄せいただき、ありがとうございます。", "このたびはご来店ありがとうございました。ご意見を拝見いたしました。"];

/** テンプレートで返信案を 3 案作る。評価が 2 以下ならお詫びを先に、指摘された話題ごとに一文を添える。3 案は書き出し・本文の量・結びを変える。 */
export function draftReplies(review: string, rating: number, store: string, tone: string, locale: "ja" | "en" = "ja"): string[] {
  if (locale === "en") return draftRepliesEn(review, rating, store, tone);
  const opens = OPEN[tone] ?? OPEN.polite;
  const negative = rating <= 2;
  const lines = topicLines(review, negative);
  const closing = negative
    ? ["いただいたご意見を真摯に受け止め、改善に努めてまいります。", "もしよろしければ、改めてお越しいただけましたら幸いです。", "次回はご満足いただけるよう、スタッフ一同努めてまいります。"]
    : ["またのお越しを心よりお待ちしております。", "次回も楽しんでいただけるよう、準備してお待ちしております。", "これからもどうぞよろしくお願いいたします。"];
  return [0, 1, 2].map((i) => {
    const body = i === 1 ? lines.slice(0, 1) : lines;
    const head = negative ? NEG_HEAD[i] : opens[i % opens.length];
    return [head, ...body, closing[i], tone === "brief" ? "" : `${store} スタッフ一同`].filter(Boolean).join("\n");
  });
}

// ---- English ----
const TOPICS_EN: Topic[] = [
  { keys: /wait|slow|long time|queue|crowd|待ち|待た|遅/i, sorry: "We are very sorry to have kept you waiting. We are reviewing how we seat and serve our guests." },
  { keys: /delicious|tasty|food|meal|flavou?r|美味|おいし|味/i, thanks: "We are delighted you enjoyed the food; it means a lot to our team." },
  { keys: /staff|service|server|friendly|rude|接客|スタッフ|店員|対応/i, thanks: "Thank you for your kind words about our staff.", sorry: "We apologise that our service fell short. We will address this with our team." },
  { keys: /clean|dirty|tidy|清潔|きれい|汚/i, thanks: "Thank you for noticing how we keep the place clean.", sorry: "We are sorry the space was not as clean as it should be." },
  { keys: /price|expensive|value|cost|高い|値段|価格/i, sorry: "We will review our offering so that it feels worth the price." },
];
const POSITIVE_EN = /good|great|delicious|tasty|friendly|kind|clean|love|excellent|nice|amazing|helpful|良|丁寧|美味|おいし|きれい/i;
const NEGATIVE_EN = /bad|slow|wait|dirty|rude|expensive|disappoint|poor|cold|terrible|not |遅|待た|汚|高い|残念/i;
const OPEN_EN: Record<string, string[]> = {
  polite: ["Thank you very much for visiting us and for taking the time to leave a review.", "Thank you for choosing us among so many places.", "Thank you for your visit and your kind review."],
  friendly: ["Thanks so much for coming in!", "Thanks for the review!", "So glad you stopped by!"],
  brief: ["Thank you for visiting.", "Thank you for the review.", "Thanks for coming."],
};
const NEG_HEAD_EN = ["Thank you for your honest feedback.", "Thank you for visiting and for sharing your experience with us.", "Thank you for your visit. We have read your comments carefully."];

export function draftRepliesEn(review: string, rating: number, store: string, tone: string): string[] {
  const opens = OPEN_EN[tone] ?? OPEN_EN.polite;
  const negative = rating <= 2;
  const sentences = review.split(/[.!?\n。！？]|\bbut\b|けど/i).map((x) => x.trim()).filter(Boolean);
  const lines: string[] = [];
  for (const t of TOPICS_EN) {
    const sentence = sentences.find((x) => t.keys.test(x));
    if (!sentence) continue;
    const neg = NEGATIVE_EN.test(sentence) ? true : POSITIVE_EN.test(sentence) ? false : negative;
    const line = neg ? t.sorry ?? t.thanks : t.thanks ?? t.sorry;
    if (line) lines.push(line);
  }
  const closing = negative
    ? ["We take your feedback seriously and will keep improving.", "We would be grateful for the chance to welcome you again.", "We will do our best to make your next visit a better one."]
    : ["We look forward to seeing you again soon.", "We will be ready to welcome you on your next visit.", "Thank you again, and see you soon."];
  return [0, 1, 2].map((i) => {
    const body = i === 1 ? lines.slice(0, 1) : lines;
    const head = negative ? NEG_HEAD_EN[i] : opens[i % opens.length];
    return [head, ...body, closing[i], tone === "brief" ? "" : `The team at ${store}`].filter(Boolean).join("\n");
  });
}
