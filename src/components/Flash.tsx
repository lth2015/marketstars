export function Flash({ msg, error }: { msg?: string; error?: string }) {
  return (
    <>
      {msg && <div className="alert alert-ok" role="status">{msg}</div>}
      {error && <div className="alert alert-error" role="alert">{error}</div>}
    </>
  );
}
