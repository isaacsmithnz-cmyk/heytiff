"use client";

import { useEffect, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/shell/icon";
import { createInvite, lookupInvitee, type InviteeLookup } from "@/app/actions/invite";
import { ROLE_COPY, type Role } from "@/lib/roles-shared";

/* Invite staff — the whole invite surface now, reachable only from Team.

   Same portal-to-<body> shape as the fleet modals (.fl-ov / .fl-modal are
   deliberately unscoped in shell.css): .page.in's will-change traps
   position:fixed inside the shell. The markup is written out here rather than
   imported from components/fleet/modals.tsx so Team doesn't pull the fleet
   receipt-reader action into its bundle for a two-field form.

   Which roles appear is decided on the server (invitableRoles) and passed in —
   the action re-checks it, because a select is not a permission. WHAT EACH
   ROLE MEANS comes from ROLE_COPY, the same sentences the staff card's Access
   panel shows: the choice is made here, often by someone who has never opened
   a staff card, and two bare words are not a description of a permission.

   THE ADDRESS RESOLVES AS IT IS TYPED. This screen used to accept an address
   and say nothing about it until the action refused, and an unclaimed card
   holding that address — imported from ServiceM8, or pre-seeded — was
   invisible from here, so attaching to it meant knowing to start from the row
   in the directory instead. That was two doors whose difference was a
   duplicate person. Now the field says what it found and the invite carries
   the card id on its own.

   `prefill` is the same claim path, arrived at from the row: it carries the
   card id up front. The address stays editable either way — remote systems
   hold stale ones — and editing it re-resolves, which is what keeps the two
   entrances honest with each other. */

/** Debounce for the resolution. Long enough that typing an address is one
    query rather than thirty, short enough that the answer is there before a
    hand reaches the Role select. */
const LOOKUP_MS = 400;

const ROLE_LABEL: Record<string, string> = { admin: "Admin", staff: "Staff" };

const looksLikeEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());

/* One line, in the reader's terms, about what pressing the button will do.
   `tone` is state, never the page accent: `warn` is the ambiguity and the
   two dead ends, where the button is about to do something other than what
   the reader expects. */
function resolutionOf(
  found: InviteeLookup
): { tone: "ok" | "warn"; text: string } | null {
  switch (found.kind) {
    case "card":
      return {
        tone: "ok",
        text: found.name
          ? `Attaches to ${found.name}'s card${found.importedFrom ? ` (from ${found.importedFrom})` : ""} — no second record.`
          : `Attaches to the card already holding this address — no second record.`,
      };
    case "member":
      return {
        tone: "warn",
        text: found.name
          ? `${found.name} already has an account here.`
          : `That person already has an account here.`,
      };
    case "pending":
      return {
        tone: "warn",
        text: "An invitation is already open for this address — resend it from the Pending tab.",
      };
    case "ambiguous":
      return {
        tone: "warn",
        text: `${found.count} unclaimed cards hold this address, so none will be attached. Merge them first, or this creates a third record.`,
      };
    default:
      return null;
  }
}

export type InvitePrefill = {
  email?: string;
  /** The unclaimed card this invite should claim on acceptance. */
  staffProfileId?: string;
  /** For the header, so the claim is legible: whose card this attaches to. */
  name?: string;
};

