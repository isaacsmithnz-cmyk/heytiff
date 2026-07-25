"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/shell/icon";
import type { DesignContributor } from "@/app/actions/studio-contributors";

/* Contributors — everyone who has saved a change to this design, oldest
   first, so the sheet says who worked on the job. Designs belong to the
   ORGANISATION, not to one person, so this is history rather than ownership:
   nobody is "the owner" and nothing here gates what anyone can do.

   Actions load lazily (the packActions pattern) so jsdom never parses the
   auth0 runtime; a session-less context (the dev harness) stays quiet
   instead of showing an error. */

const contributorActions = () => import("@/app/actions/studio-contributors");

type State =
  | { kind: "loading" }
  | { kind: "unavailable" }
  | { kind: "ready"; list: DesignContributor[] };

/** "Isaac" from a profile, else a readable stub from the account id — never
    the raw auth0 sub, which is meaningless to a person reading the sheet. */
const label = (c: DesignContributor): string => c.name ?? "Unknown member";

const initials = (name: string): string =>
  name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("") || "?";

const when = (iso: string): string =>
  new Date(iso).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

export function ContributorsCard({ designId }: { designId: string }) {
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let on = true;
    contributorActions()
      .then((a) => a.listDesignContributors(designId))
      .then((list) => on && setState({ kind: "ready", list }))
      .catch(() => on && setState({ kind: "unavailable" }));
    return () => {
      on = false;
    };
  }, [designId]);

  /* nothing to say yet — a design saved before this existed, or never saved.
     Better to show nothing than an empty box with a heading. */
  if (state.kind === "unavailable") return null;
  if (state.kind === "ready" && state.list.length === 0) return null;

  return (
    <section className="ds-contrib">
      <h3 className="ds-contrib-h">
        <Icon name="users" size={13} />
        Contributors
      </h3>

      {state.kind === "loading" ? (
        <span className="ds-contrib-note">Loading…</span>
      ) : (
        <>
          <ul className="ds-contrib-list">
            {state.list.map((c) => (
              <li key={c.userId} className="ds-contrib-row">
                <span className="ds-contrib-av" aria-hidden="true">
                  {c.photoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={c.photoUrl} alt="" />
                  ) : (
                    initials(label(c))
                  )}
                </span>
                <span className="ds-contrib-nm">{label(c)}</span>
                <span className="ds-contrib-when">last worked {when(c.lastAt)}</span>
              </li>
            ))}
          </ul>
          <span className="ds-contrib-note">
            Everyone who has saved a change. This design belongs to the
            business — anyone in it can open and edit it.
          </span>
        </>
      )}
    </section>
  );
}
