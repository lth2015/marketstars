// 演示脚本：沿着功能主线，每一步指定「以谁、在哪个空间、打开哪个页面」。仅 AUTH_MODE=demo 使用。
// 身份与空间必须是 demo-identities.ts 中存在的组合（tests/unit/demo-scenarios.test.ts 会校验）。
export const P = {
  hanako: "demo0000000000000000000000000001",
  ken: "demo0000000000000000000000000002",
  jiro: "demo0000000000000000000000000005",
  taro: "demo0000000000000000000000000009",
} as const;
export const T = {
  sakura: "demo-tenant-sakura",
  minato: "demo-tenant-minato",
  devco: "demo-tenant-devco",
  ops: "demo-ops-tenant",
} as const;

export type DemoStep = {
  title: string;
  hint: string;
  path: string;
  /** 省略时以访客身份打开（会先退出当前登录）。 */
  as?: { userId: string; tenantId: string };
};
export type DemoScenario = { id: string; title: string; summary: string; steps: DemoStep[] };

export const DEMO_SCENARIOS: DemoScenario[] = [
  {
    id: "trial",
    title: "1. はじめての無料体験：探す → 体験開始 → アプリで使う",
    summary: "ゲストが目的のアプリを見つけ、ログインして無料体験を始め、マーケットから連携アプリを開いてAIで販促文を作るまで。自動課金されないことも確認できます。",
    steps: [
      { title: "ゲストとして無料体験できるアプリを探す", hint: "カテゴリ・業種で絞り込み、並び替えても URL に条件が残ります。", path: "/apps?trial=true" },
      { title: "詳細ページから「14日間無料で試す」", hint: "さくらベーカリーのオーナーとして申し込みます。体験後に自動課金されない旨が表示されます。", path: "/apps/pop-writer", as: { userId: P.hanako, tenantId: T.sakura } },
      { title: "マイアプリから「アプリを開く」→ AI でPOP文案を作成", hint: "ワンタイムの起動コードで連携アプリに入り、権利チェックを通過した上で AI が文案を生成します。", path: "/my/apps", as: { userId: P.hanako, tenantId: T.sakura } },
    ],
  },
  {
    id: "card",
    title: "2. 有料プランをカードで申し込む（即時開始・自動更新）",
    summary: "テストカード 4242 4242 4242 4242 で支払うと、その場で利用が始まり、請求・お支払いに記録とカードが残ります。4000 0000 0000 0002 ではカード拒否の表示を確認できます。",
    steps: [
      { title: "売上インサイトAIのプランを選んで申し込む", hint: "みなと美容室のオーナーとして、カード払いを選びます。", path: "/apps/sales-insight/apply", as: { userId: P.hanako, tenantId: T.minato } },
      { title: "請求・お支払いで支払い記録と登録カードを確認", hint: "金額はすべて税込。自動更新に使われているカードも表示されます。", path: "/my/billing", as: { userId: P.hanako, tenantId: T.minato } },
    ],
  },
  {
    id: "invoice",
    title: "3. 請求書払い → 運営が入金を確認して開始",
    summary: "申し込みは「申込中」のまま。運営が外部の入金証憑番号と金額を入力して確認した時点から1か月の利用期間が始まります。同じ証憑の二重確認はできません。",
    steps: [
      { title: "顧客カルテAIを請求書払いで申し込む", hint: "さくらベーカリーのオーナーとして「請求書払い」を選びます。", path: "/apps/customer-notes/apply", as: { userId: P.hanako, tenantId: T.sakura } },
      { title: "運営：お申し込みの処理で入金を確認", hint: "証憑番号と金額（¥2,200）を入力して確認します。", path: "/admin/requests", as: { userId: P.taro, tenantId: T.ops } },
      { title: "顧客側：利用中になったことを確認", hint: "マイアプリで「利用中」、契約内容に利用期間が表示されます。", path: "/my/apps", as: { userId: P.hanako, tenantId: T.sakura } },
    ],
  },
  {
    id: "manage",
    title: "4. 契約の管理：期末解約・取り消し・プラン変更",
    summary: "有料契約は期間終了時に解約（日割りなし）、解約予定は取り消し可能。プラン変更は次の期間から反映されます。シナリオ2の後に実施してください。",
    steps: [
      { title: "マイアプリから契約内容を開いて操作する", hint: "みなと美容室のオーナーとして、期末解約 → 取り消し、プラン変更を試します。", path: "/my/apps", as: { userId: P.hanako, tenantId: T.minato } },
    ],
  },
  {
    id: "roles",
    title: "5. 権限と空間の分離",
    summary: "メンバーは申し込みできず、オーナーへの依頼を案内されます。空間を切り替えるとマイアプリと請求がそれぞれの空間のものに変わります。",
    steps: [
      { title: "メンバー（オーナーではない）で詳細ページを見る", hint: "佐藤 健（さくらベーカリーのメンバー）。申し込みボタンの代わりに案内が表示されます。", path: "/apps/sales-insight", as: { userId: P.ken, tenantId: T.sakura } },
      { title: "オーナーで空間を切り替えて比べる", hint: "山田 花子で「切り替える」から さくらベーカリー ⇄ みなと美容室。", path: "/my/apps", as: { userId: P.hanako, tenantId: T.sakura } },
    ],
  },
  {
    id: "developer",
    title: "6. 開発者の掲載申請 → 運営の審査 → 公開",
    summary: "提供会社が開発者ポータルでアプリを登録・提出し、運営が審査して公開すると、一覧に表示されます。必須項目が足りないと提出できません。",
    steps: [
      { title: "開発者ポータルで登録し、アプリを作成して提出", hint: "開発 次郎（ミライAI合同会社）。", path: "/developer", as: { userId: P.jiro, tenantId: T.devco } },
      { title: "運営：掲載審査で差し戻し／承認", hint: "承認すると公開され、一覧と詳細に表示されます。", path: "/admin/submissions", as: { userId: P.taro, tenantId: T.ops } },
    ],
  },
  {
    id: "ops",
    title: "7. 運営ダッシュボードと台帳",
    summary: "MRR・有料契約数・体験からの転換率などの KPI はデータベースの実数から計算され、グラフには表形式の表示もあります。お金の動きは改ざん検知できる台帳に記録されます。",
    steps: [
      { title: "運営 KPI", hint: "運営 太郎（MarketStars 運営）。", path: "/admin/analytics", as: { userId: P.taro, tenantId: T.ops } },
      { title: "改ざん検知台帳", hint: "ハッシュチェーンの検証結果と CSV 出力。", path: "/admin/ledger", as: { userId: P.taro, tenantId: T.ops } },
    ],
  },
  {
    id: "agent",
    title: "8. AIエージェントによる購入（AgentPay）",
    summary: "オーナーが上限付きの支払い権限をエージェントに発行し、エージェントは API でアプリを検索・購入します。1回あたりの上限と月の予算を超える購入は拒否されます。",
    steps: [
      { title: "支払い権限（エージェントキー）を発行する", hint: "さくらベーカリーのオーナーとして。カードの登録が必要です（テストカード 4242…）。", path: "/my/agents", as: { userId: P.hanako, tenantId: T.sakura } },
    ],
  },
  {
    id: "english",
    title: "9. English UI",
    summary: "フッターの Language から英語表示に切り替えられます。業務エラーやお知らせ文も英語になります。",
    steps: [{ title: "英語表示でアプリ一覧を開く", hint: "日本語へはフッターの「言語」から戻せます。", path: "/locale?set=en&returnTo=%2Fapps" }],
  },
];
