"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/shell/icon";
import type { DesignDocument, DesignVariantRef } from "@/lib/studio/document";

/* DESIGN VARIATIONS — the whole design branched into another option, every
   system with it. Switch between them, rename this one, add another.

   ONE LIST, TWO DOORS. It lived only inside the old cockpit's system switcher,
   so when the systems flow replaced that cockpit (SystemsPanel) the way to add
   a variation went with it and nobody noticed until Isaac went looking for it
   (2026-09-28). The list is its own component now; the old switcher and the
   systems panel's head both render it. */

/** The design's variations, including this one — empty until the first
    branch. A design saved before the list existed carries only its label. */
export function variationsOf(doc: DesignDocument): DesignVariantRef[] {
  if (doc.variants.length > 0) return doc.variants;
  return doc.meta.variantLabel ? [{ id: doc.id, label: doc.meta.variantLabel }] : [];
}

export function VariationList({
  variants,
  currentVariantId,
  onAddVariant,
  onSwitchVariant,
  onRenameVariant,
  onDone,
}: {
  variants: DesignVariantRef[];
  currentVariantId: string;
  onAddVariant: () => void;
  onSwitchVariant: (id: string) => void;
  onRenameVariant: (label: string) => void;
  /** close whatever holds the list */
  onDone: () => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState("");
  return (
    <div className="ds-var-sec">
      <div className="ds-var-cap">Design variations</div>
      {variants.map((v) =>
        renaming && v.id === currentVariantId ? (
          <form
            key={v.id}
            className="ds-var-rename"
            onSubmit={(e) => {
              e.preventDefault();
              onRenameVariant(draft);
              setRenaming(false);
              onDone();
            }}
          >
            <input
              autoFocus
              value={draft}
              aria-label="Rename this variation"
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => setRenaming(false)}
            />
          </form>
        ) : (
          <div key={v.id} className={`ds-var-row${v.id === currentVariantId ? " on" : ""}`}>
            <button
              className="ds-var-pick"
              role="menuitemradio"
              aria-checked={v.id === currentVariantId}
              onClick={() => {
                onDone();
                if (v.id !== currentVariantId) onSwitchVariant(v.id);
              }}
            >
              {v.id === currentVariantId ? <Icon name="check" size={11} /> : <span className="ds-var-dot" />}
              <span className="nm">{v.label}</span>
            </button>
            {v.id === currentVariantId && (
              <button
                className="ds-var-edit"
                onClick={() => {
                  setDraft(v.label);
                  setRenaming(true);
                }}
                title="Rename this variation"
                aria-label="Rename this variation"
              >
                <Icon name="edit" size={11} />
              </button>
            )}
          </div>
        )
      )}
      <button
        className="ds-var-add"
        onClick={() => {
          onAddVariant();
          onDone();
        }}
        title="Branch the whole design into another option — every system comes with it"
      >
        <Icon name="plus" size={12} />
        Add variation
      </button>
    </div>
  );
}

/** The systems panel's door: a button in its head naming the variation you
    are in, opening the list under it. */
export function VariationButton({
  doc,
  onAddVariant,
  onSwitchVariant,
  onRenameVariant,
}: {
  doc: DesignDocument;
  onAddVariant: () => void;
  onSwitchVariant: (id: string) => void;
  onRenameVariant: (label: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const variants = variationsOf(doc);
  const current = variants.find((v) => v.id === doc.id);

  /* a click anywhere else, or Escape, puts it away */
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", away);
    window.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      window.removeEventListener("keydown", esc);
    };
  }, [open]);

  return (
    <div className="ds-layers-wrap" ref={wrap}>
      <button
        className={`ds-zp-btn${open ? " on" : ""}`}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={current ? `Design variations, ${current.label}` : "Design variations"}
      >
        {current ? current.label : "Variations"}
        <Icon name="chevD" size={12} />
      </button>
      {open && (
        <div className="ds-layers-menu ds-zp-varmenu" role="menu">
          <VariationList
            variants={variants}
            currentVariantId={doc.id}
            onAddVariant={onAddVariant}
            onSwitchVariant={onSwitchVariant}
            onRenameVariant={onRenameVariant}
            onDone={() => setOpen(false)}
          />
        </div>
      )}
    </div>
  );
}
