"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { Icon } from "@/components/shell/icon";
import { createKbTag } from "@/app/actions/kb-tags";
import {
  KB_TAG_COLORS,
  KB_TAG_KIND_LABELS,
  KB_TAG_KINDS,
  KB_TAGS_PER_DOC_MAX,
  kbTagLabel,
  kbTagSlug,
  type KbTagKind,
  type KbTagRef,
} from "@/lib/tiff/tags";

/* Picking a document's tags — one control, three homes.

   IT RENDERS IN THE LIBRARY PAGE (`.fg`), THE UPLOAD DRAWER (`.tk-sheet`) AND
   THE EDIT MODAL (`.fl-modal`), and the last two are portalled to <body>. That
   is not a detail: `.fg` styles do not reach inside a portal, so every rule
   this component needs is written for all three roots in shell.css. A picker
   that looked right in the drawer and unstyled in the modal is the exact bug
   that shape has produced three times in this codebase.

   THE WHOLE LIST IS ON SCREEN, not behind a dropdown. There are fifty-odd tags
   grouped into three, and a tech tagging a manual is recognising names rather
   than recalling them — a `<select multiple>` would hide forty of them and a
   combobox would demand the first three letters of a brand they're holding in
   their hand. The filter box narrows it once the list gets long.

   CREATING IS THE LAST RESORT, AND IT IS ONE PRESS. The box doubles as the
   create control: type something no tag matches and the "Create" row appears
   under it, with a colour already chosen. Re-typing a name that exists finds
   it instead — the server dedupes on the slug and hands the existing tag back,
   so the same click never makes a second Daikin. */

export function TagPicker({
  tags,
  value,
  onChange,
  onCreated,
  canCreate = true,
  /** `sheet` and `modal` mirror the portal they're inside, so the CSS can
      reach them; `page` is the un-portalled library. */
  variant = "page",
  label = "Tags",
}: {
  tags: KbTagRef[];
  value: string[];
  onChange: (tagIds: string[]) => void;
  /** A tag the server just made — the caller owns the list, so it adds it. */
  onCreated?: (tag: KbTagRef) => void;
  canCreate?: boolean;
  variant?: "page" | "sheet" | "modal";
  label?: string;
}) {
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const box = useRef<HTMLInputElement>(null);

  const picked = useMemo(() => new Set(value), [value]);
  const full = value.length >= KB_TAGS_PER_DOC_MAX;

  const q = query.trim().toLowerCase();
  const shown = useMemo(
    () => (q ? tags.filter((t) => t.label.toLowerCase().includes(q) || t.slug.includes(q)) : tags),
    [tags, q]
  );

  /* Only when nothing already answers to that name. The comparison is on the
     SLUG, which is what the server dedupes on — offering "Create Daikin"
     beside an existing Daikin chip would be an offer that quietly does
     nothing. */
  const newLabel = kbTagLabel(query);
  const newSlug = kbTagSlug(newLabel);
  const offerCreate = canCreate && newSlug.length > 0 && !tags.some((t) => t.slug === newSlug);

  const toggle = (id: string) => {
    if (picked.has(id)) {
      onChange(value.filter((v) => v !== id));
      return;
    }
    if (full) return;
    onChange([...value, id]);
  };

  const create = (kind: KbTagKind) =>
    start(async () => {
      setError(null);
      const res = await createKbTag({ label: newLabel, kind });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      onCreated?.(res.tag);
      // it may already have been on this document if the tag existed
      if (!picked.has(res.tag.id) && !full) onChange([...value, res.tag.id]);
      setQuery("");
      box.current?.focus();
    });

  const groups = KB_TAG_KINDS.map((kind) => ({
    kind,
    items: shown.filter((t) => t.kind === kind),
  })).filter((g) => g.items.length > 0);

  return (
    <div className={`tgp tgp-${variant}`}>
      <div className="tgp-top">
        <span className="tgp-lbl">{label}</span>
        {value.length > 0 && (
          <button type="button" className="tgp-clear" onClick={() => onChange([])}>
            Clear
          </button>
        )}
      </div>

      <div className="tgp-find">
        <Icon name="tag" size={14} />
        <input
          ref={box}
          value={query}
          aria-label={canCreate ? "Find or create a tag" : "Find a tag"}
          placeholder={canCreate ? "Find a tag, or type a new one…" : "Find a tag…"}
          onChange={(e) => {
            setQuery(e.target.value);
            setError(null);
          }}
        />
      </div>

      {error && <p className="tgp-err">{error}</p>}

      {offerCreate && (
        <div className="tgp-make">
          <span>
            Create <b>{newLabel}</b> in
          </span>
          {KB_TAG_KINDS.map((kind) => (
            <button
              key={kind}
              type="button"
              className="tgp-mk"
              disabled={busy}
              onClick={() => create(kind)}
            >
              <Icon name="plus" size={12} />
              {KB_TAG_KIND_LABELS[kind]}
            </button>
          ))}
        </div>
      )}

      {groups.length === 0 && !offerCreate ? (
        <p className="tgp-none">
          {tags.length === 0
            ? "No tags yet — type one above to make the first."
            : `Nothing matches “${query.trim()}”.`}
        </p>
      ) : (
        groups.map((g) => (
          <div key={g.kind} className="tgp-grp">
            <em>{KB_TAG_KIND_LABELS[g.kind]}</em>
            <div className="tgp-row">
              {g.items.map((t) => {
                const on = picked.has(t.id);
                return (
                  <button
                    key={t.id}
                    type="button"
                    className={`tgp-t${on ? " on" : ""}`}
                    aria-pressed={on}
                    /* Not disabled at the ceiling — a chip that IS on must
                       stay pressable or the twelfth tag could never come back
                       off. Only the ones you could add are stopped. */
                    disabled={!on && full}
                    style={{ "--tgc": t.color } as React.CSSProperties}
                    onClick={() => toggle(t.id)}
                  >
                    <span className="tgp-d" />
                    {t.label}
                    {on && <Icon name="check" size={12} />}
                  </button>
                );
              })}
            </div>
          </div>
        ))
      )}

      {full && <p className="tgp-full">{KB_TAGS_PER_DOC_MAX} tags is the limit for one document.</p>}
    </div>
  );
}

