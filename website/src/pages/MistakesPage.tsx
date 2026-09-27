import { useEffect, useState } from "react";
import { ROOT_CAUSES, rootCauseLabel, type RootCause } from "@cp-notes/shared";
import { getMistakes, getMistakeStats } from "../api";
import { usePagedResource } from "../hooks";
import { NoteCollection } from "../components/NoteCollection";
import { Pagination } from "../components/Pagination";
import { ViewState } from "../components/ViewState";

export function MistakesPage({ revision, onChanged }: { revision: number; onChanged: () => void }) {
  const [page, setPage] = useState(1);
  const [rootCause, setRootCause] = useState<RootCause | "">("");
  const [stats, setStats] = useState<Record<RootCause, number> | null>(null);
  const [statsError, setStatsError] = useState<string | null>(null);
  const query = new URLSearchParams({ page: String(page), limit: "20", ...(rootCause ? { rootCause } : {}) }).toString();
  const resource = usePagedResource((signal) => getMistakes(query, signal), [query, revision]);

  useEffect(() => {
    const controller = new AbortController();
    setStatsError(null);
    void getMistakeStats(controller.signal).then(setStats).catch((error: unknown) => {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setStatsError(error instanceof Error ? error.message : "Could not load mistake statistics");
    });
    return () => controller.abort();
  }, [revision]);

  const maximum = Math.max(1, ...Object.values(stats ?? {}));

  return (
    <section>
      <header className="page-heading"><span className="eyebrow">Highest-value review</span><h2>Mistakes dashboard</h2><p>Look for repeated root causes, not isolated wrong answers.</p></header>
      <div className="chart-card" aria-label="Mistake counts by root cause">
        {statsError && <p className="inline-error" role="alert">{statsError}</p>}
        {ROOT_CAUSES.map((cause) => {
          const count = stats?.[cause] ?? 0;
          return <div className="bar-row" key={cause}><span>{rootCauseLabel(cause)}</span><div className="bar-track"><div className="bar-fill" style={{ width: `${(count / maximum) * 100}%` }} /></div><strong>{count}</strong></div>;
        })}
      </div>
      <div className="section-toolbar"><label>Root cause<select value={rootCause} onChange={(event) => { setPage(1); setRootCause(event.target.value as RootCause | ""); }}><option value="">All causes</option>{ROOT_CAUSES.map((cause) => <option key={cause} value={cause}>{rootCauseLabel(cause)}</option>)}</select></label></div>
      <ViewState loading={resource.loading} error={resource.error} empty={!resource.loading && !resource.error && resource.data.length === 0} />
      {!resource.loading && !resource.error && <NoteCollection notes={resource.data.map((record) => ({ type: "mistake", record }))} onChanged={onChanged} />}
      <Pagination meta={resource.meta} onPage={setPage} />
    </section>
  );
}
