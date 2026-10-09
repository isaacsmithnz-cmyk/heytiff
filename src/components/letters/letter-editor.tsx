"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import TextAlign from "@tiptap/extension-text-align";
import { TableKit } from "@tiptap/extension-table";
import { Icon } from "@/components/shell/icon";
import { ScreenBand, ScreenPanel } from "@/components/shell/screen-band";
import { DateField } from "@/components/ui/date-field";
import { LetterPaper } from "./letter-paper";
import { lettersHref, letterHref } from "./letters-list";
import { deleteLetter, saveLetter, type LetterSaveResult } from "@/app/actions/letters";
import { normaliseBody } from "@/lib/letters/body";
import { MAX_RECIPIENT, MAX_SUBJECT, MAX_TITLE, letterDate, recipientLines, titleOf, type LetterInput } from "@/lib/letters/letter";
import type { LetterheadFacts } from "@/lib/letters/letterhead";
import type { SignerChoice } from "@/lib/letters/query";
import type { Letterhead } from "@/lib/templates/settings";
import "@/components/admin/templates.css";
import "./letter-editor.css";

/* A LETTER, WRITTEN ON THE PAPER IT PRINTS ON — the business's letterhead
   (Admin → Templates) drawn around the body, and the body typed straight
   onto it, the way a Word document is: bold, italic, underline, headings,
   lists, a simple table, each paragraph aligned as wanted. The side holds
   what isn't the body: the date, who it is to, the "Re:" line and who signs.

   The body is Tiptap's document, read back through lib/letters/body on every
   save and every print, so what was typed is never markup on the page.
   Download PDF saves first, then prints the saved letter. */

const FAILED: LetterSaveResult = { ok: false, error: "Couldn't save the letter. Try again." };

/* THE PRINTED PDF, fetched and handed to the browser as a download. Out
   here, as a plain function, because React Compiler 1.0 can't lower a
   branch inside a component's try. */
