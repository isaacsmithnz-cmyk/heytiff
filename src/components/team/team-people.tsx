"use client";

import { useContext, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/parts/button";
import { ConfirmDialog } from "@/components/parts/dialog";
import { Empty } from "@/components/parts/states";
import { Fade } from "@/components/parts/fade";
import { Initials } from "@/components/parts/initials";
import { Menu, type MenuItem } from "@/components/parts/menu";
import { Dot, StateWord, type Tone } from "@/components/parts/state";
import { WindowsContext } from "@/components/records/records-context";
import { PersonForm } from "@/components/team/person-form";
import { staffHref } from "@/lib/shell/links";
import { ROLE_COPY } from "@/lib/roles-shared";
import { renewInvite, revokeInvite, type InviteResult } from "@/app/actions/invite";
import { saveStaffSection } from "@/app/actions/staff";
import { createCardForMember, removeMemberWithoutCard } from "@/app/actions/members";
import type { ComplianceState, MemberWithoutCardRow, PendingInviteRow, StaffRow } from "@/lib/staff/types";

/* TEAM, PEOPLE (v2, step 5; the board "Team, People"). One table, a row per
   person (rule 39): who they are and what they do, their licences and
   papers as one state word, the vehicle they drive, their mobile, and what
   they may do in HeyTiff. The name is the door to their page; the whole row
   is a convenience for the pointer.

   Today's directory, every part kept:
   - Active staff are the rows. "Compliance gaps" is what the Licences and
     papers word says, and Sort by "Licences running out" puts them first.
   - An invitation is a row whose word is Invited, with its Actions:
     Resend (Renew and resend once it has lapsed), Copy the invite link and
     Revoke, which asks first. Only an inviter sees the link and the actions.
   - A card nobody has claimed says where it came from, with Invite to join.
   - A member with no staff card sits above the table, outside the search
     that could never find them, with Create card and, for an owner, Remove.
   - Someone who has left is behind "Show people who have left", each with
     Reactivate, which puts them back in one press. Deactivate, and Delete
     for a card nothing points at, are on the person's own page now.

   NOT OPACITY for a row that is less present: opacity multiplies every
   colour inside it and no text survives that (text-contrast.test.ts). A
   left or unclaimed row says so in words. */

export type PeopleData = {
  staff: StaffRow[];
  orphans: MemberWithoutCardRow[];
  pending: PendingInviteRow[];
  /** the viewer may invite — the link, Resend and Revoke are theirs alone */
  canInvite: boolean;
  /** the roles this viewer may invite at, decided on the server */
  inviteRoles: string[];
  /** origin the invite links are built from, resolved on the server */
  appUrl: string;
  /** an owner may take back the seat of a member who never got a card */
  canRemoveMembers: boolean;
  /** staff id → the vehicle they drive; null when the reader can't see the register */
  vehicles: Record<string, string> | null;
};

export type PeopleSort = "name" | "role" | "exp";

export const PEOPLE_SORTS: readonly { value: PeopleSort; label: string }[] = [
  { value: "name", label: "A to Z" },
  { value: "role", label: "Role" },
  { value: "exp", label: "Licences running out" },
];

const TONE: Record<ComplianceState, Tone> = { ok: "good", warn: "look", bad: "wrong" };

/** The licences and papers word: the one worst thing, as the directory said it. */
function papersWord(s: StaffRow): { tone: Tone; text: string } {
  if (s.compliance.label === "—") return { tone: "info", text: "Nothing on file" };
  if (s.compliance.state === "ok") return { tone: "good", text: "All current" };
  return { tone: TONE[s.compliance.state], text: s.compliance.label };
}

/** What someone may do in HeyTiff, or why they can't yet. */
function accessWord(s: StaffRow): string {
  if (!s.userId) return s.importedFrom ? `From ${s.importedFrom}` : "Hasn't joined yet";
  return s.orgRole ? ROLE_COPY[s.orgRole].label : "No access";
}

const matches = (q: string, ...hay: (string | null | undefined)[]) => hay.some((h) => (h ?? "").toLowerCase().includes(q));

export function TeamPeople({
  data,
  query,
  onClearQuery,
  showLeft,
  sort,
}: {
  data: PeopleData;
  query: string;
  onClearQuery: () => void;
  showLeft: boolean;
  sort: PeopleSort;
}) {
  const router = useRouter();
  const host = useContext(WindowsContext);
  const { staff, orphans, pending, canInvite, inviteRoles, appUrl, canRemoveMembers, vehicles } = data;
  const [busy, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  /* inviting an unclaimed card from its row: the invite carries the card id,
     so accepting claims THIS card instead of making a duplicate */
  const [invitee, setInvitee] = useState<StaffRow | null>(null);
  const [revoking, setRevoking] = useState<PendingInviteRow | null>(null);
  const [removing, setRemoving] = useState<MemberWithoutCardRow | null>(null);

  const run = (action: () => Promise<{ ok: boolean; error?: string }>, done?: () => void) => {
    setError(null);
    start(async () => {
      const res = await action();
      if (!res.ok) return setError(res.error ?? "That didn't work.");
      done?.();
      router.refresh();
    });
  };

  /* A letter that failed is not an action that failed: the invite is renewed
     either way and its link still works. So it reads as a note about the post,
     and names the way round it that is in the same row's Actions. */
  const runInvite = (action: () => Promise<InviteResult>) => {
    setError(null);
    start(async () => {
      const res = await action();
      if (!res.ok) return setError(res.error);
      if (res.delivery && !res.delivery.sent) {
        setError(
          res.delivery.reason === "unconfigured"
            ? "Renewed. Email isn't set up in this environment, so copy the link from the invite's Actions instead."
            : `Renewed, but the email to ${res.delivery.to} didn't send. Copy the link from the invite's Actions instead.`,
        );
      } else if (res.delivery) {
        host?.toast(`Invite sent to ${res.delivery.to}`);
      }
      router.refresh();
    });
  };

  const copyLink = (p: PendingInviteRow) => {
    setError(null);
    const url = `${appUrl}/invite/accept?token=${p.token}`;
    void navigator.clipboard
      .writeText(url)
      .then(() => host?.toast("Invite link copied"))
      .catch(() => setError("The link couldn't be copied. Your browser may not allow it here."));
  };

  const q = query.trim().toLowerCase();
  const order = (list: StaffRow[]) =>
    [...list].sort((a, b) =>
      sort === "name"
        ? a.name.localeCompare(b.name)
        : sort === "role"
          ? a.role.localeCompare(b.role)
          : a.compliance.expiresDays - b.compliance.expiresDays,
    );

  /* ARCHIVED IS WHERE A DEACTIVATED PERSON GOES (Isaac, 2026-09-28): out of
     everybody's way, still there, still restorable, their records untouched.
     In v2 that is "Show people who have left". */
  const current = useMemo(() => staff.filter((s) => s.status === "Active"), [staff]);
  const left = useMemo(() => staff.filter((s) => s.status !== "Active"), [staff]);
  const rows = order(q ? current.filter((s) => matches(q, s.name, s.role)) : current);
  const leftRows = showLeft ? order(q ? left.filter((s) => matches(q, s.name, s.role)) : left) : [];
  const invites = q ? pending.filter((p) => matches(q, p.name, p.email, p.role)) : pending;
  const withVehicle = vehicles !== null;
  const nothing = rows.length + leftRows.length + invites.length === 0;

  const head = (
    <div className="tm2-row tm2-row--head" aria-hidden="true">
      <span className="tm2-cell">Person</span>
      <span className="tm2-cell">Licences and papers</span>
      {withVehicle && <span className="tm2-cell">Vehicle</span>}
      <span className="tm2-cell">Mobile</span>
      <span className="tm2-cell">Access</span>
      <span className="tm2-cell" />
    </div>
  );

  const personRow = (s: StaffRow) => {
    const word = papersWord(s);
    const gone = s.status !== "Active";
    const unclaimed = !s.userId;
    return (
      <li key={s.id} className={`tm2-row${gone ? " tm2-row--left" : ""}${unclaimed ? " tm2-row--unclaimed" : ""}`}>
        <span className="tm2-cell tm2-who">
          <Initials name={s.name} size={40} beside />
          <span className="tm2-whotext">
            {/* THE NAME IS THE LINK; the row is a convenience. Its ::after
                covers the row, so a press anywhere on it opens the person,
                while the link is one tab stop with a real address that ⌘-click
                and "open in new tab" understand. */}
            <Link href={staffHref(s.id)} className="tm2-name">
              <Fade>{s.name}</Fade>
            </Link>
            <Fade className="tm2-sub">{s.role !== "—" ? s.role : s.employmentType !== "—" ? s.employmentType : ""}</Fade>
          </span>
        </span>
        <span className="tm2-cell">
          {gone ? (
            <span className="tm2-sub">Left</span>
          ) : (
            <StateWord tone={word.tone} className="tm2-papers">
              {word.text}
            </StateWord>
          )}
        </span>
        {withVehicle && (
          <span className="tm2-cell">
            {vehicles[s.id] ? <Fade>{vehicles[s.id]}</Fade> : <span className="tm2-sub">No vehicle</span>}
          </span>
        )}
        <span className="tm2-cell tm2-num">{s.phone ? <Fade>{s.phone}</Fade> : <span className="tm2-sub">No mobile</span>}</span>
        <span className="tm2-cell">
          <Fade className={unclaimed ? "tm2-sub" : undefined}>{accessWord(s)}</Fade>
        </span>
        <span className="tm2-cell tm2-act">
          {gone ? (
            /* One press: putting someone back is the undo, and an undo that
               asks twice is just a worse undo. */
            <Button
              kind="second"
              size={32}
              disabled={busy}
              onClick={() => run(() => saveStaffSection(s.id, "personal", { status: "Active" }), () => host?.toast(`${s.name} is back on the team`))}
            >
              Reactivate
            </Button>
          ) : unclaimed && canInvite && inviteRoles.length > 0 ? (
            <Button kind="second" size={32} onClick={() => setInvitee(s)}>
              Invite to join
            </Button>
          ) : null}
        </span>
      </li>
    );
  };

  const inviteRow = (p: PendingInviteRow) => (
    <li key={p.id ?? p.email} className="tm2-row tm2-row--invite">
      <span className="tm2-cell tm2-who">
        <Initials name={p.name || p.email} size={40} beside />
        <span className="tm2-whotext">
          <Fade className="tm2-name">{p.name || p.email}</Fade>
          <Fade className="tm2-sub">{p.email}</Fade>
        </span>
      </span>
      <span className="tm2-cell">
        {p.state === "expired" ? (
          <StateWord tone="look">Invite lapsed</StateWord>
        ) : (
          <span className="tm2-invited">Invited</span>
        )}
        <Fade className="tm2-sub">{p.note}</Fade>
      </span>
      {withVehicle && <span className="tm2-cell" />}
      <span className="tm2-cell" />
      <span className="tm2-cell">
        <Fade>{p.role}</Fade>
      </span>
      <span className="tm2-cell tm2-act">
        {/* token and id are there exactly when the page asked withLinks, which
            is when this viewer may invite. RESEND ON A LIVE INVITE TOO: "send
            that again" is the commonest ask, and waiting for it to lapse first
            is not a workflow. */}
        {canInvite && p.token != null && p.id != null && (
          <InviteActions
            invite={p}
            disabled={busy}
            onResend={() => runInvite(() => renewInvite(p.id!))}
            onCopy={() => copyLink(p)}
            onRevoke={() => setRevoking(p)}
          />
        )}
      </span>
    </li>
  );

  return (
    <div className="tm2-people">
      {error && (
        <p className="tm2-err" role="alert">
          <Dot hue="red" />
          {error}
        </p>
      )}

      {/* ABOVE THE TABLE, BECAUSE SEARCH CANNOT FIND THEM. These people are in
          the workspace and have no staff card, so they are in no list here:
          the table reads cards. "No staff card" is what is true, and it is
          what stops them being given work, commenting or uploading; the
          buttons are the remedy. Create card makes it by the door sign-in
          uses; Remove (owners) takes the seat back, safe only because with no
          card there is no history to take with it, and it asks first. */}
      {orphans.length > 0 && (
        <ul className="tm2-rows tm2-orphans" aria-label="People with no staff card">
          {orphans.map((m) => {
            /* The address's local part is the last resort, and when even that
               is missing the Auth0 sub is what is left: ugly, and the only
               handle an admin has. A row that names nobody is not a surface. */
            const name = m.name ?? (m.email ? m.email.split("@")[0] : "Unnamed account");
            return (
              <li key={m.userId} className="tm2-orphan">
                <span className="tm2-who">
                  <Initials name={name} size={40} beside />
                  <span className="tm2-whotext">
                    <Fade className="tm2-name">{name}</Fade>
                    <Fade className="tm2-sub">{m.email || m.userId}</Fade>
                  </span>
                </span>
                <StateWord tone="look">No staff card</StateWord>
                <span className="tm2-sub">{m.role}</span>
                <span className="tm2-orphan-acts">
                  <Button kind="second" size={32} icon="plus" disabled={busy} onClick={() => run(() => createCardForMember(m.userId))}>
                    Create card
                  </Button>
                  {canRemoveMembers && (
                    <Button kind="delete" size={32} disabled={busy} onClick={() => setRemoving(m)}>
                      Remove
                    </Button>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {nothing ? (
        /* "No match" is a statement about a SEARCH, and a lie when there was
           nothing to search. */
        q ? (
          <Empty
            what={`No one here matches "${query.trim()}"`}
            action={
              <Button kind="second" onClick={onClearQuery}>
                Clear the search
              </Button>
            }
          />
        ) : staff.length === 0 && orphans.length === 0 ? (
          <Empty what="Nobody on the team yet" line={canInvite ? "Add a person and they get an invitation to join." : undefined} action={null} />
        ) : showLeft ? (
          <Empty what="Nobody here yet" action={null} />
        ) : (
          <Empty what="Nobody is working here right now" line={left.length > 0 ? "Everyone on file has left." : undefined} action={null} />
        )
      ) : (
        <div className={withVehicle ? "tm2-table tm2-table--veh" : "tm2-table"}>
          {head}
          {rows.length + invites.length > 0 && (
            <ul className="tm2-rows" aria-label={`People, ${rows.length} working`}>
              {rows.map(personRow)}
              {invites.map(inviteRow)}
            </ul>
          )}
          {leftRows.length > 0 && (
            <>
              <h2 className="tm2-group">Left, {leftRows.length}</h2>
              <ul className="tm2-rows" aria-label={`People who have left, ${leftRows.length}`}>
                {leftRows.map(personRow)}
              </ul>
            </>
          )}
        </div>
      )}

      {invitee && (
        <PersonForm
          roles={inviteRoles}
          prefill={{
            /* for an unclaimed card, StaffRow.email IS the address the card was
               imported with; editable in the form, since remote systems hold
               stale ones */
            email: invitee.email,
            staffProfileId: invitee.id,
            name: invitee.name,
          }}
          onClose={() => setInvitee(null)}
        />
      )}

      {revoking && (
        <ConfirmDialog
          heading={`Revoke the invite to ${revoking.name || revoking.email}?`}
          confirm="Revoke invite"
          busy={busy}
          onClose={() => setRevoking(null)}
          onConfirm={() => {
            const id = revoking.id!;
            setRevoking(null);
            runInvite(() => revokeInvite(id));
          }}
        >
          The link in their letter stops working. You can invite them again any time.
        </ConfirmDialog>
      )}

      {removing && (
        <ConfirmDialog
          heading={`Remove ${removing.name ?? removing.email ?? "this account"} from the workspace?`}
          confirm="Remove them"
          busy={busy}
          onClose={() => setRemoving(null)}
          onConfirm={() => {
            const id = removing.userId;
            setRemoving(null);
            run(() => removeMemberWithoutCard(id));
          }}
        >
          They have no staff card, so nothing they did here goes with them. They can be invited again.
        </ConfirmDialog>
      )}
    </div>
  );
}

/** An invitation's Actions: Resend, Copy the invite link, then Revoke in red. */
function InviteActions({
  invite,
  disabled,
  onResend,
  onCopy,
  onRevoke,
}: {
  invite: PendingInviteRow;
  disabled: boolean;
  onResend: () => void;
  onCopy: () => void;
  onRevoke: () => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const items: MenuItem[] = [
    { key: "resend", label: invite.state === "expired" ? "Renew and resend" : "Resend the invite", disabled },
    { key: "copy", label: "Copy the invite link" },
    { key: "revoke", label: "Revoke the invite", danger: true, disabled },
  ];
  return (
    <>
      <Button
        ref={ref}
        kind="quiet"
        size={32}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Actions on the invite to ${invite.name || invite.email}`}
        onClick={() => setOpen((o) => !o)}
      >
        Actions
      </Button>
      <Menu
        anchor={ref}
        open={open}
        onClose={() => setOpen(false)}
        onSelect={(key) => {
          setOpen(false);
          if (key === "resend") onResend();
          else if (key === "copy") onCopy();
          else if (key === "revoke") onRevoke();
        }}
        items={items}
        label={`The invite to ${invite.name || invite.email}`}
        align="end"
      />
    </>
  );
}
