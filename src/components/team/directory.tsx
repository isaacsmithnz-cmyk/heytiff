"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/shell/icon";
import { CopyLink } from "@/components/shell/copy-link";
import { InviteModal } from "@/components/team/invite-modal";
import { renewInvite, revokeInvite, type InviteResult } from "@/app/actions/invite";
import { saveStaffSection } from "@/app/actions/staff";
import type { PendingInviteRow, StaffRow } from "@/lib/staff/types";

type View = "active" | "warn" | "pending";
type Sort = "name" | "role" | "exp";


/* A stable hue per person, for the avatar's ring. It is decoration and
   identity, never state — nothing is read from the colour, so it carries no
   contrast requirement of its own. It must NOT be used to fill the avatar: see
   `.fg .dav`. */
function hue(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  return h;
}

export function TeamDirectory({
  staff,
  pending,
  /** viewer holds `invites` — the link, Renew and Revoke are theirs alone */
  canInvite = false,
  /** origin the invite links are built from, resolved server-side */
  appUrl = "",
  /** roles this viewer may invite at — the row-level Invite reuses the modal */
  inviteRoles = [],
}: {
  staff: StaffRow[];
  pending: PendingInviteRow[];
  canInvite?: boolean;
  appUrl?: string;
  inviteRoles?: string[];
}) {
  const [view, setView] = useState<View>("active");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>("name");
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  // menu flips above its button when the row is low in the viewport
  const [menuUp, setMenuUp] = useState(false);
  const router = useRouter();
  const rootRef = useRef<HTMLDivElement>(null);
  // one write in flight at a time, one row armed for revoke at a time
  const [busy, startInvite] = useTransition();
  const [armed, setArmed] = useState<string | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);
  /* Deactivating arms before it fires, the way Revoke does two rows down —
     it's the one row action that changes what somebody may do tomorrow.
     Separate from `armed` so the invite button's blur handler can't disarm it
     (the menu closing blurs the button). */
  const [armedOff, setArmedOff] = useState<string | null>(null);
  // inviting an unclaimed card from its row — the invite carries the card id,
  // so accepting claims THIS card instead of minting a duplicate
  const [invitee, setInvitee] = useState<StaffRow | null>(null);

  const runInvite = (action: () => Promise<InviteResult>) => {
    setInviteError(null);
    startInvite(async () => {
      const res = await action();
      if (res.ok) router.refresh();
      else setInviteError(res.error);
    });
  };

  /* DEACTIVATE WRITES. It used to set a local `statusOverride` map and nothing
     else — a menu item marked `danger`, with no request behind it, that read as
     done and was undone by the next page load. Someone offboarding a person got
     a grey row and a card that was still active everywhere else in the app.

     It goes through `saveStaffSection`, the same action the profile's Personal
     card saves with: `status` is already in ADMIN_SECTIONS.personal, the enum
     is already Active|Inactive, and the `team` capability is already the gate.
     A new action would have been a second copy of all three. */
  const setActive = (staffId: string, active: boolean) => {
    setInviteError(null);
    startInvite(async () => {
      const res = await saveStaffSection(staffId, "personal", {
        status: active ? "Active" : "Inactive",
      });
      if (res.ok) router.refresh();
      else setInviteError(res.error ?? "That didn't work.");
    });
  };

  /* Opening or closing a row menu always disarms it. Otherwise reopening the
     menu would find Deactivate already asking for its second click, and the
     guard would be spent without anyone having decided anything. Done here
     rather than in an effect on `openMenu`: setState inside an effect body is
     a cascading render, and every path that moves the menu comes through
     this one function anyway. */
  const showMenu = (id: string | null) => {
    setOpenMenu(id);
    setArmedOff(null);
  };

  useEffect(() => {
    if (!openMenu) return;
    const close = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) showMenu(null);
      else if (!(e.target as HTMLElement).closest(".dmorewrap")) showMenu(null);
    };
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [openMenu]);

  /* Memoised because `rows` below depends on it. Rebuilt inline it was a fresh
     array on every render, so the dependency list underneath never matched and
     the memo did no work at all — it re-sorted the whole directory on every
     keystroke, menu toggle and hover. */
  const warnStaff = useMemo(() => staff.filter((s) => s.compliance.state !== "ok"), [staff]);
  const activeCount = staff.filter((s) => s.status === "Active").length;

  const rows = useMemo(() => {
    const base = view === "warn" ? warnStaff : staff;
    const q = query.trim().toLowerCase();
    const filtered = q
      ? base.filter((s) => s.name.toLowerCase().includes(q) || s.role.toLowerCase().includes(q))
      : base;
    return [...filtered].sort((a, b) =>
      sort === "name"
        ? a.name.localeCompare(b.name)
        : sort === "role"
          ? a.role.localeCompare(b.role)
          : a.compliance.expiresDays - b.compliance.expiresDays,
    );
  }, [staff, warnStaff, view, query, sort]);

  const tabIdx = view === "active" ? 0 : view === "warn" ? 1 : 2;

  /* Which view you are on was carried by opacity and a sliding white pill and
     nothing else — three plain buttons, no roles, no aria-selected. It is a
     tablist, so it says so: roving tabindex and the arrow walk included,
     because a tablist that puts every tab in the tab order is a worse tablist
     than none. Same contract the staff card's strip already keeps. */
  const moveTab = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    const keys = ["ArrowLeft", "ArrowRight", "Home", "End"];
    if (!keys.includes(e.key)) return;
    const tabs = [...(e.currentTarget.closest(".dirtabs")?.querySelectorAll<HTMLButtonElement>('[role="tab"]') ?? [])];
    const i = tabs.indexOf(e.currentTarget);
    if (i < 0) return;
    e.preventDefault();
    const next =
      e.key === "Home"
        ? 0
        : e.key === "End"
          ? tabs.length - 1
          : (i + (e.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
    tabs[next]?.focus();
  };

  const tab = (key: View, val: number, label: string, sub: string) => {
    const on = view === key;
    return (
      <button
        key={key}
        type="button"
        role="tab"
        id={`dirtab-${key}`}
        aria-selected={on}
        aria-controls="dirpanel"
        tabIndex={on ? 0 : -1}
        className={`dirtab${on ? " on" : ""}`}
        onClick={() => setView(key)}
        onKeyDown={moveTab}
      >
        <span className="dtval">{val}</span>
        <span className="dtlab">{label}</span>
        <span className="dtsub">{sub}</span>
      </button>
    );
  };

  return (
    <div ref={rootRef}>
      <div className="dirtabs" role="tablist" aria-label="Directory view" data-view={view}>
        <span
          className="dirtab-slide"
          aria-hidden="true"
          style={{ left: `calc(6px + ${tabIdx} * (100% - 12px) / 3)` }}
        />
        {tab("active", activeCount, "Active staff", "Currently working")}
        {/* NOT "Need attention". Home's card has a tab called "Needs
            attention" one rail row away, and the two count different things in
            different units: Home counts ITEMS inside a 30-day warning window
            across people, fleet, business and pay; this counts PEOPLE whose
            compliance isn't clear, expired and expiring together. Two numbers
            that will rarely agree under two labels a letter apart. This one
            says what it counts. */}
        {tab("warn", warnStaff.length, "Compliance gaps", "Expired, expiring or unverified")}
        {tab("pending", pending.length, "Pending invites", "Awaiting acceptance")}
      </div>

      {view !== "pending" && (
        <div className="dirtools">
          <div className="dsearch">
            <Icon name="search" size={17} />
            <input
              className="dsearchin"
              aria-label="Search staff by name or role"
              placeholder="Search name or role..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          {/* The wrapper holds an icon and no text, so without a name of its
              own the select announced as its whole option list — "Name
              (A–Z)RoleCompliance expiry". A <label> that wraps a control still
              has to say something. */}
          <label className="dsortwrap">
            <Icon name="arrowDown" size={14} />
            <select
              className="dsort"
              aria-label="Sort by"
              value={sort}
              onChange={(e) => setSort(e.target.value as Sort)}
            >
              <option value="name">Name (A–Z)</option>
              <option value="role">Role</option>
              <option value="exp">Compliance expiry</option>
            </select>
          </label>
        </div>
      )}

      {view === "pending" ? (
        <div className="dir" id="dirpanel" role="tabpanel" aria-labelledby={`dirtab-${view}`}>
          {inviteError && <div className="invmsg">{inviteError}</div>}
          {pending.length === 0 && <div className="direm on">No invites waiting.</div>}
          {pending.map((p) => (
            <div key={p.id} className={`invrow${p.state === "expired" ? " expired" : ""}`}>
              <span className="invwho">
                <span className="invav">
                  <Icon name="mail" size={16} />
                </span>
                <span>
                  <b>{p.name}</b>
                  <em>{p.email}</em>
                </span>
              </span>
              <span className="invrole">{p.role}</span>
              <span className="invexp">
                <Icon name={p.state === "expired" ? "alert" : "clock"} size={12} />
                {p.note}
              </span>
              {/* No email sending yet: the link IS the invite, so whoever may
                  invite gets it, plus the two things they can do about a row
                  that's gone stale. token/id are non-null exactly when the
                  page asked withLinks — i.e. when canInvite. */}
              {canInvite && p.token != null && p.id != null && (
                <div className="invtools">
                  <CopyLink url={`${appUrl}/invite/accept?token=${p.token}`} />
                  <div className="invbtns">
                    {p.state === "expired" && (
                      <button
                        className="fl-btn tiny"
                        disabled={busy}
                        onClick={() => runInvite(() => renewInvite(p.id!))}
>
                        <Icon name="rotate" size={13} />
                        Renew
                      </button>
                    )}
                    <button
                      className={`fl-btn tiny danger${armed === p.id ? " arm" : ""}`}
                      disabled={busy}
                      onBlur={() => setArmed((a) => (a === p.id ? null : a))}
                      onClick={() => {
                        if (armed !== p.id) return setArmed(p.id);
                        setArmed(null);
                        runInvite(() => revokeInvite(p.id!));
                      }}
                    >
                      <Icon name="x" size={13} />
                      {armed === p.id ? "Confirm revoke" : "Revoke"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="dir" id="dirpanel" role="tabpanel" aria-labelledby={`dirtab-${view}`}>
          {/* Deactivate writes from THIS view, so its failure has to be
              readable from this view — the message used to live only in the
              pending-invites branch. */}
          {inviteError && <div className="invmsg">{inviteError}</div>}
          <div className="dirhead">
            <span>Name</span>
            <span>Role</span>
            {/* THE VEHICLE COLUMN IS GONE. `toStaffRow` hardcoded
                `vehicle: "—"` — fleet is still keyed by demo staff ids and
                was never wired to `staff_profiles.id` — so this was 160px,
                13.5% of every row, showing an em-dash for every person in
                every workspace. A column that has never once held a value is
                not a placeholder, it is furniture. It comes back when the
                register is wired, with the row that fills it. */}
            <span>Compliance &amp; rights</span>
            <span></span>
          </div>
          <div className="dirrows">
            {rows.map((s) => {
              const inactive = s.status === "Inactive";
              // a card without a login yet — imported or pre-seeded, waiting
              // on its invite; greyed until the person claims it
              const unclaimed = !s.userId;
              return (
                <div
                  key={s.id}
                  className={`dirrow${inactive ? " off" : ""}${unclaimed ? " unclaimed" : ""}`}
                  role="link"
                  tabIndex={0}
                  onClick={() => router.push(`/dashboard/team/${s.id}`)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      router.push(`/dashboard/team/${s.id}`);
                    }
                  }}
                >
                  <span className="dname">
                    {/* the hue rides in as a custom property, never as
                        `background` — see .fg .dav in shell.css for what the
                        shorthand did to the ring */}
                    <span
                      className="dav"
                      style={{ "--av": `hsl(${hue(s.name)} 72% 56%)` } as React.CSSProperties}
                    >
                      {s.initials}
                    </span>
                    <span>
                      <b>{s.name}</b>
                      <em>{s.email}</em>
                    </span>
                    {inactive && <span className="dofftag">Inactive</span>}
                    {unclaimed && (
                      <span className="dofftag">
                        {s.importedFrom ? `From ${s.importedFrom}` : "Hasn't joined yet"}
                      </span>
                    )}
                  </span>
                  <span className="drole">{s.role}</span>
                  <span className={`dchip ${s.compliance.state}`}>
                    {s.compliance.label === "—" ? null : (
                      <Icon name={s.compliance.state === "ok" ? "check" : "alert"} size={12} />
                    )}
                    {s.compliance.label}
                  </span>
                  {/* the whole row navigates, so the menu keeps its clicks to itself */}
                  <span className="dmorewrap" onClick={(e) => e.stopPropagation()}>
                    <button
                      className="dmore"
                      aria-label="Actions"
                      onClick={(e) => {
                        const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                        setMenuUp(r.bottom + 220 > window.innerHeight);
                        showMenu(openMenu === s.id ? null : s.id);
                      }}
                    >
                      <Icon name="dots" size={18} />
                    </button>
                    {openMenu === s.id && (
                      <div className={`dmenu open${menuUp ? " up" : ""}`}>
                        {unclaimed && canInvite && inviteRoles.length > 0 && (
                          <button
                            onClick={() => {
                              showMenu(null);
                              setInvitee(s);
                            }}
                          >
                            <Icon name="send" size={15} />
                            Invite to join
                          </button>
                        )}
                        <Link href={`/dashboard/team/${s.id}`}>
                          <Icon name="arrowUR" size={15} />
                          View profile
                        </Link>
                        <a href={`mailto:${s.email}`}>
                          <Icon name="mail" size={15} />
                          Message
                        </a>
                        {inactive ? (
                          /* One click: putting someone back is the undo, and
                             an undo that asks twice is just a worse undo. */
                          <button
                            disabled={busy}
                            onClick={() => {
                              showMenu(null);
                              setActive(s.id, true);
                            }}
                          >
                            <Icon name="rotate" size={15} />
                            Reactivate
                          </button>
                        ) : (
                          <button
                            className={`danger${armedOff === s.id ? " arm" : ""}`}
                            disabled={busy}
                            onClick={() => {
                              if (armedOff !== s.id) return setArmedOff(s.id);
                              setArmedOff(null);
                              showMenu(null);
                              setActive(s.id, false);
                            }}
                          >
                            <Icon name="userx" size={15} />
                            {armedOff === s.id ? "Confirm deactivate" : "Deactivate"}
                          </button>
                        )}
                      </div>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
          {rows.length === 0 && <div className="direm on">No staff match your filters.</div>}
        </div>
      )}

      {invitee && (
        <InviteModal
          roles={inviteRoles}
          prefill={{
            // for an unclaimed card, StaffRow.email IS the contact_email the
            // card was imported with — editable in the modal, remote systems
            // hold stale addresses
            email: invitee.email,
            staffProfileId: invitee.id,
            name: invitee.name,
          }}
          onClose={() => setInvitee(null)}
        />
      )}
    </div>
  );
}
