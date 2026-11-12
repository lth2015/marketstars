// デモ用のアプリ画面モックアップ（SVG）。実在サービスの画面ではなく、各アプリの用途を示す合成イメージ。
// 4 種類のレイアウト（生成・チャット・ダッシュボード・一覧）に、アプリごとの見出しとサンプル文を差し込む。
type Kind = "generator" | "chat" | "dashboard" | "list";
type Spec = { kind: Kind; screens: [string, string, string]; input: string[]; items: string[] };

const SPECS: Record<string, Spec> = {
  "pop-writer": { kind: "generator", screens: ["POP文案の作成", "生成履歴", "SNS投稿用に整形"], input: ["商品名：北海道バターのクロワッサン", "特徴：サクサク、焼きたて", "トーン：親しみやすく"], items: ["朝いちばんの、サクッと幸せ。", "バター香る焼きたてを、今だけ。", "手みやげにも、ごほうびにも。"] },
  "review-reply": { kind: "generator", screens: ["返信案の作成", "未返信のクチコミ", "お店のトーン設定"], input: ["★★★★☆ 料理は美味しかったです", "少し待ち時間が長かったかな", "トーン：丁寧・感謝"], items: ["ご来店ありがとうございました。", "お待たせしてしまい申し訳ありません。", "またのお越しをお待ちしております。"] },
  "event-planner": { kind: "generator", screens: ["販促アイデア", "実施スケジュール", "過去の施策"], input: ["時期：12月", "業種：ベーカリー", "予算：小規模"], items: ["クリスマス限定シュトーレン予約", "年末の詰め合わせセット", "冬季限定ホットドリンク"] },
  "menu-translator": { kind: "generator", screens: ["メニューの翻訳", "言語の切り替え", "印刷用レイアウト"], input: ["元の言語：日本語", "翻訳先：English / 中文 / 한국어", "アレルギー表記：あり"], items: ["Grilled Mackerel Set", "盐烤青花鱼套餐", "고등어 소금구이 정식"] },
  "faq-bot": { kind: "chat", screens: ["Webサイトのチャット", "回答の登録", "よくある質問の分析"], input: [], items: ["駐車場はありますか？", "店舗裏に5台分ございます。", "アレルギー表示はありますか？", "全商品に表示しています。"] },
  "phone-concierge": { kind: "chat", screens: ["通話の要約", "予約の受付", "通知の設定"], input: [], items: ["明日19時に4名で予約したいです", "19時・4名様でお取りしました。", "駐車場について知りたい", "近隣のコインパーキングをご案内しました。"] },
  "sales-insight": { kind: "dashboard", screens: ["日次レポート", "曜日・時間帯の傾向", "打ち手の提案"], input: ["今日の売上 ¥182,400", "客数 214人", "客単価 ¥852"], items: ["月", "火", "水", "木", "金", "土", "日"] },
  "inventory-alert": { kind: "dashboard", screens: ["欠品予測", "発注のタイミング", "通知の設定"], input: ["欠品予測 3品目", "発注推奨 5品目", "在庫回転 12.4日"], items: ["牛乳", "卵", "食パン", "バター", "小麦粉", "砂糖", "コーヒー豆"] },
  "shift-planner": { kind: "dashboard", screens: ["来週のシフト案", "スタッフの希望", "人件費の見通し"], input: ["人件費率 24.8%", "必要人数 充足", "希望反映 92%"], items: ["月", "火", "水", "木", "金", "土", "日"] },
  "customer-notes": { kind: "list", screens: ["顧客カルテ", "音声メモの要約", "次回来店の準備"], input: [], items: ["佐々木 様｜カラー・前回から6週間", "田中 様｜カット・乾燥肌を気にされている", "山本 様｜パーマ・次回は11月下旬", "高橋 様｜トリートメント・敏感肌"] },
  "receipt-clerk": { kind: "list", screens: ["読み取り結果", "勘定科目の確認", "会計ソフト向け出力"], input: [], items: ["11/08 文具店 ¥1,320｜消耗品費", "11/09 青果市場 ¥8,640｜仕入高", "11/10 タクシー ¥2,180｜旅費交通費", "11/11 郵便局 ¥520｜通信費"] },
  "contract-check": { kind: "list", screens: ["確認すべき条項", "条項の比較", "チェックリスト"], input: [], items: ["第5条 支払期日｜60日は長め", "第9条 損害賠償｜上限の定めなし", "第12条 解約予告｜3か月前", "第15条 管轄｜相手方所在地"] },
};

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const T = (x: number, y: number, s: string, size = 22, fill = "#142235", weight = 400, anchor = "start") =>
  `<text x="${x}" y="${y}" font-size="${size}" fill="${fill}" font-weight="${weight}" text-anchor="${anchor}" font-family="Noto Sans JP, Hiragino Sans, sans-serif">${esc(s)}</text>`;
const R = (x: number, y: number, w: number, h: number, fill = "#fff", r = 14, stroke = "#E4E8EF") => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}" stroke="${stroke}"/>`;

