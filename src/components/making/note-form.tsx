"use client";

import { useContext, useState } from "react";
import { Dialog } from "@/components/parts/dialog";
import { Button } from "@/components/parts/button";
import { Field, TextArea } from "@/components/parts/field";
import { WindowsContext } from "@/components/records/records-context";
import { addMyNote } from "@/app/actions/my-notes";

/* NEW › NOTE (Isaac, 24 October 2026): a note is yours. "Maybe notes should
   just be personal notes by default … no need to send it to other people,
   because realistically that note would be added to a job card": a note
   about a job, and anyone it mentions, belongs on the job card. This one
   is your own notepad: the words, and Save, and it is kept in My notes,
   where only you see it. */

export function NoteForm({ onClose }: { onClose: () => void }) {
  const host = useContext(WindowsContext);
  const [words, setWords] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!words.trim()) {
      setError("Write something first.");
      return;
    }
    setSaving(true);
    const r = await addMyNote({ body: words, source: "text" }).catch(() => ({ ok: false as const, error: "Couldn't keep that note." }));
    setSaving(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    onClose();
    host?.toast("Saved to My notes");
  }

  return (
    <Dialog
      heading="New note"
      width={560}
      onClose={onClose}
      foot={
        <>
          <Button kind="second" onClick={onClose}>
            Cancel
          </Button>
          <Button kind="main" onClick={() => void save()} disabled={saving}>
            {saving ? "Saving" : "Save to My notes"}
          </Button>
        </>
      }
    >
      <form
        className="mk-form"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <Field label="Note" error={error}>
          <TextArea
            value={words}
            rows={5}
            invalid={!!error}
            data-autofocus
            onKeyDown={(e) => {
              /* ⌘ or Ctrl with Enter saves; Enter is a new line */
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void save();
              }
            }}
            onChange={(e) => {
              setWords(e.target.value);
              if (error) setError(null);
            }}
          />
        </Field>
      </form>
    </Dialog>
  );
}
