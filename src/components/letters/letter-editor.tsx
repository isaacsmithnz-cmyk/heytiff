"use client";

import { useEffect, useId, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import TextAlign from "@tiptap/extension-text-align";
import { TableKit } from "@tiptap/extension-table";
import { Icon } from "@/components/shell/icon";
import { Button, LinkButton } from "@/components/parts/button";
import { Chooser } from "@/components/parts/chooser";
import { ConfirmDialog } from "@/components/parts/dialog";
import { Fade } from "@/components/parts/fade";
import { Field, TextArea, TextInput } from "@/components/parts/field";
import { Dot } from "@/components/parts/state";
import { Tray } from "@/components/parts/tabs";
import { Tick } from "@/components/parts/tick";
import { ToastProvider, useToast } from "@/components/parts/toast";
import { DateField } from "@/components/ui/date-field";
import { LetterPaper } from "./letter-paper";
import { deleteLetter, saveLetter, type LetterSaveResult } from "@/app/actions/letters";
import { normaliseBody } from "@/lib/letters/body";
import { MAX_RECIPIENT, MAX_SUBJECT, MAX_TITLE, letterDate, letterHref, lettersHref, recipientLines, titleOf, type LetterInput } from "@/lib/letters/letter";
import type { LetterheadFacts } from "@/lib/letters/letterhead";
import type { SignerChoice } from "@/lib/letters/query";
import type { Letterhead } from "@/lib/templates/settings";
import "./letter-editor.css";

/* A LETTER, WRITTEN ON THE PAPER IT PRINTS ON (v2, 27 October 2026; the
   mock old-letters, built as drawn). The business's letterhead (Admin →
   Templates) is drawn around the body, and the body is typed straight onto
   it, the way a Word document is: bold, italic, underline, headings, lists,
   a simple table, each paragraph aligned as wanted.

   The title and its two buttons, Download PDF and Save letter, with no crumb:
   Documents in the sidebar and the open tab say where you are. Save letter is
   blue and held until something changes; Download PDF saves first, then
   prints the saved letter. Saved says so in a toast (rule 37); a save that
   fails says so under the title, a red dot and what to do (rule 42).

   Beside the paper, two sections: The letter (its name, date, who it is to
   and the "Re:" line) and Signed by. Delete letter sits alone at the foot,
   and asks in a dialog (rule 25).

   The body is Tiptap's document, read back through lib/letters/body on every
   save and every print, so what was typed is never markup on the page. */

const FAILED: LetterSaveResult = { ok: false, error: "Couldn't save the letter. Try again." };

/* what each refusal means for you, under its red word */
const SAVE_FAILED = "Your changes are still here. Try again.";

type WrongLine = { word: string; means: string };

/** A save that came back refused: the generic failure in the mock's words,
    anything the server named (a signer gone, a letter gone) as it said it. */
const saveWrong = (error: string): WrongLine => ({
  word: "Couldn't save the letter",
  means: error === FAILED.error ? SAVE_FAILED : error,
});

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

/* HEADINGS ARE ONE CHOOSER (the mock's note 3): Body text, Heading and
   Subheading, the kind of the paragraph the cursor is in. */
type Kind = "body" | "heading" | "subheading";
const KINDS: { value: Kind; label: string }[] = [
  { value: "body", label: "Body text" },
  { value: "heading", label: "Heading" },
  { value: "subheading", label: "Subheading" },
];
const kindOf = (e: Editor): Kind =>
  e.isActive("heading", { level: 2 }) ? "heading" : e.isActive("heading", { level: 3 }) ? "subheading" : "body";
const setKind = (e: Editor, k: Kind) => {
  const c = e.chain().focus();
  (k === "body" ? c.setParagraph() : c.setHeading({ level: k === "heading" ? 2 : 3 })).run();
};

/* THE FOUR ALIGNMENTS, in a thin tray (rule 30) */
type Align = "left" | "center" | "right" | "justify";
const ALIGNS: { value: Align; label: string }[] = [
  { value: "left", label: "Left" },
  { value: "center", label: "Centre" },
  { value: "right", label: "Right" },
  { value: "justify", label: "Justify" },
];
const alignOf = (e: Editor): Align => ALIGNS.find((a) => e.isActive({ textAlign: a.value }))?.value ?? "left";

/* every other tool keeps its word, a quiet button (rule 24) */
type Tool = { label: string; on?: (e: Editor) => boolean; run: (e: Editor) => void; show?: (e: Editor) => boolean };

const MARKS: Tool[] = [
  { label: "Bold", on: (e) => e.isActive("bold"), run: (e) => e.chain().focus().toggleBold().run() },
  { label: "Italic", on: (e) => e.isActive("italic"), run: (e) => e.chain().focus().toggleItalic().run() },
  { label: "Underline", on: (e) => e.isActive("underline"), run: (e) => e.chain().focus().toggleUnderline().run() },
];
const LISTS: Tool[] = [
  { label: "Bullets", on: (e) => e.isActive("bulletList"), run: (e) => e.chain().focus().toggleBulletList().run() },
  { label: "Numbers", on: (e) => e.isActive("orderedList"), run: (e) => e.chain().focus().toggleOrderedList().run() },
];
/* inside a table, Add table swaps for the table's own tools (note 4); each
   is undone by Undo, so none is red */
const TABLE: Tool[] = [
  {
    label: "Add table",
    show: (e) => !e.isActive("table"),
    run: (e) => e.chain().focus().insertTable({ rows: 3, cols: 2, withHeaderRow: false }).run(),
  },
  { label: "Add row", show: (e) => e.isActive("table"), run: (e) => e.chain().focus().addRowAfter().run() },
  { label: "Add column", show: (e) => e.isActive("table"), run: (e) => e.chain().focus().addColumnAfter().run() },
  { label: "Delete row", show: (e) => e.isActive("table"), run: (e) => e.chain().focus().deleteRow().run() },
  { label: "Delete column", show: (e) => e.isActive("table"), run: (e) => e.chain().focus().deleteColumn().run() },
  { label: "Remove table", show: (e) => e.isActive("table"), run: (e) => e.chain().focus().deleteTable().run() },
];
const HISTORY: Tool[] = [
  { label: "Undo", run: (e) => e.chain().focus().undo().run() },
  { label: "Redo", run: (e) => e.chain().focus().redo().run() },
];
const GROUPS = [MARKS, LISTS, TABLE, HISTORY];

/** A group of worded tools; a press never takes the cursor off the paper. */
function Tools({ editor, tools, state }: { editor: Editor; tools: Tool[]; state: { on: boolean; show: boolean }[] }) {
  return (
    <div className="lte-grp">
      {tools.map((t, i) =>
        state[i].show ? (
          <Button
            key={t.label}
            kind="quiet"
            size={32}
            className="lte-tool"
            aria-pressed={t.on ? state[i].on : undefined}
            onMouseDown={(ev) => ev.preventDefault()}
            onClick={() => t.run(editor)}
          >
            {t.label}
          </Button>
        ) : null
      )}
    </div>
  );
}

/** The toolbar, redrawn as the cursor moves so each tool says what is on
    where the cursor is. */
function Toolbar({ editor }: { editor: Editor }) {
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      kind: kindOf(e),
      align: alignOf(e),
      groups: GROUPS.map((g) => g.map((t) => ({ on: t.on ? t.on(e) : false, show: t.show ? t.show(e) : true }))),
    }),
  });
  return (
    <div className="lte-bar" role="toolbar" aria-label="Formatting">
      <div className="lte-grp">
        <Chooser
          aria-label="Text style"
          size={32}
          className="lte-kind"
          options={KINDS}
          value={state.kind}
          onChange={(v) => setKind(editor, v as Kind)}
        />
      </div>
      <Tools editor={editor} tools={MARKS} state={state.groups[0]} />
      <Tools editor={editor} tools={LISTS} state={state.groups[1]} />
      <div className="lte-grp">
        <Tray
          ariaLabel="Alignment"
          options={ALIGNS}
          value={state.align}
          onChange={(a) => editor.chain().focus().setTextAlign(a).run()}
        />
      </div>
      <Tools editor={editor} tools={TABLE} state={state.groups[2]} />
      <Tools editor={editor} tools={HISTORY} state={state.groups[3]} />
    </div>
  );
}

