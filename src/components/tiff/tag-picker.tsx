"use client";

import { useId, useRef, useState, useTransition, type KeyboardEvent, type Ref } from "react";
import { Chevron, Field, useFieldWiring } from "@/components/parts/field";
import { Menu, type MenuItem } from "@/components/parts/menu";
import { Dot } from "@/components/parts/state";
import { createKbTag } from "@/app/actions/kb-tags";
import {
  KB_TAG_COLORS,
  KB_TAG_KIND_LABELS,
  KB_TAG_KINDS,
  KB_TAGS_PER_DOC_MAX,
  kbTagHue,
  kbTagLabel,
  kbTagSlug,
  type KbTagKind,
  type KbTagRef,
} from "@/lib/tiff/tags";

/* A DOCUMENT'S TAGS, picked from a menu (the old-modals mock, 27 October
   2026). The toggle chips were pills (rule 47), so the field is a chooser
   (rule 34) that opens the app's own menu: its find box, the tags ticked
   and grouped by kind, each with its colour's dot, and "Create “Mul” in
   Topics" as its last rows. The field says the tags chosen, joined.

   It lives in two dialogs, Edit document and Add documents, both the
   Dialog part; the menu portals over them by itself.

   CREATING IS THE LAST RESORT, AND IT IS ONE PRESS. Type something no tag
   answers to and a Create row appears for each kind. Re-typing a name that
   exists finds it instead: the server dedupes on the slug and hands the
   existing tag back, so the same press never makes a second Daikin.

   TWELVE IS THE CEILING. A tag that is on stays pressable at the limit, or
   the twelfth could never come back off; only the ones you could add stop. */

const CREATE = "create:";

export function TagField({
  tags,
  value,
  onChange,
  onCreated,
  canCreate = true,
  label = "Tags",
}: {
  tags: KbTagRef[];
  value: string[];
  onChange: (tagIds: string[]) => void;
  /** A tag the server just made: the caller owns the list, so it adds it. */
  onCreated?: (tag: KbTagRef) => void;
  canCreate?: boolean;
  label?: string;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const listId = `${useId()}-list`;
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();

  const full = value.length >= KB_TAGS_PER_DOC_MAX;
  /* in the menu's order, so the field reads the same however they were picked */
  const ordered = KB_TAG_KINDS.flatMap((kind) => tags.filter((t) => t.kind === kind));
  const chosen = ordered.filter((t) => value.includes(t.id));

  const items: MenuItem[] = ordered.map((t) => {
    const on = value.includes(t.id);
    return {
      key: t.id,
      label: t.label,
      group: KB_TAG_KIND_LABELS[t.kind],
      disabled: !on && full,
      lead: (
        <span className="tgf-lead">
          <span className={`tgf-tk${on ? " on" : ""}`} aria-hidden="true">
            {on && (
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <path d="m4 8.5 2.5 2.5L12 5.5" />
              </svg>
            )}
          </span>
          <Dot hue={kbTagHue(t.color)} />
        </span>
      ),
    };
  });

  /* Only when nothing already answers to that name. The comparison is on the
     SLUG, which is what the server dedupes on. */
  const creates = (query: string): MenuItem[] => {
    const name = kbTagLabel(query);
    const slug = kbTagSlug(name);
    if (!canCreate || !slug || tags.some((t) => t.slug === slug)) return [];
    return KB_TAG_KINDS.map((kind, i) => ({
      key: `${CREATE}${kind}:${name}`,
      label: `Create “${name}” in ${KB_TAG_KIND_LABELS[kind]}`,
      rule: i === 0,
      disabled: busy,
    }));
  };

  const create = (kind: KbTagKind, name: string) =>
    start(async () => {
      setError(null);
      const res = await createKbTag({ label: name, kind });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      onCreated?.(res.tag);
      // it may already have been on this document if the tag existed
      if (!value.includes(res.tag.id) && !full) onChange([...value, res.tag.id]);
    });

  const pick = (key: string) => {
    if (key.startsWith(CREATE)) {
      const rest = key.slice(CREATE.length);
      const at = rest.indexOf(":");
      create(rest.slice(0, at) as KbTagKind, rest.slice(at + 1));
      return;
    }
    if (value.includes(key)) onChange(value.filter((v) => v !== key));
    else if (!full) onChange([...value, key]);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (open) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setOpen(true);
    }
  };

  return (
    <Field label={label} error={error}>
      <TagTrigger
        ref={ref}
        open={open}
        listId={listId}
        words={chosen.map((t) => t.label).join(", ")}
        onToggle={() => setOpen((o) => !o)}
        onKeyDown={onKeyDown}
      />
      {full && <p className="tgf-full">{KB_TAGS_PER_DOC_MAX} tags is the limit for one document.</p>}
      <Menu
        open={open}
        anchor={ref}
        id={listId}
        kind="listbox"
        label={label}
        items={items}
        chosen={value}
        stay
        filter
        filterLabel={canCreate ? "Find or create a tag" : "Find a tag"}
        filterPlaceholder={canCreate ? "Find a tag, or type a new one" : "Find a tag"}
        extra={creates}
        matchWidth
        onClose={() => setOpen(false)}
        onSelect={pick}
      />
    </Field>
  );
}

/* The field itself: the Chooser's box and chevron, tied to the Field's label. */
function TagTrigger({
  ref,
  open,
  listId,
  words,
  onToggle,
  onKeyDown,
}: {
  ref: Ref<HTMLButtonElement>;
  open: boolean;
  listId: string;
  words: string;
  onToggle: () => void;
  onKeyDown: (e: KeyboardEvent<HTMLButtonElement>) => void;
}) {
  const wired = useFieldWiring({});
  return (
    <button
      ref={ref}
      type="button"
      id={wired.id}
      className={`pt-chooser${wired.invalid ? " pt-chooser--invalid" : ""}`}
      role="combobox"
      aria-invalid={wired.invalid || undefined}
      aria-describedby={wired.describedBy}
      aria-haspopup="listbox"
      aria-expanded={open}
      aria-controls={open ? listId : undefined}
      onClick={onToggle}
      onKeyDown={onKeyDown}
    >
      <span className={`pt-chooser-value${words ? "" : " pt-chooser-value--empty"}`}>{words || "Choose tags"}</span>
      <Chevron className="pt-chooser-chev" />
    </button>
  );
}

/** The palette's names for the tag colours, for a screen reader. */
const COLOUR_NAMES: Record<string, string> = {
  "#f97316": "Orange",
  "#facc15": "Yellow",
  "#22c55e": "Green",
  "#a855f7": "Purple",
  "#ec4899": "Pink",
  "#9ca3af": "Grey",
};

/** The palette, as a row of discs: one of a few, so a radio group. A colour
    stored before the palette moved shows as the disc it snaps to. */
export function ColourDiscs({ value, onChange, label = "Colour" }: { value: string; onChange: (color: string) => void; label?: string }) {
  const current = KB_TAG_COLORS.includes(value.toLowerCase())
    ? value.toLowerCase()
    : (KB_TAG_COLORS.find((c) => kbTagHue(c) === kbTagHue(value)) ?? null);
  return (
    <div className="pt-field">
      <span className="pt-field-label">Colour</span>
      <div className="tgf-discs" role="radiogroup" aria-label={label}>
        {KB_TAG_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            role="radio"
            className="tgf-disc"
            data-hue={kbTagHue(c)}
            aria-label={COLOUR_NAMES[c] ?? c}
            aria-checked={c === current}
            onClick={() => onChange(c)}
          />
        ))}
      </div>
    </div>
  );
}
