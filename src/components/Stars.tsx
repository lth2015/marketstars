export function Stars({ value, count, size = 14 }: { value: number | null; count: number; size?: number }) {
  if (!count || value === null) return null;
  const full = Math.round(value);
  return (
    <span style={{ fontSize: size, whiteSpace: "nowrap" }} aria-label={`評価 ${value.toFixed(1)}（${count}件）`}>
      <span style={{ color: "#D97706" }} aria-hidden>{"★".repeat(full)}{"☆".repeat(5 - full)}</span> <strong>{value.toFixed(1)}</strong> <span className="muted">({count})</span>
    </span>
  );
}