/* ── the read-only version: what a row wears ─────────────────────────────── */

/** The pills on a library row. Clickable, because a tag on a document is also
    the fastest way to find its siblings — which is what earns them the space
    on a row that already carries a title, a meta line and a status. */
export function TagPills({
  tags,
  max,
  activeIds = [],
  onPick,
}: {
  tags: KbTagRef[];
  /** Past this many the rest collapse into "+N" — a row is not a tag cloud. */
  max: number;
  activeIds?: string[];
  onPick?: (tagId: string) => void;
}) {
  if (tags.length === 0) return null;

  const shown = tags.slice(0, max);
  const rest = tags.length - shown.length;
  const active = new Set(activeIds);

  return (
    <span className="tgl">
      {shown.map((t) =>
        onPick ? (
          <button
            key={t.id}
            type="button"
            className={`tgl-p${active.has(t.id) ? " on" : ""}`}
            style={{ "--tgc": t.color } as React.CSSProperties}
            title={`Show ${t.label} documents`}
            onClick={() => onPick(t.id)}
          >
            {t.label}
          </button>
        ) : (
          <span key={t.id} className="tgl-p" style={{ "--tgc": t.color } as React.CSSProperties}>
            {t.label}
          </span>
        )
      )}
      {rest > 0 && (
        <span className="tgl-more" title={tags.slice(max).map((t) => t.label).join(", ")}>
          +{rest}
        </span>
      )}
    </span>
  );
}

/** The palette, as a row of swatches. Used by the manage sheet. */
export function ColorSwatches({
  value,
  onChange,
  label = "Colour",
}: {
  value: string;
  onChange: (color: string) => void;
  label?: string;
}) {
  return (
    <div className="tgs" role="group" aria-label={label}>
      {KB_TAG_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          className={`tgs-s${c === value ? " on" : ""}`}
          style={{ background: c }}
          aria-label={c}
          aria-pressed={c === value}
          onClick={() => onChange(c)}
        />
      ))}
    </div>
  );
}
