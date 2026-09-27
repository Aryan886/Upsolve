export function ViewState({ loading, error, empty }: { loading: boolean; error: string | null; empty: boolean }) {
  if (loading) return <div className="view-state" role="status">Loading notes…</div>;
  if (error) return <div className="view-state error" role="alert">{error}</div>;
  if (empty) return <div className="view-state">No notes match these filters.</div>;
  return null;
}
