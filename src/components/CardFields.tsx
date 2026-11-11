import { TEST_CARDS } from "@/lib/payments/provider";

export function CardFields({ required = true }: { required?: boolean }) {
  return (
    <div className="stack" style={{ marginTop: 8 }}>
      <div className="form-row" style={{ margin: 0 }}><label htmlFor="cardNumber">カード番号</label><input id="cardNumber" name="cardNumber" type="text" inputMode="numeric" autoComplete="cc-number" placeholder="4242 4242 4242 4242" required={required} /></div>
      <div className="grid-2">
        <div className="form-row" style={{ margin: 0 }}><label htmlFor="exp">有効期限（MM/YY）</label><input id="exp" name="exp" type="text" autoComplete="cc-exp" placeholder="12/30" required={required} /></div>
        <div className="form-row" style={{ margin: 0 }}><label htmlFor="cvc">セキュリティコード</label><input id="cvc" name="cvc" type="text" inputMode="numeric" autoComplete="cc-csc" placeholder="123" required={required} /></div>
      </div>
      <details className="small muted"><summary>テスト用カード番号（デモ決済）</summary><ul style={{ margin: "6px 0 0" }}>{TEST_CARDS.map((c) => <li key={c.number}><code>{c.number}</code>：{c.label}</li>)}</ul></details>
    </div>
  );
}
