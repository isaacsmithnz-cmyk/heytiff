"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/shell/icon";
import { SHARE_TTL_DAYS } from "@/lib/studio/share";

/* Share action card — the customer live link. One link per design: create
   rotates a fresh token, Copy puts the URL on the clipboard, Revoke (armed,
   two clicks) kills it dead. The link serves the LATEST saved design — a
   live window, not a snapshot — so the copy says exactly that. Actions load
   lazily (the packActions pattern) so jsdom never parses the auth0 runtime;
   a session-less context (the dev harness) degrades to a quiet note. */

const shareActions = () => import("@/app/actions/studio-share");

type ShareState =
  | { kind: "loading" }
  | { kind: "unavailable" }
  | { kind: "none" }
  | { kind: "busy" }
  | {
      kind: "active";
      url: string;
      createdAt: string;
      expiresAt: string;
      expired: boolean;
      daysLeft: number;
    };

export function ShareCard({ designId }: { designId: string }) {
  const [state, setState] = useState<ShareState>({ kind: "loading" });
  const [copied, setCopied] = useState(false);
  const [armed, setArmed] = useState(false);

  /* one instance = one design (the mount is keyed by design id), so the
     initial "loading" state IS the reset — no synchronous setState here */
  useEffect(() => {
    let on = true;
    shareActions()
      .then((a) => a.getShareLink(designId))
      .then((link) => {
        if (!on) return;
        setState(link ? { kind: "active", ...link } : { kind: "none" });
      })
      .catch(() => {
        if (on) setState({ kind: "unavailable" });
      });
    return () => {
      on = false;
    };
  }, [designId]);

  const create = () => {
    setState({ kind: "busy" });
    shareActions()
      .then((a) => a.createShareLink(designId))
      .then((link) => setState({ kind: "active", ...link }))
      .catch(() => setState({ kind: "unavailable" }));
  };

  const revoke = () => {
    setArmed(false);
    setState({ kind: "busy" });
    shareActions()
      .then((a) => a.revokeShareLink(designId))
      .then(() => setState({ kind: "none" }))
      .catch(() => setState({ kind: "unavailable" }));
  };

  const copy = (url: string) => {
    void navigator.clipboard?.writeText(url).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    });
  };

  return (
    <div className="ds-act-card">
      <span className="ds-act-t">
        <Icon name="arrowUR" size={14} />
        Share
      </span>

      {state.kind === "loading" && (
        <span className="ds-act-s">Checking for a live link…</span>
      )}

      {state.kind === "unavailable" && (
        <span className="ds-act-s">
          Sharing needs a signed-in session — open the studio from your
          dashboard.
        </span>
      )}

      {(state.kind === "none" || state.kind === "busy") && (
        <>
          <span className="ds-act-s">
            Give the customer a live, read-only link: the latest saved design
            with the simulation running — they can try setpoints, nothing can
            be changed. The link works for {SHARE_TTL_DAYS} days.
          </span>
          <div className="ds-act-row">
            <button
              className="ds-tbbtn ds-act-go"
              onClick={create}
              disabled={state.kind === "busy"}
            >
              {state.kind === "busy" ? "Working…" : "Create live link"}
            </button>
          </div>
        </>
      )}

      {state.kind === "active" && (
        <>
          <span
            className={`ds-share-url${state.expired ? " dead" : ""}`}
            title={state.url}
          >
            {state.url.replace(/^https?:\/\//, "")}
          </span>
          {state.expired ? (
            /* say it plainly — the link still LOOKS like a link, so the card
               has to be the thing that tells you it stopped working */
            <span className="ds-share-meta dead">
              Expired {new Date(state.expiresAt).toLocaleDateString()} — anyone
              opening it now sees nothing. Create a new link to share again.
            </span>
          ) : (
            <span className="ds-share-meta">
              Always shows the latest saved design. Expires in{" "}
              <b>
                {state.daysLeft} day{state.daysLeft === 1 ? "" : "s"}
              </b>{" "}
              ({new Date(state.expiresAt).toLocaleDateString()}).
            </span>
          )}
          <div className="ds-act-row">
            {state.expired ? (
              <button className="ds-tbbtn ds-act-go" onClick={create}>
                Create a new link
              </button>
            ) : (
              <button className="ds-tbbtn" onClick={() => copy(state.url)}>
                <Icon name={copied ? "check" : "file"} size={14} />
                {copied ? "Copied" : "Copy link"}
              </button>
            )}
            {armed ? (
              <>
                <button className="ds-tbbtn ds-share-kill" onClick={revoke}>
                  Really revoke
                </button>
                <button className="ds-tbbtn" onClick={() => setArmed(false)}>
                  Keep
                </button>
              </>
            ) : (
              <button className="ds-tbbtn" onClick={() => setArmed(true)}>
                <Icon name="x" size={13} />
                Revoke
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
