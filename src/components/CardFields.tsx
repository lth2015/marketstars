import { TEST_CARDS } from "@/lib/payments/provider";
import { getMessages } from "@/lib/messages";

export async function CardFields({ required = true }: { required?: boolean }) {
  const L = (await getMessages()).ui.card;
  return (
    <div className="stack" style={{ marginTop: 8 }}>
      <div className="form-row" style={{ margin: 0 }}><label htmlFor="cardNumber">{L.number}</label><input id="cardNumber" name="cardNumber" type="text" inputMode="numeric" autoComplete="cc-number" placeholder="4242 4242 4242 4242" required={required} /></div>
      <div className="grid-2">
        <div className="form-row" style={{ margin: 0 }}><label htmlFor="exp">{L.exp}</label><input id="exp" name="exp" type="text" autoComplete="cc-exp" placeholder="12/30" required={required} /></div>
        <div className="form-row" style={{ margin: 0 }}><label htmlFor="cvc">{L.cvc}</label><input id="cvc" name="cvc" type="text" inputMode="numeric" autoComplete="cc-csc" placeholder="123" required={required} /></div>
      </div>
      <details className="small muted"><summary>{L.testCards}</summary><ul style={{ margin: "6px 0 0" }}>{TEST_CARDS.map((c, i) => <li key={c.number}><code>{c.number}</code>：{L.testLabels[i] ?? c.label}</li>)}</ul></details>
    </div>
  );
}
