import { useState } from "react";
import type { NoteRecord, NoteType } from "@cp-notes/shared";
import { deleteNote } from "../api";
import { EditDialog } from "./EditDialog";
import { NoteCard } from "./NoteCard";

export interface TypedNote {
  type: NoteType;
  record: NoteRecord;
}

export function NoteCollection({ notes, onChanged }: { notes: TypedNote[]; onChanged: () => void }) {
  const [editing, setEditing] = useState<TypedNote | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  async function remove(note: TypedNote): Promise<void> {
    if (!window.confirm("Delete this entry permanently? The linked problem will be kept.")) return;
    setActionError(null);
    try {
      await deleteNote(note.type, note.record.id);
      onChanged();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Could not delete this entry");
    }
  }

  return (
    <>
      {actionError && <div className="view-state error" role="alert">{actionError}</div>}
      <div className="note-list">
        {notes.map((note) => (
          <NoteCard
            key={`${note.type}-${note.record.id}`}
            {...note}
            onEdit={() => setEditing(note)}
            onDelete={() => void remove(note)}
          />
        ))}
      </div>
      {editing && (
        <EditDialog
          {...editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); onChanged(); }}
        />
      )}
    </>
  );
}
