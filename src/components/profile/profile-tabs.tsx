"use client";

import { ViewTabs } from "@/components/shell/view-tabs";
import type { SectionKey } from "./types";

export type NavItem = { key: SectionKey; label: string; admin?: boolean };

/* The section tabs — the maintenance board's row, on the staff card.

   THE ROW ITSELF NOW LIVES IN `shell/view-tabs`. It was here first, reusing
   `.wb2-vtabs / .wb2-vt / .wb2-vslide` rather than growing a second copy of
   them; when Home became the third screen to want the same strip, keeping the
   CSS shared while copying the COMPONENT would have been that same mistake one
   level up. So this is an adapter now: it keeps the staff card's own vocabulary
   (`SectionKey`, the `admin` padlock, the missing-field count) and hands the
   generic strip everything else. The markup, the measured thumb, the keyboard
   walk and the ids are unchanged.

   IT DOES NOT WRAP. The old strip wrapped onto three lines and put "Admin only"
   above the locked group, because that group landed on its own row anyway. One
   row of nine needs neither: the divider `.wb2-vt` draws between any two
   inactive tabs separates them, and the lock on each says what it is.

   The amber dot became a COUNT. A tab that owns missing fields says how many —
   "Personal 3" is the same sentence the deleted checklist spelled out in three
   rows, and it is the only thing left pointing at which section is short. */
export function ProfileTabs({
  items,
  active,
  attention,
  onGo,
  children,
}: {
  items: NavItem[];
  active: SectionKey;
  /** section → how many of its fields the checklist is still asking for */
  attention: ReadonlyMap<string, number>;
  onGo: (key: SectionKey) => void;
  /** docked at the row's right end, as the board docks its capture pill */
  children?: React.ReactNode;
}) {
  return (
    <ViewTabs
      ariaLabel="Profile sections"
      idPrefix="pftab"
      panelPrefix="psec"
      active={active}
      onGo={(k) => onGo(k as SectionKey)}
      items={items.map((n) => ({
        key: n.key,
        label: n.label,
        locked: n.admin,
        count: attention.get(n.key) ?? 0,
        // the checklist's own words, so the badge and the list agree
        countLabel: (c) => `${c} detail${c === 1 ? "" : "s"} missing`,
        tone: "warn" as const,
      }))}
    >
      {children}
    </ViewTabs>
  );
}
