import { useEffect, useState, type FormEvent } from "react";
import {
  ROOT_CAUSES,
  rootCauseLabel,
  type NoteRecord,
  type NoteType,
  type Problem,
} from "@cp-notes/shared";
import { ApiError, getProblems, patchNote } from "../api";
import { noteProblem, noteTags } from "../format";
import { useDebouncedValue } from "../hooks";

interface EditDialogProps {
  type: NoteType;
  record: NoteRecord;
  onClose: () => void;
  onSaved: () => void;
}

function formText(form: FormData, name: string): string {
  return String(form.get(name) ?? "");
}

function formTags(form: FormData): string[] {
  return formText(form, "tags").split(",").map((tag) => tag.trim()).filter(Boolean);
}

export function EditDialog({ type, record, onClose, onSaved }: EditDialogProps) {
  const [selectedProblem, setSelectedProblem] = useState<Problem | null>(() => noteProblem(type, record));
  const [problemQuery, setProblemQuery] = useState("");
  const debouncedProblemQuery = useDebouncedValue(problemQuery);
  const [problemResults, setProblemResults] = useState<Problem[]>([]);
  const [problemError, setProblemError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  useEffect(() => {
    if (!debouncedProblemQuery.trim() || type === "snippet") {
      setProblemResults([]);
      setProblemError(null);
      return;
    }
    const controller = new AbortController();
    void getProblems(debouncedProblemQuery, controller.signal)
      .then((result) => { if (!controller.signal.aborted) setProblemResults(result); })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        if (error instanceof DOMException && error.name === "AbortError") return;
        setProblemError(error instanceof Error ? error.message : "Problem search failed");
      });
    return () => controller.abort();
  }, [debouncedProblemQuery, type]);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (saving) return;
    const form = new FormData(event.currentTarget);
    const problemId = selectedProblem?.id ?? null;
    let body: unknown;

    if (type === "pattern") {
      body = {
        trigger: formText(form, "trigger"),
        coreIdea: formText(form, "coreIdea"),
        complexity: formText(form, "complexity"),
        tags: formTags(form),
        problemId,
      };
    } else if (type === "mistake") {
      body = {
        rootCause: formText(form, "rootCause"),
        notes: formText(form, "notes"),
        contestId: formText(form, "contestId") || null,
        problemId,
      };
    } else if (type === "snippet") {
      body = {
        name: formText(form, "name"),
        language: formText(form, "language"),
        code: formText(form, "code"),
        tags: formTags(form),
      };
    } else {
      body = {
        oneLiner: formText(form, "oneLiner"),
        contestId: formText(form, "contestId") || null,
        problemId,
      };
    }

    setSaving(true);
    setSaveError(null);
    try {
      await patchNote(type, record.id, body);
      onSaved();
    } catch (error) {
      setSaveError(error instanceof ApiError || error instanceof Error ? error.message : "Could not save changes");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="dialog" role="dialog" aria-modal="true" aria-labelledby="edit-heading">
        <div className="dialog-heading">
          <div>
            <span className="eyebrow">Correct entry</span>
            <h2 id="edit-heading">Edit {type}</h2>
          </div>
          <button type="button" className="icon-button" aria-label="Close editor" onClick={onClose}>×</button>
        </div>

        <form onSubmit={(event) => void submit(event)}>
          {type === "pattern" && "trigger" in record && (
            <>
              <label>Trigger<input name="trigger" defaultValue={record.trigger} required /></label>
              <label>Core idea<textarea name="coreIdea" defaultValue={record.coreIdea} rows={4} required /></label>
              <label>Complexity<input name="complexity" defaultValue={record.complexity} required /></label>
              <label>Tags <span className="hint">comma-separated</span><input name="tags" defaultValue={noteTags(record).join(", ")} /></label>
            </>
          )}
          {type === "mistake" && "rootCause" in record && (
            <>
              <label>Root cause<select name="rootCause" defaultValue={record.rootCause}>{ROOT_CAUSES.map((cause) => <option key={cause} value={cause}>{rootCauseLabel(cause)}</option>)}</select></label>
              <label>What actually went wrong?<textarea name="notes" defaultValue={record.notes} rows={5} required /></label>
              <label>Contest ID<input name="contestId" defaultValue={record.contestId ?? ""} /></label>
            </>
          )}
          {type === "snippet" && "code" in record && (
            <>
              <label>Name<input name="name" defaultValue={record.name} required /></label>
              <label>Language<input name="language" defaultValue={record.language} required /></label>
              <label>Code<textarea className="code-input" name="code" defaultValue={record.code} rows={12} required /></label>
              <label>Tags <span className="hint">comma-separated</span><input name="tags" defaultValue={record.tags.join(", ")} /></label>
            </>
          )}
          {type === "editorial" && "oneLiner" in record && (
            <>
              <label>Takeaway<textarea name="oneLiner" defaultValue={record.oneLiner} rows={4} required /></label>
              <label>Contest ID<input name="contestId" defaultValue={record.contestId ?? ""} /></label>
            </>
          )}

          {type !== "snippet" && (
            <fieldset className="problem-editor">
              <legend>Linked problem</legend>
              {selectedProblem ? (
                <div className="selected-problem">
                  <div><strong>{selectedProblem.name}</strong><span>{selectedProblem.platform}</span></div>
                  <button type="button" className="text-button danger" onClick={() => setSelectedProblem(null)}>Unlink</button>
                </div>
              ) : <p className="hint">This note is not linked to a problem.</p>}
              <label>Find an existing problem<input value={problemQuery} onChange={(event) => setProblemQuery(event.target.value)} placeholder="Search by name, URL, or tag" /></label>
              {problemError && <p className="inline-error" role="alert">{problemError}</p>}
              {problemResults.length > 0 && (
                <div className="problem-results">
                  {problemResults.map((problem) => (
                    <button key={problem.id} type="button" onClick={() => { setSelectedProblem(problem); setProblemQuery(""); setProblemResults([]); }}>
                      <strong>{problem.name}</strong><span>{problem.platform} · {problem.url}</span>
                    </button>
                  ))}
                </div>
              )}
            </fieldset>
          )}

          {saveError && <p className="inline-error" role="alert">{saveError}</p>}
          <div className="dialog-actions">
            <button type="button" className="button secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="button" disabled={saving}>{saving ? "Saving…" : "Save changes"}</button>
          </div>
        </form>
      </section>
    </div>
  );
}
