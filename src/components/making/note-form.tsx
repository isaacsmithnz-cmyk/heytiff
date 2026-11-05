"use client";

import { useContext, useState } from "react";
import { Dialog } from "@/components/parts/dialog";
import { Button } from "@/components/parts/button";
import { CvBox } from "@/components/conversations/box";
import { appendSpoken, useDictation } from "@/components/notes/dictation";
import { useNoteScope } from "@/components/notes/note-context";
import { WindowsContext } from "@/components/records/records-context";
import { addMyNote, editMyNote } from "@/app/actions/my-notes";

/* NEW › NOTE (Isaac, 24 October 2026): a note is yours. "Maybe notes should
   just be personal notes by default … no need to send it to other people,
   because realistically that note would be added to a job card": a note
   about a job, and anyone it mentions, belongs on the job card. This one
   is your own notepad: the words, and Save, and it is kept in My notes,
   where only you see it.

   The same form edits one, from Notes' Edit: `note` is the one it opens on. */

/* THE ONE BOX (Isaac, 6 November 2026: "every input box is the same and
   gives the ability to use your voice"; "have a my notes section, then add
   new note. It will stay contained to you there"): Conversations' own box,
   its microphone, and one way out, Save. No Tiff here: a note just for you
   is kept as written. */
export function NoteForm({ onClose, note }: { onClose: () => void; note?: { id: string; body: string } }) {
  const host = useContext(WindowsContext);
  const { voiceEnabled } = useNoteScope();
  const [words, setWords] = useState(note?.body ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [spoken, setSpoken] = useState(false);
  const dict = useDictation({
    onTranscript: (said) => {
      setSpoken(true);
      setError(null);
      setWords((now) => appendSpoken(now, said));
    },
    onError: setError,
  });

  async function save() {
    if (!words.trim()) {
      setError("Write something first.");
      return;
    }
    setSaving(true);
    const r = await (note ? editMyNote(note.id, words) : addMyNote({ body: words, source: spoken ? "voice" : "text" })).catch(() => ({
      ok: false as const,
      error: "Couldn't keep that note.",
    }));
    setSaving(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    onClose();
    if (!note) host?.toast("Saved to My notes");
  }

  return (
    <Dialog
      heading={note ? "Edit note" : "New note"}
      width={560}
      onClose={onClose}
      foot={
        <Button kind="second" onClick={onClose}>
          Cancel
        </Button>
      }
    >
      {/* the dialog stands outside the page's frame (a portal), and the box's
          dress is the frame's: so the frame comes with it, boxless, as
          Tiff's chat does (tiff-host) */}
      <div className="fg mk-form" style={{ display: "contents" }}>
        <CvBox
          value={words}
          onChange={(v) => {
            setWords(v);
            if (error) setError(null);
          }}
          onSubmit={() => void save()}
          label="Note"
          placeholder="Write yourself a note"
          sendWord="Save"
          sendLabel={note ? "Save changes" : "Save to My notes"}
          tiff={false}
          onSave={() => void save()}
          saving={saving}
          dict={voiceEnabled ? dict : null}
          voiceError={error}
        />
      </div>
    </Dialog>
  );
}
