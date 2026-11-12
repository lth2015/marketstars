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
export function draftReplies(review: string, rating: number, store: string, tone: string): string[] {
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
