// 演示身份：仅 AUTH_MODE=demo（本地/开发）使用，生产禁止。数据为合成数据。
export type DemoTenant = { id: string; name: string; owner: boolean };
export type DemoPersona = { userId: string; name: string; email: string; description: string; tenants: DemoTenant[] };

export const DEMO_PERSONAS: DemoPersona[] = [
  {
    userId: "demo0000000000000000000000000001",
    name: "山田 花子",
    email: "hanako@example.test",
    description: "2つの店舗空間のオーナー",
    tenants: [
      { id: "demo-tenant-sakura", name: "さくらベーカリー", owner: true },
      { id: "demo-tenant-minato", name: "みなと美容室", owner: true },
    ],
  },
  {
    userId: "demo0000000000000000000000000002",
    name: "佐藤 健",
    email: "ken@example.test",
    description: "さくらベーカリーのメンバー（オーナーではない）",
    tenants: [{ id: "demo-tenant-sakura", name: "さくらベーカリー", owner: false }],
  },
  {
    userId: "demo0000000000000000000000000005",
    name: "開発 次郎",
    email: "dev@example.test",
    description: "アプリ提供会社（開発者ポータルで掲載申請）",
    tenants: [{ id: "demo-tenant-devco", name: "ミライAI合同会社", owner: true }],
  },
  {
    userId: "demo0000000000000000000000000009",
    name: "運営 太郎",
    email: "ops@example.test",
    description: "MarketStars 運営（運営空間メンバー＋運営権限）",
    tenants: [
      { id: "demo-ops-tenant", name: "MarketStars 運営", owner: true },
      { id: "demo-tenant-test", name: "社内テスト店舗", owner: true },
    ],
  },
];