/** A section of the rail: Home's coloured block and its title (`.hm-blk`). */
function Section({ heading, icon, hue, children }: { heading: string; icon: string; hue: "pink" | "purple"; children: ReactNode }) {
  const id = useId();
  return (
    <section className="lte-sec" aria-labelledby={id}>
      <div className="lte-sechead">
        <span className={`hm-blk hm-blk--${hue}`} aria-hidden="true">
          <Icon name={icon} size={18} />
        </span>
        <h2 className="lte-sectitle" id={id}>
          {heading}
        </h2>
      </div>
      {children}
    </section>
  );
}

type Props = {
  initial: LetterInput;
  facts: LetterheadFacts;
  letterhead: Letterhead;
  signers: SignerChoice[];
  /** The person writing, and their own signature for the paper. */
  me: { staffId: string; signatureSvg: string | null } | null;
  /** yyyy-mm-dd */
  today: string;
};

/* "No one" in the chooser: a value no staff id can be */
const NO_ONE = "none";

function Letter({ initial, facts, letterhead, signers, me, today }: Props) {
  const router = useRouter();
  const toast = useToast();
  const dateId = useId();
  const [l, setL] = useState<LetterInput>(initial);
  const [saved, setSaved] = useState<string>(() => JSON.stringify(initial));
  const [busy, setBusy] = useState<"save" | "pdf" | "delete" | null>(null);
  const [wrong, setWrong] = useState<WrongLine | null>(null);
  const [askDelete, setAskDelete] = useState(false);

  const editor = useEditor({
    extensions: EXTENSIONS,
    content: initial.body,
    immediatelyRender: false,
    editorProps: { attributes: { class: "lte-doc", "aria-label": "The letter" } },
    onUpdate: ({ editor: e }) => setL((cur) => ({ ...cur, body: normaliseBody(e.getJSON()) })),
  });

  const set = (patch: Partial<LetterInput>) => setL((cur) => ({ ...cur, ...patch }));
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

  /** Saves the letter; `quiet` when Download PDF saves on its way to print,
      so the one toast says the PDF. */
  const save = async (quiet = false): Promise<string | null> => {
    setBusy("save");
    setWrong(null);
    const res = await saveLetter({ ...l, withSignature: signerIsMe && l.withSignature }).catch(() => FAILED);
    setBusy(null);
    if (!res.ok) {
      setWrong(saveWrong(res.error));
      return null;
    }
    const next = { ...l, id: res.id, withSignature: res.withSignature };
    setL(next);
    setSaved(JSON.stringify(next));
    if (!quiet) toast({ text: "Letter saved" });
    if (!l.id) router.replace(letterHref(res.id));
    return res.id;
  };

  const download = async () => {
    const id = dirty || !l.id ? await save(true) : l.id;
    if (!id) return;
    setBusy("pdf");
    setWrong(null);
    const ok = await downloadPdf(id, `${titleOf(l)}.pdf`);
    setBusy(null);
    if (ok) toast({ text: "PDF downloaded" });
    else setWrong({ word: "Couldn't print the PDF", means: "The letter is saved. Try again." });
  };

  const remove = async () => {
    if (!l.id) return router.push(lettersHref);
    setBusy("delete");
    const res = await deleteLetter(l.id).catch(() => ({ ok: false as const, error: "Couldn't delete the letter. Try again." }));
    setBusy(null);
    setAskDelete(false);
    if (!res.ok) return setWrong({ word: "Couldn't delete the letter", means: res.error });
    setSaved(JSON.stringify(l));
    router.push(lettersHref);
  };

  const paperSigner = signer
    ? { name: signer.name, title: signer.title, signatureSvg: signerIsMe && l.withSignature ? me?.signatureSvg ?? null : null }
    : null;

  const signerOptions = [
    { value: NO_ONE, label: "No one" },
    ...signers.map((s) => ({ value: s.staffId, label: s.title ? `${s.name}, ${s.title}` : s.name })),
  ];

  return (
    <div className="wrap lte">
      <header className="lte-head">
        <h1 className="lte-h1">
          <Fade>{titleOf(l) === "Untitled letter" && !l.id ? "New letter" : titleOf(l)}</Fade>
        </h1>
        <div className="lte-tools">
          <Button kind="second" disabled={!!busy} onClick={() => void download()}>
            {busy === "pdf" ? "Printing the PDF" : "Download PDF"}
          </Button>
          <Button kind="main" disabled={!!busy || !dirty} onClick={() => void save()}>
            {busy === "save" ? "Saving the letter" : "Save letter"}
          </Button>
        </div>
      </header>

      {wrong && (
        <div className="lte-wrong" role="alert">
          <p className="lte-wrong-word">
            <Dot hue="red" />
            {wrong.word}
          </p>
          <p className="lte-wrong-means">{wrong.means}</p>
        </div>
      )}

      <div className="lte-work">
        <div className="lte-well">
          {editor && <Toolbar editor={editor} />}
          <LetterPaper
            facts={facts}
            letterhead={letterhead}
            letter={{ date: letterDate(l.date), to: recipientLines(l.recipient), subject: l.subject, signer: paperSigner }}
          >
            <EditorContent editor={editor} />
          </LetterPaper>
        </div>

        <aside className="lte-rail">
          <Section heading="The letter" icon="file" hue="pink">
            <Field label="Name in the list">
              <TextInput
                value={l.title}
                maxLength={MAX_TITLE}
                placeholder={l.subject || "For example, Sam Taylor's employment"}
                onChange={(e) => set({ title: e.target.value })}
              />
            </Field>
            <Field label="Date" id={dateId}>
              <DateField
                id={dateId}
                className="lte-date"
                today={today}
                value={l.date || null}
                onChange={(iso) => set({ date: iso ?? "" })}
              />
            </Field>
            <Field label="To">
              <TextArea
                rows={4}
                value={l.recipient}
                maxLength={MAX_RECIPIENT}
                placeholder={"Department of Home Affairs\nGPO Box 9984\nSydney NSW 2001"}
                onChange={(e) => set({ recipient: e.target.value })}
              />
            </Field>
            <Field label="Re">
              <TextInput
                value={l.subject}
                maxLength={MAX_SUBJECT}
                placeholder="Employment confirmation"
                onChange={(e) => set({ subject: e.target.value })}
              />
            </Field>
          </Section>

          <Section heading="Signed by" icon="edit" hue="purple">
            <Chooser
              aria-label="Signed by"
              options={signerOptions}
              value={l.signerStaffId ?? NO_ONE}
              onChange={(v) => {
                const id = v === NO_ONE ? null : v;
                set({ signerStaffId: id, withSignature: !!me && id === me.staffId });
              }}
            />
            {signerIsMe &&
              (me?.signatureSvg ? (
                <Tick label="Add my signature" checked={l.withSignature} onChange={(on) => set({ withSignature: on })} />
              ) : (
                <p className="lte-line">
                  Draw your signature on <LinkButton href="/dashboard/profile">your profile</LinkButton> to sign letters with it.
                </p>
              ))}
            {signer && !signerIsMe && (
              <p className="lte-line">
                {othersSignature
                  ? `${signer.name} signed this. Saving takes their signature off until they save it themselves.`
                  : `Only ${signer.name} can add their signature, by opening this letter and saving it.`}
              </p>
            )}
          </Section>

          <div className="lte-foot">
            <Button kind="delete" disabled={!!busy} onClick={() => setAskDelete(true)}>
              Delete letter
            </Button>
          </div>
        </aside>
      </div>

      <ConfirmDialog
        open={askDelete}
        heading="Delete this letter?"
        confirm={busy === "delete" ? "Deleting the letter" : "Delete letter"}
        cancel="Keep letter"
        busy={busy === "delete"}
        onConfirm={() => void remove()}
        onClose={() => setAskDelete(false)}
      >
        It can&apos;t be brought back.
      </ConfirmDialog>
    </div>
  );
}

export function LetterEditor(props: Props) {
  return (
    <ToastProvider>
      <Letter {...props} />
    </ToastProvider>
  );
}
