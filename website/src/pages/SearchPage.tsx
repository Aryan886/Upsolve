import { useMemo, useState } from "react";
import type { Editorial, NoteRecord, NoteType, Pattern, Snippet } from "@cp-notes/shared";
import { getEditorial, getPatterns, getSnippets, type Paged } from "../api";
import { useDebouncedValue, usePagedResource } from "../hooks";
import { NoteCollection } from "../components/NoteCollection";
import { Pagination } from "../components/Pagination";
import { ViewState } from "../components/ViewState";

interface SearchPageProps {
  type: Extract<NoteType, "pattern" | "snippet" | "editorial">;
  revision: number;
  onChanged: () => void;
}

const copy = {
  pattern: { eyebrow: "Recognition reference", title: "Patterns", description: "Triggers and ideas for quick in-contest recall.", placeholder: "Search triggers, ideas, tags, or problems" },
  snippet: { eyebrow: "Reusable code", title: "Snippets", description: "Small templates worth copying into future contests.", placeholder: "Search names, code, or tags" },
  editorial: { eyebrow: "What finally clicked", title: "Editorial takeaways", description: "One-line insights from problems that genuinely blocked you.", placeholder: "Search takeaways, contests, or problems" },
} as const;

export function SearchPage({ type, revision, onChanged }: SearchPageProps) {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [language, setLanguage] = useState("");
  const debouncedSearch = useDebouncedValue(search);
  const debouncedLanguage = useDebouncedValue(language);
  const query = useMemo(() => {
    const params = new URLSearchParams({ page: String(page), limit: "20" });
    if (debouncedSearch) params.set("query", debouncedSearch);
    if (type === "snippet" && debouncedLanguage) params.set("language", debouncedLanguage);
    return params.toString();
  }, [page, debouncedSearch, debouncedLanguage, type]);

  const resource = usePagedResource<NoteRecord>((signal) => {
    if (type === "pattern") return getPatterns(query, signal) as Promise<Paged<Pattern>>;
    if (type === "snippet") return getSnippets(query, signal) as Promise<Paged<Snippet>>;
    return getEditorial(query, signal) as Promise<Paged<Editorial>>;
  }, [query, revision, type]);

  const text = copy[type];
  return (
    <section>
      <header className="page-heading"><span className="eyebrow">{text.eyebrow}</span><h2>{text.title}</h2><p>{text.description}</p></header>
      <div className="section-toolbar search-toolbar">
        <label>Search<input type="search" value={search} placeholder={text.placeholder} onChange={(event) => { setPage(1); setSearch(event.target.value); }} /></label>
        {type === "snippet" && <label>Language<input value={language} placeholder="e.g. cpp" onChange={(event) => { setPage(1); setLanguage(event.target.value); }} /></label>}
      </div>
      <ViewState loading={resource.loading} error={resource.error} empty={!resource.loading && !resource.error && resource.data.length === 0} />
      {!resource.loading && !resource.error && <NoteCollection notes={resource.data.map((record) => ({ type, record }))} onChanged={onChanged} />}
      <Pagination meta={resource.meta} onPage={setPage} />
    </section>
  );
}
