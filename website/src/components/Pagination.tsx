import type { PageMeta } from "@cp-notes/shared";

export function Pagination({ meta, onPage }: { meta: PageMeta | null; onPage: (page: number) => void }) {
  if (!meta || meta.totalPages <= 1) return null;
  return (
    <nav className="pagination" aria-label="Pagination">
      <button type="button" className="button secondary" disabled={meta.page <= 1} onClick={() => onPage(meta.page - 1)}>
        Previous
      </button>
      <span>
        Page {meta.page} of {meta.totalPages}
      </span>
      <button
        type="button"
        className="button secondary"
        disabled={meta.page >= meta.totalPages}
        onClick={() => onPage(meta.page + 1)}
      >
        Next
      </button>
    </nav>
  );
}
