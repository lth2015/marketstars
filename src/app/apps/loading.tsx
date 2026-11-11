export default function Loading() {
  return (
    <div className="container" style={{ paddingTop: 32, paddingBottom: 32 }}>
      <div className="card-grid">{Array.from({ length: 6 }, (_, i) => <div key={i} className="skeleton" />)}</div>
    </div>
  );
}
