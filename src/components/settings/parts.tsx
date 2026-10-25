"use client";

import { useId, useState, type ReactNode } from "react";
import { Button } from "@/components/parts/button";
import { Dot } from "@/components/parts/state";
import { useToast } from "@/components/parts/toast";
import { useSectionSave } from "@/components/profile/use-section-save";
import type { SaveResult } from "@/components/profile/types";
import type { PreValidation } from "@/lib/staff/pre-validate";

/* A SETTINGS SECTION'S PIECES (v2, 25 October 2026; the mock
   BRjnFN2dsMPoruBt32rs6P). A section is its title and groups under thin
   lines (rule 35: a card is something you act on, everything else is a
   group). Three kinds of group, and nothing else:

   - typed details (a name, an ABN, an address) read as label and value, with
     one Edit on the group's head that turns the same group into its fields,
     Cancel and Save changes in the Edit's place;
   - a setting you pick (a chooser, a switch) saves itself the moment it's
     picked (rule 32), says so in a toast with Undo (rule 51), and says what
     went wrong under its own row (rule 42);
   - a list of records is rows (rule 39), with the group's Add on its head.

   No captions under a setting (the grey line that excused a control is gone,
   Isaac: "keep the design rules in mind"). */

/** The section's title, at 24 (rule 12), with what belongs on its right. */
export function SectionTitle({ children, tools }: { children: ReactNode; tools?: ReactNode }) {
  return (
    <div className="st2-titlerow">
      <h1 className="st2-h1">{children}</h1>
      {tools != null && <div className="st2-tools">{tools}</div>}
    </div>
  );
}

/** A group under a thin line: its heading, the buttons on its head, then it.
    `anchor` is its id, for a link that lands on it (`#licences`). */
export function Group({ heading, tools, anchor, children }: { heading: string; tools?: ReactNode; anchor?: string; children: ReactNode }) {
  const id = useId();
  return (
    <section className="st2-group" id={anchor} aria-labelledby={id}>
      <div className="st2-ghead">
        <h2 id={id}>{heading}</h2>
        {tools}
      </div>
      {children}
    </section>
  );
}

/** What went wrong (rule 42): a red dot and the words. */
export function Wrong({ children }: { children: ReactNode }) {
  return (
    <p className="st2-wrong" role="alert">
      <Dot hue="red" />
      <span>{children}</span>
    </p>
  );
}

/** Label and value, down the group. A blank says so in grey. */
export function Facts({ rows }: { rows: readonly { label: string; value: ReactNode }[] }) {
  return (
    <dl className="st2-kv">
      {rows.map((r) => {
        const blank = r.value === null || r.value === undefined || r.value === "";
        return (
          <div className="st2-kvrow" key={r.label}>
            <dt>{r.label}</dt>
            <dd className={blank ? "st2-none" : undefined}>{blank ? "Not set" : r.value}</dd>
          </div>
        );
      })}
    </dl>
  );
}

export type EditContext = {
  draft: Record<string, string>;
  set: (key: string, value: string) => void;
  setMany: (patch: Record<string, string>) => void;
  /** true when the last save refused this field */
  invalid: (key: string) => boolean;
};

/* TYPED DETAILS: one Edit, the draft is the mode. `draft === null` reads
   from props, so a save that revalidates changes the values and nothing
   else; a refused save keeps what was typed and marks the field (the same
   state model as the staff card's sections, through useSectionSave). */
export function EditGroup({
  heading,
  values,
  read,
  edit,
  onSave,
  validate,
}: {
  /** the group's name, its h2 (not `title`: a title is a tooltip) */
  heading: string;
  /** the read values, straight from props, and the draft's seed */
  values: Record<string, string>;
  read: ReactNode;
  edit: (ctx: EditContext) => ReactNode;
  onSave: (fields: Record<string, string>) => Promise<SaveResult>;
  validate?: (fields: Record<string, string>) => PreValidation | null;
}) {
  const [draft, setDraft] = useState<Record<string, string> | null>(null);
  const { saving, error, fieldErrors, submit, clear } = useSectionSave(onSave, validate);
  const editing = draft !== null;

  const start = () => {
    clear();
    setDraft({ ...values });
  };
  const cancel = () => {
    clear();
    setDraft(null);
  };
  const save = async () => {
    if (!draft) return;
    if (await submit(draft)) setDraft(null);
  };

  const tools = editing ? (
    <>
      <Button kind="second" size={32} onClick={cancel} disabled={saving}>
        Cancel
      </Button>
      <Button kind="main" size={32} onClick={save} disabled={saving}>
        {saving ? "Saving the changes" : "Save changes"}
      </Button>
    </>
  ) : (
    <Button kind="second" size={32} onClick={start} aria-label={`Edit ${heading.toLowerCase()}`}>
      Edit
    </Button>
  );

  return (
    <Group heading={heading} tools={tools}>
      {editing ? (
        <div className="st2-form">
          {edit({
            draft: draft ?? values,
            set: (key, value) => setDraft((d) => ({ ...(d ?? values), [key]: value })),
            setMany: (patch) => setDraft((d) => ({ ...(d ?? values), ...patch })),
            invalid: (key) => fieldErrors.includes(key),
          })}
        </div>
      ) : (
        read
      )}
      {editing && error && <Wrong>{error}</Wrong>}
    </Group>
  );
}

/** A setting on its own row: its name on the left, its control on the right. */
export function Setting({ name, line, children }: { name: ReactNode; line?: ReactNode; children?: ReactNode }) {
  return (
    <div className="st2-set">
      <div className="st2-setw">
        <span className="st2-sett">{name}</span>
        {line != null && <span className="st2-sets">{line}</span>}
      </div>
      {children}
    </div>
  );
}

/* A SETTING THAT SAVES ITSELF. Picking writes at once; the toast says what
   changed and its Undo writes the old value back. A refusal leaves the
   control on what's saved and says why under the row. */
export function useSelfSave(onSave: (fields: Record<string, string>) => Promise<SaveResult>) {
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);

  const write = async (field: string, value: string, was: string, said: string) => {
    setError(null);
    setPending(field);
    try {
      const res = await onSave({ [field]: value });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      toast({
        text: said,
        undo: () => {
          void onSave({ [field]: was });
        },
      });
    } catch {
      setError("Couldn't save that. Check your connection and try again.");
    } finally {
      setPending(null);
    }
  };

  return { write, error, pending };
}
