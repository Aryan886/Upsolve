import { useState } from "react";
import { rootCauseLabel, type NoteRecord, type NoteType } from "@cp-notes/shared";
import { formatDate, noteProblem, noteTags } from "../format";

interface NoteCardProps {
  type: NoteType;
  record: NoteRecord;
  onEdit: () => void;
  onDelete: () => void;
}

export function NoteCard({ type, record, onEdit, onDelete }: NoteCardProps) {
  const [copyStatus, setCopyStatus] = useState<string | null>(null);
  const problem = noteProblem(type, record);
  const tags = noteTags(record);

  async function copySnippet(): Promise<void> {
    if (!("code" in record)) return;
    try {
      await navigator.clipboard.writeText(record.code);
      setCopyStatus("Copied");
    } catch {
      setCopyStatus("Copy failed");
    }
  }

  return (
    <article className={`note-card note-${type}`}>
      <div className="card-topline">
        <span className={`flag flag-${type}`}>{type}</span>
        <time dateTime={record.createdAt}>{formatDate(record.createdAt)}</time>
      </div>

      {type === "pattern" && "trigger" in record && (
        <>
          <h3>{record.trigger}</h3>
          <p>{record.coreIdea}</p>
          <p className="detail"><strong>Complexity:</strong> {record.complexity}</p>
        </>
      )}
      {type === "mistake" && "rootCause" in record && (
        <>
          <h3>{rootCauseLabel(record.rootCause)}</h3>
          <p>{record.notes}</p>
          {record.contestId && <p className="detail">Contest {record.contestId}</p>}
        </>
      )}
      {type === "snippet" && "code" in record && (
        <>
          <div className="snippet-heading">
            <h3>{record.name}</h3>
            <span className="language-chip">{record.language}</span>
          </div>
          <pre><code>{record.code}</code></pre>
          <div className="copy-row">
            <button type="button" className="button secondary small" onClick={() => void copySnippet()}>Copy code</button>
            <span className="action-status" aria-live="polite">{copyStatus}</span>
          </div>
        </>
      )}
      {type === "editorial" && "oneLiner" in record && (
        <>
          <h3>{record.oneLiner}</h3>
          {record.contestId && <p className="detail">Contest {record.contestId}</p>}
        </>
      )}

      {problem && (
        <a className="problem-link" href={problem.url} target="_blank" rel="noreferrer">
          {problem.name} · {problem.platform}
        </a>
      )}
      {tags.length > 0 && <div className="tags">{tags.map((tag) => <span key={tag}>{tag}</span>)}</div>}

      <div className="card-actions">
        <button type="button" className="text-button" onClick={onEdit}>Edit</button>
        <button type="button" className="text-button danger" onClick={onDelete}>Delete</button>
      </div>
    </article>
  );
}
