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
   the action re-checks it, because a select is not a permission. */

const ROLE_LABEL: Record<string, string> = { admin: "Admin", staff: "Staff" };

export function InviteModal({ roles, onClose }: { roles: string[]; onClose: () => void }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
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
      const res = await createInvite({ email, role });
      if (res.ok) {
        onClose();
        // the new row belongs on the Pending tab straight away
        router.refresh();
      } else setError(res.error);
    });
  };

  return createPortal(
    <div className="fl-ov" onClick={onClose}>
      <div className="fl-modal" onClick={(e) => e.stopPropagation()}>
        <div className="fl-mh">
          <span>
            <b>Invite staff</b>
            <em>They join your organisation when they open the link</em>
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
              <em className="fl-hint">
                Email sending isn&rsquo;t wired up yet — copy the link off the Pending tab and send
                it yourself.
              </em>
            </label>
          </div>
          <div className="fl-foot">
            <button className="fl-btn ghost" onClick={onClose}>
              Cancel
            </button>
            <button className="fl-btn primary" disabled={busy || !email.trim()} onClick={submit}>
              <Icon name="mail" size={15} />
              Create invite
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