async function downloadPdf(id: string, fallbackName: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/letters/${id}/pdf`);
    if (!res.ok) return false;
    const blob = await res.blob();
    const named = /filename\*=UTF-8''([^;]+)/.exec(res.headers.get("content-disposition") ?? "");
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = named ? decodeURIComponent(named[1]) : fallbackName;
    a.click();
    URL.revokeObjectURL(url);
    return true;
  } catch {
    return false;
  }
}

/* what a letter is made of, and nothing more: lib/letters/body keeps the same */
const EXTENSIONS = [
  StarterKit.configure({
    heading: { levels: [2, 3] },
    blockquote: false,
    code: false,
    codeBlock: false,
    horizontalRule: false,
    strike: false,
    link: false,
  }),
  TextAlign.configure({ types: ["heading", "paragraph"], alignments: ["left", "center", "right", "justify"] }),
  TableKit.configure({ table: { resizable: false } }),
];

type Tool = { label: string; on?: (e: Editor) => boolean; run: (e: Editor) => void; show?: (e: Editor) => boolean };

const TOOLS: Tool[][] = [
  [
    { label: "Bold", on: (e) => e.isActive("bold"), run: (e) => e.chain().focus().toggleBold().run() },
    { label: "Italic", on: (e) => e.isActive("italic"), run: (e) => e.chain().focus().toggleItalic().run() },
    { label: "Underline", on: (e) => e.isActive("underline"), run: (e) => e.chain().focus().toggleUnderline().run() },
  ],
  [
    { label: "Heading", on: (e) => e.isActive("heading", { level: 2 }), run: (e) => e.chain().focus().toggleHeading({ level: 2 }).run() },
    { label: "Subheading", on: (e) => e.isActive("heading", { level: 3 }), run: (e) => e.chain().focus().toggleHeading({ level: 3 }).run() },
  ],
  [
    { label: "Bullets", on: (e) => e.isActive("bulletList"), run: (e) => e.chain().focus().toggleBulletList().run() },
    { label: "Numbers", on: (e) => e.isActive("orderedList"), run: (e) => e.chain().focus().toggleOrderedList().run() },
  ],
  [
    { label: "Left", on: (e) => e.isActive({ textAlign: "left" }), run: (e) => e.chain().focus().setTextAlign("left").run() },
    { label: "Centre", on: (e) => e.isActive({ textAlign: "center" }), run: (e) => e.chain().focus().setTextAlign("center").run() },
    { label: "Right", on: (e) => e.isActive({ textAlign: "right" }), run: (e) => e.chain().focus().setTextAlign("right").run() },
    { label: "Justify", on: (e) => e.isActive({ textAlign: "justify" }), run: (e) => e.chain().focus().setTextAlign("justify").run() },
  ],
  [
    {
      label: "Table",
      show: (e) => !e.isActive("table"),
      run: (e) => e.chain().focus().insertTable({ rows: 3, cols: 2, withHeaderRow: false }).run(),
    },
    { label: "Add row", show: (e) => e.isActive("table"), run: (e) => e.chain().focus().addRowAfter().run() },
    { label: "Add column", show: (e) => e.isActive("table"), run: (e) => e.chain().focus().addColumnAfter().run() },
    { label: "Delete row", show: (e) => e.isActive("table"), run: (e) => e.chain().focus().deleteRow().run() },
    { label: "Delete column", show: (e) => e.isActive("table"), run: (e) => e.chain().focus().deleteColumn().run() },
    { label: "Remove table", show: (e) => e.isActive("table"), run: (e) => e.chain().focus().deleteTable().run() },
  ],
  [
    { label: "Undo", run: (e) => e.chain().focus().undo().run() },
    { label: "Redo", run: (e) => e.chain().focus().redo().run() },
  ],
];

/** The toolbar, redrawn as the cursor moves so each button says whether
    it is on where the cursor is. */
function Toolbar({ editor }: { editor: Editor }) {
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => TOOLS.map((g) => g.map((t) => ({ on: t.on ? t.on(e) : false, show: t.show ? t.show(e) : true }))),
  });
  return (
    <div className="lte-bar" role="toolbar" aria-label="Formatting">
      {TOOLS.map((group, g) => (
        <div key={g} className="lte-grp">
          {group.map((t, i) =>
            state[g][i].show ? (
              <button
                key={t.label}
                type="button"
                className="lte-btn"
                aria-pressed={t.on ? state[g][i].on : undefined}
                onMouseDown={(ev) => ev.preventDefault()}
                onClick={() => t.run(editor)}
              >
                {t.label}
              </button>
            ) : null
          )}
        </div>
      ))}
    </div>
  );
}

export function LetterEditor({
  initial,
  facts,
  letterhead,
  signers,
  me,
  today,
}: {
  initial: LetterInput;
  facts: LetterheadFacts;
  letterhead: Letterhead;
  signers: SignerChoice[];
  /** The person writing, and their own signature for the paper. */
  me: { staffId: string; signatureSvg: string | null } | null;
  /** yyyy-mm-dd */
  today: string;
}) {
  const router = useRouter();
  const [l, setL] = useState<LetterInput>(initial);
  const [saved, setSaved] = useState<string>(() => JSON.stringify(initial));
  const [busy, setBusy] = useState<"save" | "pdf" | "delete" | null>(null);
  const [note, setNote] = useState<{ text: string; bad: boolean } | null>(null);
  const [askDelete, setAskDelete] = useState(false);

  const editor = useEditor({
    extensions: EXTENSIONS,
    content: initial.body,
    immediatelyRender: false,
    editorProps: { attributes: { class: "lte-doc", "aria-label": "The letter" } },
    onUpdate: ({ editor: e }) => setL((cur) => ({ ...cur, body: normaliseBody(e.getJSON()) })),
  });

  const set = (patch: Partial<LetterInput>) => {
    setL((cur) => ({ ...cur, ...patch }));
    setNote(null);
  };
  const dirty = JSON.stringify(l) !== saved;

  /* a letter left with changes unsaved asks first */
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const signer = signers.find((s) => s.staffId === l.signerStaffId) ?? null;
  const signerIsMe = !!me && !!signer && signer.staffId === me.staffId;
  /* someone else's signature stays on only until somebody else saves */
  const othersSignature = !!signer && !signerIsMe && initial.withSignature && initial.signerStaffId === signer.staffId;

  const save = async (): Promise<string | null> => {
    setBusy("save");
    setNote(null);
    const res = await saveLetter({ ...l, withSignature: signerIsMe && l.withSignature }).catch(() => FAILED);
    setBusy(null);
    if (!res.ok) {
      setNote({ text: res.error, bad: true });
      return null;
    }
    const next = { ...l, id: res.id, withSignature: res.withSignature };
    setL(next);
    setSaved(JSON.stringify(next));
    setNote({ text: "Saved.", bad: false });
    if (!l.id) router.replace(letterHref(res.id));
    return res.id;
  };

  const download = async () => {
    const id = dirty || !l.id ? await save() : l.id;
    if (!id) return;
    setBusy("pdf");
    setNote({ text: "Printing the PDF…", bad: false });
    const ok = await downloadPdf(id, `${titleOf(l)}.pdf`);
    setBusy(null);
    setNote(ok ? { text: "PDF downloaded.", bad: false } : { text: "Couldn't print the PDF. Try again.", bad: true });
  };

  const remove = async () => {
    if (!l.id) return router.push(lettersHref);
    setBusy("delete");
    const res = await deleteLetter(l.id).catch(() => ({ ok: false as const, error: "Couldn't delete the letter. Try again." }));
    setBusy(null);
    setAskDelete(false);
    if (!res.ok) return setNote({ text: res.error, bad: true });
    setSaved(JSON.stringify(l));
    router.push(lettersHref);
  };

  const paperSigner = signer
    ? { name: signer.name, title: signer.title, signatureSvg: signerIsMe && l.withSignature ? me?.signatureSvg ?? null : null }
    : null;

  return (
    <div className="page in full lte">
      <div className="wrap">
        <div className="stg">
          <ScreenBand
            crumb={
              <Link href={lettersHref} className="int-back">
                <Icon name="chevL" size={15} />
                Letters
              </Link>
            }
            title={titleOf(l) === "Untitled letter" && !l.id ? "New letter" : titleOf(l)}
            tools={
              <>
                <button type="button" className="pbtn ghost" disabled={!!busy} onClick={() => void download()}>
                  {busy === "pdf" ? "Printing…" : "Download PDF"}
                </button>
                <button type="button" className="pbtn" disabled={!!busy || !dirty} onClick={() => void save()}>
                  {busy === "save" ? "Saving…" : "Save"}
                </button>
              </>
            }
          />
          <ScreenPanel>
            {note && <p className={note.bad ? "sw-state bad" : "tpl-quiet"}>{note.text}</p>}
            <div className="tpl-work">
              <div className="tpl-well lte-well">
                {editor && <Toolbar editor={editor} />}
                <LetterPaper
                  facts={facts}
                  letterhead={letterhead}
                  letter={{ date: letterDate(l.date), to: recipientLines(l.recipient), subject: l.subject, signer: paperSigner }}
                >
                  <EditorContent editor={editor} />
                </LetterPaper>
              </div>
              <aside className="tpl-side">
                <div className="tpl-card">
                  <h2>The letter</h2>
                  <label className="tpl-field">
                    Name in the list
                    <input
                      className="wb2-fi"
                      value={l.title}
                      maxLength={MAX_TITLE}
                      placeholder={l.subject || "For example, Sam Taylor's employment"}
                      onChange={(e) => set({ title: e.target.value })}
                    />
                  </label>
                  <div className="tpl-field">
                    Date
                    <DateField
                      className="wb2-fi"
                      aria-label="Date"
                      today={today}
                      value={l.date || null}
                      onChange={(iso) => set({ date: iso ?? "" })}
                    />
                  </div>
                  <label className="tpl-field">
                    To, a line each
                    <textarea
                      className="wb2-fi"
                      rows={4}
                      value={l.recipient}
                      maxLength={MAX_RECIPIENT}
                      placeholder={"Department of Home Affairs\nGPO Box 9984\nSydney NSW 2001"}
                      onChange={(e) => set({ recipient: e.target.value })}
                    />
                  </label>
                  <label className="tpl-field">
                    Re
                    <input
                      className="wb2-fi"
                      value={l.subject}
                      maxLength={MAX_SUBJECT}
                      placeholder="Employment confirmation"
                      onChange={(e) => set({ subject: e.target.value })}
                    />
                  </label>
                </div>
                <div className="tpl-card">
                  <h2>Signed by</h2>
                  <select
                    className="wb2-fi"
                    aria-label="Signed by"
                    value={l.signerStaffId ?? ""}
                    onChange={(e) => set({ signerStaffId: e.target.value || null, withSignature: !!me && e.target.value === me.staffId })}
                  >
                    <option value="">No one</option>
                    {signers.map((s) => (
                      <option key={s.staffId} value={s.staffId}>
                        {s.title ? `${s.name}, ${s.title}` : s.name}
                      </option>
                    ))}
                  </select>
                  {signerIsMe && (
                    me?.signatureSvg ? (
                      <label className="tpl-row tpl-tick">
                        <input type="checkbox" checked={l.withSignature} onChange={(e) => set({ withSignature: e.target.checked })} />
                        <span>Add my signature</span>
                      </label>
                    ) : (
                      <p className="tpl-quiet">
                        Draw your signature on <Link href="/dashboard/profile">your profile</Link> to sign letters with it.
                      </p>
                    )
                  )}
                  {signer && !signerIsMe && (
                    <p className="tpl-quiet">
                      {othersSignature
                        ? `${signer.name} signed this. Saving takes their signature off until they save it themselves.`
                        : `Only ${signer.name} can add their signature, by opening this letter and saving it.`}
                    </p>
                  )}
                </div>
                <div className="tpl-card">
                  {askDelete ? (
                    <>
                      <p>Delete this letter? It can&apos;t be brought back.</p>
                      <div className="tpl-acts">
                        <button type="button" className="pbtn ghost" disabled={!!busy} onClick={() => setAskDelete(false)}>
                          Keep
                        </button>
                        <button type="button" className="pbtn ghost dan" disabled={!!busy} onClick={() => void remove()}>
                          {busy === "delete" ? "Deleting…" : "Delete letter"}
                        </button>
                      </div>
                    </>
                  ) : (
                    <div className="tpl-acts">
                      <button type="button" className="pbtn ghost" disabled={!!busy} onClick={() => setAskDelete(true)}>
                        Delete
                      </button>
                    </div>
                  )}
                </div>
              </aside>
            </div>
          </ScreenPanel>
        </div>
      </div>
    </div>
  );
}
