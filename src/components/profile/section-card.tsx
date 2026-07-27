"use client";

import { useState, type CSSProperties, type ReactNode } from "react";
import { Icon } from "@/components/shell/icon";
import type { PreValidation } from "@/lib/staff/pre-validate";
import { useSectionSave } from "./use-section-save";
import type { SaveResult } from "./types";

/* One card, one edit cycle — and the state model that fixes both production
   bugs the injected-HTML version had.

   THE DRAFT IS THE MODE. `draft === null` means read mode and the read view
   renders straight FROM PROPS; a draft object means edit mode and every input
   reads from it. Nothing syncs props into the draft — no effect, no key, no
   derived state. That single rule is what makes a mid-edit re-render harmless:

     BUG 1 (lost tab / re-locked cards). Saving revalidates, so the server
     re-renders the whole screen. The old markup always marked Personal active
     and every card locked, so every save bounced you back to Personal with
     everything re-locked. Now the active tab and each card's mode are React
     state above the data, so new props change VALUES and nothing else.

     BUG 2 (lost typing on a rejected save). The old handler captured the card
     node, awaited the action, then wrote the error onto that node — which the
     re-render had already detached, taking the typed values with it. Here a
     failed save touches only `error`/`fieldErrors`; `draft` is not read, not
     written, not reseeded. What you typed is still on screen, and the field
     that was rejected is marked.

   The `.card2 / .c2h / .cardactions / .carderr` classes are the existing ones,
   including `readonly` — the CSS already knows which buttons a locked card
   shows, so reusing the class means the button set is identical to before. */

export type CardEditContext = {
  draft: Record<string, string>;
  set: (key: string, value: string) => void;
  setMany: (patch: Record<string, string>) => void;
  /** true when the last save rejected this field */
  invalid: (key: string) => boolean;
  saving: boolean;
};

/** What the read view is handed. `edit` is the same call the header's Edit
    button makes, so an inline "+ Add" beside a blank value opens the very form
    that fills it — see detail.tsx. */
export type CardReadContext = { edit: () => void };

export function SectionCard({
  icon,
  iconStyle,
  title,
  sub,
  pill,
  values,
  read,
  edit,
  onSave,
  validate,
  transform,
  /** false = read-only facts, no edit cycle (Training, Assigned vehicle) */
  editable = true,
  /** extra class on the card, e.g. `data-live` styling hooks */
  className,
  /** Open in edit mode on mount. The screen sets this when you answer "Fill in
      missing details", and remounts the section so it takes — see the psec key
      in profile-screen. State, not an effect: the card is already fresh. */
  startEditing = false,
}: {
  icon: string;
  iconStyle?: CSSProperties;
  title: string;
  sub: string;
  pill?: ReactNode;
  /** the read-mode values, straight from props — also the draft's seed */
  values: Record<string, string>;
  read: ReactNode | ((ctx: CardReadContext) => ReactNode);
  edit: (ctx: CardEditContext) => ReactNode;
  /** already bound to its section by the caller */
  onSave?: (fields: Record<string, string>) => Promise<SaveResult>;
  validate?: (fields: Record<string, string>) => PreValidation | null;
  /** last chance to shape the draft into the payload — e.g. work rights
      blanking the visa columns when the status makes them meaningless. The
      draft itself is untouched, so the screen keeps what was typed. */
  transform?: (draft: Record<string, string>) => Record<string, string>;
  editable?: boolean;
  className?: string;
  startEditing?: boolean;
}) {
  const [draft, setDraft] = useState<Record<string, string> | null>(() =>
    startEditing && editable ? { ...values } : null
  );
  const { saving, error, fieldErrors, submit, clear } = useSectionSave(onSave, validate);

  const editing = draft !== null;

  const startEdit = () => {
    clear();
    setDraft({ ...values });
  };
  const cancel = () => {
    clear();
    setDraft(null);
  };
  const save = async () => {
    if (!draft) return;
    const ok = await submit(transform ? transform(draft) : draft);
    // props already carry the saved values (the action revalidated) — dropping
    // the draft is the whole of "go back to read mode"
    if (ok) setDraft(null);
  };

  const ctx: CardEditContext = {
    draft: draft ?? values,
    set: (key, value) => setDraft((d) => ({ ...(d ?? values), [key]: value })),
    setMany: (patch) => setDraft((d) => ({ ...(d ?? values), ...patch })),
    invalid: (key) => fieldErrors.includes(key),
    saving,
  };

  const cls = [
    "card2",
    editing ? "" : "readonly",
    saving ? "saving" : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={cls} {...(editable ? {} : { "data-static": "" })}>
      <div className="c2h">
        <span className="ci" style={iconStyle}>
          <Icon name={icon} size={18} />
        </span>
        <span>
          <b>{title}</b>
          <em>{sub}</em>
        </span>
        {pill}
        {editable && (
          <span className="cardactions">
            <button className="cardedit" type="button" data-edit onClick={startEdit}>
              <Icon name="edit" size={14} />
              Edit
            </button>
            <button className="cardbtn ghost" type="button" data-cancel onClick={cancel}>
              Cancel
            </button>
            <button
              className="cardbtn save"
              type="button"
              data-save
              disabled={saving}
              onClick={save}
            >
              <Icon name="check" size={14} />
              Save
            </button>
          </span>
        )}
      </div>

      {editing ? edit(ctx) : typeof read === "function" ? read({ edit: startEdit }) : read}

      {editing && error && <div className="carderr">{error}</div>}
    </div>
  );
}

/** A card with no edit cycle at all — read-only facts. */
export function StaticCard({
  icon,
  iconStyle,
  title,
  sub,
  pill,
  children,
}: {
  icon: string;
  iconStyle?: CSSProperties;
  title: string;
  sub: string;
  pill?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="card2" data-static>
      <div className="c2h">
        <span className="ci" style={iconStyle}>
          <Icon name={icon} size={18} />
        </span>
        <span>
          <b>{title}</b>
          <em>{sub}</em>
        </span>
        {pill}
      </div>
      {children}
    </div>
  );
}
