"use client";

import Link from "next/link";
import { useContext, useRef, useState, useSyncExternalStore } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Icon } from "./icon";
import { Chevron } from "../logo";
import { PLACES, STILL_TO_MOVE, YOURS, placeOn, placesFor, type Place } from "./places";
import { useCommandPalette } from "./command-palette-context";
import { WindowsContext, useRecords } from "@/components/records/records-context";
import { NewJobModal } from "@/components/workboard/board/new-job-modal";
import { TaskForm } from "@/components/making/task-form";
import { pinsServerSnapshot, pinsSnapshot, seedPins, subscribePins } from "./pins-store";
import { pinKey, type Pin } from "@/lib/pins/pins";
import { Initials } from "@/components/parts/initials";
import { Menu, type MenuItem } from "@/components/parts/menu";
import type { Role } from "@/lib/roles-shared";
import type { Capability } from "@/lib/permissions";

export type ShellUser = {
  name: string;
  roleLabel: string;
  initials: string;
  /** org role — for the role-intrinsic Settings entry */
  role: Role | null;
  /** resolved capabilities; drives what the sidebar offers. Routes gate themselves too. */
  caps: readonly Capability[];
};

/* THE SIDEBAR (docs/design.md rules 1 and 3 to 7). Ink, top to bottom:
   the wordmark, New, Search, the places, Pinned and Recents, and your name.
   It doesn't fold (rule 27), so the rail's collapse control is gone. */
export function Sidebar({ user, newJob = false, pins = [] }: { user: ShellUser; newJob?: boolean; pins?: readonly Pin[] }) {
  seedPins(pins);
  const pathname = usePathname();
  const viewer = { caps: new Set(user.caps), role: user.role };
  const places = placesFor(PLACES, viewer);
  const moving = placesFor(STILL_TO_MOVE, viewer);
  const { open: openSearch } = useCommandPalette();

  return (
    <aside className="side fr-side" aria-label="Sidebar">
      <div className="fr-brand">
        <Chevron size={24} />
        <span className="fr-wm">HeyTiff</span>
      </div>

      <NewButton newJob={newJob} />

      <button type="button" className="fr-row fr-search" onClick={openSearch}>
        <Icon name="search" size={18} />
        <span className="fr-lbl">Search</span>
        <kbd className="fr-kbd" aria-label="Command K">⌘K</kbd>
      </button>

      <nav className="fr-places" aria-label="Places">
        {places.map((p) => (
          <PlaceRow key={p.key} place={p} on={placeOn(p, pathname)} />
        ))}
        {moving.length > 0 && <div className="fr-hair" role="separator" />}
        {moving.map((p) => (
          <PlaceRow key={p.key} place={p} on={placeOn(p, pathname)} />
        ))}
      </nav>

      <Pinned />
      <Recents />

      <YourName user={user} viewer={viewer} />
    </aside>
  );
}

function PlaceRow({ place, on }: { place: Place; on: boolean }) {
  return (
    <Link href={place.href} className={`fr-row${on ? " on" : ""}`} aria-current={on ? "page" : undefined}>
      <Icon name={place.icon} size={18} />
      <span className="fr-lbl">{place.label}</span>
    </Link>
  );
}

/* NEW (rules 3 and 44): a white disc and the word. Job, Quote and Task are
   made here, the same three on every page, and nothing is filled in. Job is
   the board's own form, offered where ServiceM8 takes new jobs from this
   workspace; Task is everyone's. Quote joins when what it makes is settled.
   The panel is dark and square where it leaves the sidebar. */
function NewButton({ newJob }: { newJob: boolean }) {
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [making, setMaking] = useState<"job" | "task" | null>(null);
  const items: MenuItem[] = [
    ...(newJob ? [{ key: "job", label: "Job", lead: <Icon name="folder" size={16} /> }] : []),
    { key: "task", label: "Task", lead: <Icon name="listCheck" size={16} /> },
  ];
  return (
    <>
      <button
        ref={ref}
        type="button"
        className="fr-new"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="fr-newdisc" aria-hidden>
          <Icon name="plus" size={14} />
        </span>
        New
      </button>
      <Menu
        anchor={ref}
        open={open}
        onClose={() => setOpen(false)}
        onSelect={(key) => {
          setOpen(false);
          if (key === "job" || key === "task") setMaking(key);
        }}
        items={items}
        label="New"
        tone="ink"
      />
      {making === "job" && <NewJobModal onClose={() => setMaking(null)} />}
      {making === "task" && <TaskForm onClose={() => setMaking(null)} />}
    </>
  );
}

const KIND_ICON = { job: "folder", visit: "calendar", agreement: "file" } as const;

/* PINNED (rule 6): what you keep, newest first, from your Pin on a record. */
function Pinned() {
  const pins = useSyncExternalStore(subscribePins, pinsSnapshot, pinsServerSnapshot);
  const { open } = useRecords();
  if (pins.length === 0) return null;
  return (
    <section className="fr-group" aria-label="Pinned">
      <h2 className="fr-grouphead">Pinned</h2>
      {pins.map((p) => (
        <button key={pinKey(p.ref)} type="button" className="fr-row fr-rec" onClick={() => open(p.ref)}>
          <Icon name={KIND_ICON[p.ref.kind]} size={16} />
          <span className="fr-lbl">
            {p.title}
            {p.sub ? `, ${p.sub}` : ""}
          </span>
        </button>
      ))}
    </section>
  );
}

/* RECENTS (rule 6): the records opened lately, newest first. */
function Recents() {
  const host = useContext(WindowsContext);
  const { open } = useRecords();
  const recent = host?.recent ?? [];
  if (recent.length === 0) return null;
  return (
    <section className="fr-group" aria-label="Recents">
      <h2 className="fr-grouphead">Recents</h2>
      {recent.map((r) => (
        <button key={r.key} type="button" className="fr-row fr-rec" onClick={() => open(r.ref)}>
          <Icon name={KIND_ICON[r.ref.kind]} size={16} />
          <span className="fr-lbl">
            {r.title}
            {r.sub ? `, ${r.sub}` : ""}
          </span>
        </button>
      ))}
    </section>
  );
}

/* YOUR NAME (rule 7): at the foot. Your card, timesheet, leave, expense
   claims, Reports and Settings, then Sign out. */
function YourName({ user, viewer }: { user: ShellUser; viewer: { caps: ReadonlySet<Capability>; role: Role | null } }) {
  const ref = useRef<HTMLButtonElement>(null);
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const yours = placesFor(YOURS, viewer);
  const items: MenuItem[] = [
    ...yours.map((p) => ({ key: p.key, label: p.label, lead: <Icon name={p.icon} size={16} /> })),
    { key: "signout", label: "Sign out", lead: <Icon name="logout" size={16} /> },
  ];
  const choose = (key: string) => {
    setOpen(false);
    /* Sign out is a real navigation: the auth route clears the session */
    if (key === "signout") window.location.assign("/auth/logout");
    else {
      const p = yours.find((y) => y.key === key);
      if (p) router.push(p.href);
    }
  };
  return (
    <div className="fr-me">
      <button
        ref={ref}
        type="button"
        className="fr-metrig"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <Initials name={user.name} size={32} />
        <span className="fr-mewho">
          <b>{user.name}</b>
          <em>{user.roleLabel}</em>
        </span>
        <Icon name="chevUD" size={16} />
      </button>
      <Menu anchor={ref} open={open} onClose={() => setOpen(false)} onSelect={choose} items={items} label="Your name" matchWidth />
    </div>
  );
}
