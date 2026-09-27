import { useMemo, useState } from "react";
import { NOTE_TYPES, type NoteType } from "@cp-notes/shared";
import { getFeed } from "../api";
import { localDateBoundary } from "../format";
import { usePagedResource } from "../hooks";
import { NoteCollection } from "../components/NoteCollection";
import { Pagination } from "../components/Pagination";
import { ViewState } from "../components/ViewState";

export function FeedPage({ revision, onChanged }: { revision: number; onChanged: () => void }) {
  const [page, setPage] = useState(1);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [types, setTypes] = useState<NoteType[]>([...NOTE_TYPES]);

  const query = useMemo(() => {
    const params = new URLSearchParams({ page: String(page), limit: "20" });
    if (types.length !== NOTE_TYPES.length) params.set("types", types.join(","));
    const fromDate = localDateBoundary(from, false);
    const toDate = localDateBoundary(to, true);
    if (fromDate) params.set("from", fromDate);
    if (toDate) params.set("to", toDate);
    return params.toString();
  }, [page, from, to, types]);

  const resource = usePagedResource((signal) => getFeed(query, signal), [query, revision]);

  function toggleType(type: NoteType): void {
    setPage(1);
    setTypes((current) => current.includes(type) ? current.filter((value) => value !== type) : [...current, type]);
  }

  return (
    <section>
      <header className="page-heading"><span className="eyebrow">Your diary</span><h2>Recent notes</h2><p>Everything you captured, newest first.</p></header>
      <div className="filter-card">
        <div className="filter-group"><span className="filter-label">Types</span><div className="check-row">{NOTE_TYPES.map((type) => <label key={type}><input type="checkbox" checked={types.includes(type)} onChange={() => toggleType(type)} /> {type}</label>)}</div></div>
        <label>From<input type="date" value={from} onChange={(event) => { setPage(1); setFrom(event.target.value); }} /></label>
        <label>To<input type="date" value={to} onChange={(event) => { setPage(1); setTo(event.target.value); }} /></label>
      </div>
      {types.length === 0 ? <div className="view-state">Select at least one note type.</div> : (
        <>
          <ViewState loading={resource.loading} error={resource.error} empty={!resource.loading && !resource.error && resource.data.length === 0} />
          {!resource.loading && !resource.error && <NoteCollection notes={resource.data} onChanged={onChanged} />}
          <Pagination meta={resource.meta} onPage={setPage} />
        </>
      )}
    </section>
  );
}
