"use client";

import { useState } from "react";
import { deleteWorkspace } from "@/app/actions/hq-workspaces";

/* Delete a test sign-up's workspace. Rendered only where the database found
   nothing but setup in it; the name is typed because there is no restore.

   After the delete the page under it is stale (its members table describes a
   workspace that is gone, and a refresh would 404), so this panel says what
   happened and the way out is the overview link at the top. */

export function DeleteWorkspace({ orgId, name }: { orgId: string; name: string }) {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [left, setLeft] = useState<string[] | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const res = await deleteWorkspace(orgId, typed);
      if (res.ok) setLeft(res.logins);
      else setError(res.error);
    } catch {
      setError("Couldn't delete it.");
    }
    setBusy(false);
  }

  if (left) {
    return (
      <div className="hq-card hq-del">
        <p className="hq-del-done">Workspace deleted</p>
        {left.length > 0 ? (
          <p className="hq-pop-note">
            Still signing in through Auth0: <b>{left.join(", ")}</b>.{" "}
            <a href="https://manage.auth0.com/" target="_blank" rel="noreferrer">
              Open Auth0
            </a>
          </p>
        ) : null}
      </div>
    );
  }

  const matches = typed.trim() === name.trim();

  return (
    <div className="hq-card hq-del">
      <label className="hq-del-label" htmlFor="hq-del-name">
        Type <b>{name}</b> to delete it
      </label>
      <div className="hq-del-row">
        <input
          id="hq-del-name"
          className="hq-watch-input"
          value={typed}
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => setTyped(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && matches && !busy) run();
          }}
          disabled={busy}
        />
        <button className="hq-btn danger" onClick={run} disabled={busy || !matches}>
          {busy ? "Deleting…" : "Delete workspace"}
        </button>
      </div>
      {error ? <div className="hq-pop-error">{error}</div> : null}
    </div>
  );
}
