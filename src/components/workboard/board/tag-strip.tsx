"use client";

import { useState } from "react";
import { Icon } from "@/components/shell/icon";
import { TAG_TONES, tagToneFor, type TagTone } from "@/lib/workboard/tags";
import type { BoardTag } from "@/lib/workboard/board-query";

/* The tag strip — one component, both sheets. The visit sheet and the
   agreement sheet had the same forty lines twice over, which is how the two
   drifted apart the last time either changed.

   NEW: creating a tag now lets you PICK its colour (Isaac). The hash of the
   name stays as the default, so a tag you don't think about still lands
   somewhere sane and the B2 rule holds unchanged — the colour is decided
   ONCE, at creation, and stored on the row. Nothing downstream recomputes it,
   so choosing amber for tag #7 can't repaint tags #1–6.

   Picking a swatch runs on MOUSEDOWN with preventDefault, like the
   suggestions beside it: the name input commits on blur, so a plain click
   would create the tag before the colour landed. */

const TONE_LABEL: Record<TagTone, string> = {
  violet: "Violet",
  blue: "Blue",
  cyan: "Cyan",
  pink: "Pink",
  amber: "Amber",
  slate: "Slate",
};

export function TagStrip({
  tags,
  pool,
  manage,
  busy,
  hint,
  onAdd,
  onPick,
  onRemove,
}: {
  tags: BoardTag[];
  /** Every tag in the org — the suggestions are this minus what's already on. */
  pool: BoardTag[];
  manage: boolean;
  busy: boolean;
  hint?: string;
  /** A name nobody has used yet, with the colour the person chose for it. */
  onAdd: (name: string, color: TagTone) => void;
  /** An existing tag, picked from the suggestions or typed by its own name. */
  onPick: (tagId: string) => void;
  onRemove: (tagId: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState("");
  /** Null until the person actually chooses — until then the name decides. */
  const [picked, setPicked] = useState<TagTone | null>(null);

  const suggestions = pool.filter((t) => !tags.some((x) => x.id === t.id));
  const typed = text.trim();
  const match = typed ? pool.find((t) => t.name.toLowerCase() === typed.toLowerCase()) : undefined;
  const tone: TagTone = picked ?? tagToneFor(typed);

  const close = () => {
    setAdding(false);
    setText("");
    setPicked(null);
  };

  const commit = (raw: string) => {
    const name = raw.trim();
    const existing = name
      ? pool.find((t) => t.name.toLowerCase() === name.toLowerCase())
      : undefined;
    const colour = picked ?? tagToneFor(name);
    close();
    if (!name) return;
    if (existing) onPick(existing.id);
    else onAdd(name, colour);
  };

  return (
    <>
      <div className="wb2-tags">
        {tags.map((t) => (
          <span className={`wb2-tag on t-${t.color}`} key={t.id}>
            {t.name}
            {manage && (
              <button
                disabled={busy}
                title="Remove"
                aria-label={`Remove ${t.name}`}
                onClick={() => onRemove(t.id)}
              >
                <Icon name="x" size={10} />
              </button>
            )}
          </span>
        ))}
        {manage &&
          (adding ? (
            <input
              className="wb2-tagin"
              autoFocus
              placeholder="Type or pick a tag"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  commit(text);
                }
                if (e.key === "Escape") close();
              }}
              onBlur={() => commit(text)}
            />
          ) : (
            <button className="wb2-tag add" disabled={busy} onClick={() => setAdding(true)}>
              <Icon name="plus" size={11} />
              Add tag
            </button>
          ))}
      </div>

      {/* Only for a name that doesn't exist yet. An existing tag already owns
          its colour, and offering to change it here would repaint it
          everywhere from a screen about one agreement. */}
      {manage && adding && typed !== "" && !match && (
        <div className="wb2-tagcol">
          <span className="wb2-sect">Colour</span>
          {TAG_TONES.map((t) => (
            <button
              key={t}
              type="button"
              className={`wb2-swatch t-${t}` + (t === tone ? " on" : "")}
              title={TONE_LABEL[t]}
              aria-label={`${TONE_LABEL[t]} — colour for “${typed}”`}
              aria-pressed={t === tone}
              onMouseDown={(e) => {
                e.preventDefault();
                setPicked(t);
              }}
            />
          ))}
          <span className={`wb2-tag t-${tone}`}>{typed}</span>
        </div>
      )}

      {manage && adding && suggestions.length > 0 && (
        <div className="wb2-tagsug">
          {suggestions.map((t) => (
            <button
              key={t.id}
              className={`wb2-tag sug t-${t.color}`}
              disabled={busy}
              // mousedown, not click: the input's blur would unmount this
              // button before a click could land on it
              onMouseDown={(e) => {
                e.preventDefault();
                close();
                onPick(t.id);
              }}
            >
              {t.name}
            </button>
          ))}
        </div>
      )}

      {hint && <p className="wb2-hint">{hint}</p>}
    </>
  );
}