function frame(color: string, appName: string, screen: string, nav: string[], active: number, body: string) {
  const navItems = nav.map((n, i) => `${i === active ? R(24, 104 + i * 56, 232, 44, color + "1A", 10, "none") : ""}${T(44, 133 + i * 56, n, 20, i === active ? color : "#526174", i === active ? 700 : 400)}`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 800"><rect width="1280" height="800" fill="#F7F8FA"/>`
    + `<rect width="1280" height="72" fill="${color}"/>${T(32, 46, appName, 26, "#fff", 700)}${T(1248, 46, "さくらベーカリー", 18, "#fff", 400, "end")}`
    + `<rect x="0" y="72" width="280" height="728" fill="#fff"/><rect x="280" y="72" width="1" height="728" fill="#E4E8EF"/>${navItems}`
    + T(320, 128, screen, 30, "#142235", 700) + body + `</svg>`;
}

function generator(c: string, s: Spec, variant: number) {
  const form = s.input.map((t, i) => R(320, 168 + i * 72, 400, 56, "#fff", 10) + T(340, 203 + i * 72, t, 19, "#142235")).join("")
    + R(320, 392, 400, 56, c, 10, c) + T(520, 427, variant === 2 ? "整形する" : "パターンを作成", 20, "#fff", 700, "middle");
  const out = s.items.map((t, i) => R(760, 168 + i * 156, 480, 136) + T(784, 206 + i * 156, `案 ${i + 1}`, 16, c, 700) + T(784, 246 + i * 156, t, 24, "#142235", 700)
    + R(784, 268 + i * 156, 120, 16, "#EEF1F5", 8, "none") + R(1112, 254 + i * 156, 104, 36, "#fff", 8, c) + T(1164, 278 + i * 156, "コピー", 16, c, 700, "middle")).join("");
  return form + out;
}

function chat(c: string, s: Spec) {
  return R(320, 160, 920, 600) + s.items.map((t, i) => {
    const me = i % 2 === 0;
    const w = Math.min(560, 60 + t.length * 24);
    const x = me ? 360 : 1200 - w;
    return R(x, 196 + i * 128, w, 72, me ? "#EEF1F5" : c, 18, "none") + T(x + 24, 240 + i * 128, t, 21, me ? "#142235" : "#fff", me ? 400 : 700);
  }).join("") + R(360, 690, 760, 48, "#fff", 24) + T(388, 721, "メッセージを入力…", 18, "#8A96A8") + `<circle cx="1176" cy="714" r="24" fill="${c}"/>`;
}

function dashboard(c: string, s: Spec, variant: number) {
  const tiles = s.input.map((t, i) => { const [label, value] = t.split(" "); return R(320 + i * 312, 160, 288, 120) + T(344 + i * 312, 200, label, 18, "#526174") + T(344 + i * 312, 252, value, 34, "#142235", 700); }).join("");
  const vals = [52, 61, 48, 70, 88, 100, 93];
  if (variant === 1) {
    const grid = s.items.map((d, i) => T(452 + i * 112, 340, d, 18, "#526174", 700, "middle")).join("")
      + [0, 1, 2, 3].map((r) => s.items.map((_, i) => R(400 + i * 112, 360 + r * 92, 100, 76, (r + i) % 3 === 0 ? c + "33" : "#fff", 10)).join("")).join("");
    return tiles + R(320, 304, 920, 456) + grid;
  }
  const bars = vals.map((v, i) => R(400 + i * 116, 700 - v * 3.4, 72, v * 3.4, i === 5 ? c : c + "99", 6, "none") + T(436 + i * 116, 732, s.items[i] ?? "", 18, "#526174", 400, "middle")).join("");
  return tiles + R(320, 304, 920, 456) + T(344, 344, variant === 2 ? "今週のおすすめ施策" : "直近7日間", 20, "#142235", 700) + bars;
}

function list(c: string, s: Spec, variant: number) {
  const head = R(320, 160, 920, 56, "#EEF1F5", 10, "none") + T(344, 196, variant === 2 ? "出力の確認" : "最新の記録", 19, "#526174", 700);
  const rows = s.items.map((t, i) => {
    const [a, b] = t.split("｜");
    return R(320, 232 + i * 112, 920, 96) + `<circle cx="368" cy="${280 + i * 112}" r="22" fill="${c}33"/>` + T(408, 272 + i * 112, a, 22, "#142235", 700) + T(408, 304 + i * 112, b ?? "", 18, "#526174")
      + R(1104, 262 + i * 112, 112, 36, i === 1 ? c : "#fff", 18, c) + T(1160, 286 + i * 112, i === 1 ? "要確認" : "確認済み", 15, i === 1 ? "#fff" : c, 700, "middle");
  }).join("");
  return head + rows;
}

/** アプリのスクリーンショット 3 枚（data URL）。定義がないアプリは汎用レイアウト。 */
export function appMockups(slug: string, appName: string, color: string): { url: string; alt: string }[] {
  const s = SPECS[slug] ?? { kind: "list" as Kind, screens: ["ホーム", "一覧", "設定"] as [string, string, string], input: [], items: ["サンプル 1｜説明", "サンプル 2｜説明", "サンプル 3｜説明", "サンプル 4｜説明"] };
  return s.screens.map((screen, v) => {
    const body = s.kind === "generator" ? generator(color, s, v) : s.kind === "chat" ? chat(color, s) : s.kind === "dashboard" ? dashboard(color, s, v) : list(color, s, v);
    const svg = frame(color, appName, screen, s.screens, v, body);
    return { url: "data:image/svg+xml;base64," + Buffer.from(svg).toString("base64"), alt: `${appName}：${screen}の画面イメージ` };
  });
}
