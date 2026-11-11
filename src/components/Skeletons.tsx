import { getMessages } from "@/lib/messages";

// 加载中的骨架屏（PRD §10 状态反馈）。
// 注意：loading.tsx 会让所在分段以 200 开始流式输出，之后 notFound() 无法再返回 404。
// 因此只放在不会 notFound() 的列表页（用路由组 (list) 隔开），详情页不加骨架屏。外层带 aria-busy 与读屏文字，动画遵循 prefers-reduced-motion（globals.css）。
async function Busy({ children }: { children: React.ReactNode }) {
  const t = await getMessages();
  return (
    <div className="container" style={{ paddingTop: 32, paddingBottom: 64 }} aria-busy="true">
      <span className="sr-only" role="status">{t.ui.loading}</span>
      {children}
    </div>
  );
}
const Line = ({ w, h = 16, mt = 0 }: { w: string; h?: number; mt?: number }) => <div className="skeleton-line" style={{ width: w, height: h, marginTop: mt }} />;

export function ListSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <Busy>
      <Line w="30%" h={32} />
      <Line w="50%" mt={12} />
      <div className="stack" style={{ marginTop: 24 }}>{Array.from({ length: rows }, (_, i) => <div key={i} className="skeleton" style={{ height: 88 }} />)}</div>
    </Busy>
  );
}

export function GridSkeleton() {
  return (
    <Busy>
      <div className="card-grid">{Array.from({ length: 6 }, (_, i) => <div key={i} className="skeleton" />)}</div>
    </Busy>
  );
}
