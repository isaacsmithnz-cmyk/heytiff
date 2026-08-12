"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/shell/icon";
import { WbModal } from "./wb-modal";
import type { ProjectSummary } from "@/lib/workboard/projects-query";
import { createProject } from "@/app/actions/workboard";

/* The project list — cards, not a table: the question at a glance is "how far
   along is each job we're running", which is a stage chip and a progress bar,
   not columns. Creating is manage-only; the button simply isn't offered
   below that (the server re-checks regardless). */

const STATUS_LABEL: Record<string, string> = {
  on_hold: "On hold",
  done: "Done",
  archived: "Archived",
};

export function ProjectsScreen({
  projects,
  manage,
}: {
  projects: ProjectSummary[];
  manage: boolean;
}) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);

  return (
    <div className="page in">
      <div className="wrap">
        <div className="stg">
          <div className="v2head" style={{ marginBottom: 14 }}>
            <div>
              <Link href="/dashboard/workboard" className="int-back">
                <Icon name="chevL" size={15} />
                Workboard
              </Link>
              <h1 style={{ margin: "10px 0 0" }}>
                Projects
              </h1>
            </div>
            {manage && (
              <button className="pbtn primary" onClick={() => setCreating(true)}>
                <Icon name="plus" size={16} />
                New project
              </button>
            )}
          </div>

          {projects.length === 0 ? (
            <div className="card2">
              <div className="c2h">
                <span className="ci">
                  <Icon name="layers" size={19} />
                </span>
                <div>
                  <b>No projects yet</b>
                  <em>
                    A project is the start-to-finish story of an install — stages, checklist,
                    what was left on site, handover.
                    {manage ? " Start the first one." : ""}
                  </em>
                </div>
              </div>
            </div>
          ) : (
            <div className="wb-projgrid">
              {projects.map((p) => (
                <Link
                  href={`/dashboard/workboard/projects/${p.id}`}
                  className="card2 wb-proj"
                  key={p.id}
                >
                  <div className="wb-projhead">
                    <b>{p.name}</b>
                    {p.status !== "active" && (
                      <span className="wb-chip">{STATUS_LABEL[p.status] ?? p.status}</span>
                    )}
                  </div>
                  <em className="wb-projsub">
                    {[p.clientName, p.siteLabel].filter(Boolean).join(" · ") || "—"}
                  </em>
                  <div className="wb-projmeta">
                    <span className="wb-chip on">{p.stage}</span>
                    {p.jobNumbers.slice(0, 3).map((n) => (
                      <span className="wb-chip" key={n}>
                        #{n}
                      </span>
                    ))}
                    {p.jobNumbers.length > 3 && (
                      <span className="wb-chip">+{p.jobNumbers.length - 3}</span>
                    )}
                  </div>
                  <div className="wb-bar">
                    <span style={{ width: `${p.progress.percent}%` }} />
                  </div>
                  <em className="wb-projsub">
                    {p.progress.done}/{p.progress.total} ticked
                  </em>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>

      {creating && (
        <CreateProjectModal
          onClose={() => setCreating(false)}
          onCreated={(id) => {
            setCreating(false);
            router.push(`/dashboard/workboard/projects/${id}`);
          }}
        />
      )}
    </div>
  );
}

function CreateProjectModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const [busy, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [clientName, setClientName] = useState("");
  const [siteLabel, setSiteLabel] = useState("");
  const [siteAddress, setSiteAddress] = useState("");

  const submit = () => {
    setError(null);
    start(async () => {
      const res = await createProject({ name, clientName, siteLabel, siteAddress });
      if (res.ok && res.id) onCreated(res.id);
      else if (!res.ok) setError(res.error);
    });
  };

  return (
    <WbModal title="New project" sub="The default checklist comes with it" onClose={onClose}>
      {error && <div className="int-note bad">{error}</div>}
      <div className="fl-grid">
        <label className="fl-f span">
          <span>
            Name<i>*</i>
          </span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Smith St — ducted change-over"
            autoFocus
          />
        </label>
        <label className="fl-f">
          <span>Client</span>
          <input value={clientName} onChange={(e) => setClientName(e.target.value)} />
        </label>
        <label className="fl-f">
          <span>Site label</span>
          <input
            value={siteLabel}
            onChange={(e) => setSiteLabel(e.target.value)}
            placeholder="Unit 2, warehouse…"
          />
        </label>
        <label className="fl-f span">
          <span>Site address</span>
          <input value={siteAddress} onChange={(e) => setSiteAddress(e.target.value)} />
        </label>
      </div>
      <div className="fl-foot">
        <button className="pbtn ghost" onClick={onClose} disabled={busy}>
          Cancel
        </button>
        <button className="pbtn primary" onClick={submit} disabled={busy || !name.trim()}>
          {busy ? "Creating…" : "Create project"}
        </button>
      </div>
    </WbModal>
  );
}