export function InviteModal({
  roles,
  onClose,
  prefill,
}: {
  roles: string[];
  onClose: () => void;
  prefill?: InvitePrefill;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState(prefill?.email ?? "");
  const [role, setRole] = useState(roles.includes("staff") ? "staff" : (roles[0] ?? "staff"));
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const [found, setFound] = useState<InviteeLookup | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  /* Resolve the address, debounced, and DROP A LATE ANSWER. Without the
     `live` flag a slow reply for a half-typed address lands after the reply
     for the finished one and describes somebody else — the classic race that
     makes a resolution line worse than none, because it is confidently
     wrong. Cleanup also fires on every keystroke, so only the last request
     of a pause is ever allowed to write. */
  useEffect(() => {
    const typed = email.trim();
    /* CLEARING IS THE TYPIST'S ACT, NOT THIS EFFECT'S — it happens in the
       field's onChange. Calling setState in an effect body is a cascading
       render and `react-hooks/set-state-in-effect` rightly refuses it; the
       handler already knows the answer is stale the moment a key is pressed,
       which is earlier and simpler than discovering it here. */
    if (!looksLikeEmail(typed)) return;
    let live = true;
    const t = setTimeout(() => {
      void lookupInvitee(typed).then((res) => {
        if (live) setFound(res);
      });
    }, LOOKUP_MS);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [email]);

  /* THE CARD, IF THERE IS ONE, DECIDES THE NAME — so the field disappears
     rather than being ignored. `prefill` means the reader started from a row
     in the directory; `found.kind === "card"` means the address they typed
     resolved to one. Either way the org already holds this person's name, the
     action discards anything typed here, and a field whose value is thrown
     away is the screen telling a small lie. The line under the address, and
     the header, already say whose card it attaches to. */
  const attachTo =
    prefill?.staffProfileId ?? (found?.kind === "card" ? found.staffProfileId : undefined);

  const submit = () => {
    if (!email.trim() || busy) return;
    setError(null);
    start(async () => {
      /* The resolved card is carried on the submit, so the button that says
         "attaches to Dan's card" is the button that does it. `prefill` wins
         where both exist: it came from a row the reader pointed at, which is
         a stronger statement of intent than an address lookup — and if they
         edited the address away from that card, the action's own org-scoped
         checks still refuse anything that has stopped being true. */
      /* Trimmed to undefined, never "": an empty string is a value the action
         would have to decide about, and "nobody typed a name" is an absence. */
      const res = await createInvite({
        email,
        role,
        name: name.trim() || undefined,
        staffProfileId: attachTo,
      });
      if (!res.ok) return setError(res.error);

      /* SILENT ON SUCCESS, LOUD ONLY WHERE SOMEBODY HAS TO ACT. A letter that
         went needs no confirmation panel — the invite appears on the Pending
         tab behind this modal, which is the receipt. A letter that did NOT go
         changes what the inviter must do next, so the modal stays open and
         says so: the invitation exists either way, and the link on that tab
         is the route that does not depend on mail. */
      if (res.delivery && !res.delivery.sent) {
        setError(
          res.delivery.reason === "unconfigured"
            ? "Invite created. Email isn't set up in this environment — copy the link from the Pending invites tab."
            : `Invite created, but the email to ${res.delivery.to} didn't send. Copy the link from the Pending invites tab.`
        );
        router.refresh();
        return;
      }

      onClose();
      // the new row belongs on the Pending tab straight away
      router.refresh();
    });
  };

  const resolution = found ? resolutionOf(found) : null;

  return createPortal(
    <div className="fl-ov" onClick={onClose}>
      <div className="fl-modal" onClick={(e) => e.stopPropagation()}>
        <div className="fl-mh">
          <span>
            <b>Invite staff</b>
            <em>
              {prefill?.name
                ? `Their account attaches to ${prefill.name}'s card when they accept`
                : "We'll email them a link to join your organisation"}
            </em>
          </span>
          <button className="fl-x" aria-label="Close" onClick={onClose}>
            <Icon name="x" size={16} />
          </button>
        </div>
        <div className="fl-mb">
          {error && <div className="fl-err">{error}</div>}
          <div className="fl-grid">
            {!attachTo && (
              <label className="fl-f span">
                <span>Name</span>
                <input
                  className="fl-i"
                  type="text"
                  placeholder="Dan Whitfield"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") submit();
                  }}
                />
              </label>
            )}
            <label className="fl-f span">
              <span>
                Email address<i>*</i>
              </span>
              <input
                className="fl-i"
                type="email"
                placeholder="name@company.com"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  // the resolution described the OLD address; it is wrong from
                  // this keystroke on, and a wrong line is worse than none
                  setFound(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") submit();
                }}
              />
              {/* Only ever present when it has something to say — a line that
                  reads "nothing found" on every new hire would be noise on
                  the commonest path. */}
              {resolution && (
                <em className={`fl-res ${resolution.tone}`}>
                  <Icon name={resolution.tone === "ok" ? "check" : "alert"} size={13} />
                  {resolution.text}
                </em>
              )}
            </label>
            <label className="fl-f span">
              <span>Role</span>
              <select className="fl-i" value={role} onChange={(e) => setRole(e.target.value)}>
                {roles.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABEL[r] ?? r}
                  </option>
                ))}
              </select>
              {/* WHAT THE CHOICE MEANS, not a caption apologising for the
                  control. The staff card draws these as radio cards, and that
                  language cannot be borrowed here: `.permrole` is scoped under
                  `.fg` and this modal portals to <body>, outside it. So the
                  sentence follows the selection instead — changing the select
                  swaps it, which is the comparison a native <select> can't
                  show two of at once. */}
              {ROLE_COPY[role as Role] && (
                <em className="fl-sub">{ROLE_COPY[role as Role].blurb}</em>
              )}
            </label>
          </div>
          <div className="fl-foot">
            <button className="fl-btn ghost" onClick={onClose}>
              Cancel
            </button>
            <button className="fl-btn primary" disabled={busy || !email.trim()} onClick={submit}>
              <Icon name="mail" size={15} />
              {busy ? "Sending…" : "Send invitation"}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** The Team header button — a server page can't hold the modal's open state. */
export function InviteButton({ roles }: { roles: string[] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        className="pbtn primary"
        style={{ height: 44, flex: "0 0 auto" }}
        onClick={() => setOpen(true)}
      >
        <Icon name="plus" size={16} />
        Invite staff
      </button>
      {open && <InviteModal roles={roles} onClose={() => setOpen(false)} />}
    </>
  );
}
