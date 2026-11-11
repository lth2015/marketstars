// 服务端渲染的 SVG 图表（无客户端 JS）。配色已用 dataviz 校验器验证（白色背景，两色 CVD ΔE 26.8）。
// 每根柱子有覆盖整列的透明命中区域 + <title> 悬停提示；图例与表格视图保证不只靠颜色识别。
import { yen } from "@/lib/text";

export const SERIES = { subscription: "#185ABD", usage: "#eb6834" } as const;
const GRID = "#E4E8EF";
const INK2 = "#526174";

function niceMax(v: number) {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  return [1, 2, 2.5, 5, 10].map((m) => m * p).find((x) => x >= v)!;
}
const compact = (n: number) => (n >= 10000 ? `${Math.round(n / 1000).toLocaleString("ja-JP")}千` : n.toLocaleString("ja-JP"));

/** 上端圆角、底端平直的柱子路径。 */
function bar(x: number, y: number, w: number, h: number, r: number) {
  if (h <= 0) return "";
  const rr = Math.min(r, h, w / 2);
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`;
}

type Stack = { label: string; values: { key: string; name: string; value: number; color: string }[] };

export function StackedBars({ data, title, money = true, height = 220 }: { data: Stack[]; title: string; money?: boolean; height?: number }) {
  const W = 480, H = height, L = 60, R = 8, T = 12, B = 30;
  const pw = W - L - R, ph = H - T - B;
  const max = niceMax(Math.max(...data.map((d) => d.values.reduce((a, v) => a + Math.max(0, v.value), 0))));
  const step = pw / data.length;
  const bw = Math.min(40, step * 0.55);
  const fmt = (n: number) => (money ? yen(n) : n.toLocaleString("ja-JP"));
  const keys = data[0]?.values.map((v) => ({ name: v.name, color: v.color })) ?? [];
  return (
    <figure style={{ margin: 0 }}>
      <figcaption style={{ fontWeight: 700, marginBottom: 6 }}>{title}</figcaption>
      {keys.length > 1 && (
        <div className="row small" style={{ gap: 16, marginBottom: 4 }} aria-hidden>
          {keys.map((k) => <span key={k.name} className="row" style={{ gap: 6 }}><span style={{ width: 10, height: 10, borderRadius: 2, background: k.color, display: "inline-block" }} />{k.name}</span>)}
        </div>
      )}
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={title} style={{ display: "block", maxWidth: W }}>
        {[0, 0.5, 1].map((f) => {
          const y = T + ph - f * ph;
          return <g key={f}><line x1={L} x2={W - R} y1={y} y2={y} stroke={GRID} strokeWidth={1} /><text x={L - 8} y={y + 4} textAnchor="end" fontSize={13} fill={INK2}>{money ? `¥${compact(max * f)}` : compact(max * f)}</text></g>;
        })}
        {data.map((d, i) => {
          const cx = L + step * i + step / 2;
          let acc = 0;
          const total = d.values.reduce((a, v) => a + Math.max(0, v.value), 0);
          const segs = d.values.filter((v) => v.value > 0);
          return (
            <g key={d.label}>
              {segs.map((v, j) => {
                const h = (v.value / max) * ph;
                const y = T + ph - acc - h;
                acc += h;
                const top = j === segs.length - 1;
                // 段与段之间留 2px 背景间隙；只有最上段有圆角
                const gap = j > 0 ? 2 : 0;
                return <path key={v.key} d={top ? bar(cx - bw / 2, y, bw, h - gap, 4) : `M${cx - bw / 2},${y}h${bw}v${h - gap}h${-bw}Z`} fill={v.color} />;
              })}
              <text x={cx} y={H - 8} textAnchor="middle" fontSize={13} fill={INK2}>{d.label.slice(5)}月</text>
              <rect x={cx - step / 2} y={T} width={step} height={ph} fill="transparent">
                <title>{`${d.label}\n${d.values.map((v) => `${v.name}：${fmt(v.value)}`).join("\n")}${d.values.length > 1 ? `\n合計：${fmt(total)}` : ""}`}</title>
              </rect>
            </g>
          );
        })}
      </svg>
      <details className="small" style={{ marginTop: 4 }}>
        <summary>表で見る</summary>
        <table className="table" style={{ marginTop: 6 }}>
          <thead><tr><th>月</th>{keys.map((k) => <th key={k.name}>{k.name}</th>)}{keys.length > 1 && <th>合計</th>}</tr></thead>
          <tbody>{data.map((d) => <tr key={d.label}><td>{d.label}</td>{d.values.map((v) => <td key={v.key}>{fmt(v.value)}</td>)}{keys.length > 1 && <td>{fmt(d.values.reduce((a, v) => a + v.value, 0))}</td>}</tr>)}</tbody>
        </table>
      </details>
    </figure>
  );
}

export function StatTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="panel" style={{ padding: 20 }}>
      <div className="small muted">{label}</div>
      <div style={{ fontSize: 30, fontWeight: 800, lineHeight: 1.3 }}>{value}</div>
      {sub && <div className="small muted">{sub}</div>}
    </div>
  );
}

export const pct = (r: number | null) => (r === null ? "—" : `${(r * 100).toFixed(1)}%`);
