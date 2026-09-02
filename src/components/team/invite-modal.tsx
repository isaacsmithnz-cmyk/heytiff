"use client";

import { useEffect, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/shell/icon";
import { createInvite } from "@/app/actions/invite";

/* Invite staff — the whole invite surface now, reachable only from Team.

   Same portal-to-<body> shape as the fleet modals (.fl-ov / .fl-modal are
   deliberately unscoped in shell.css): .page.in's will-change traps
   position:fixed inside the shell. The markup is written out here rather than
   imported from components/fleet/modals.tsx so Team doesn't pull the fleet
   receipt-reader action into its bundle for a two-field form.

   Which roles appear is decided on the server (invitableRoles) and passed in —
   the action re-checks it, because a select is not a permission.

   `prefill` is the claim path: inviting from an unclaimed card (imported from
   ServiceM8/Xero or pre-seeded) carries that card's id, so accepting binds
   the login to the card instead of minting a duplicate. The address is only
   a starting point — remote systems hold stale ones, so it stays editable. */

const ROLE_LABEL: Record<string, string> = { admin: "Admin", staff: "Staff" };

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
  const [email, setEmail] = useState(prefill?.email ?? "");
  const [role, setRole] = useState(roles.includes("staff") ? "staff" : (roles[0] ?? "staff"));
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const submit = () => {
    if (!email.trim() || busy) return;
    setError(null);
    start(async () => {
      const res = await createInvite({ email, role, staffProfileId: prefill?.staffProfileId });
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
            <label className="fl-f span">
              <span>
                Email address<i>*</i>
              </span>
              <input
                className="fl-i"
                type="email"
                placeholder="name@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") submit();
                }}
              />
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
