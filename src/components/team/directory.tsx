"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/shell/icon";
import type { PendingInviteRow, StaffRow } from "@/lib/staff/types";

type View = "active" | "warn" | "pending";
type Sort = "name" | "role" | "exp";


function hue(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  return h;
}

export function TeamDirectory({
  staff,
  pending,
}: {
  staff: StaffRow[];
  pending: PendingInviteRow[];
}) {
  const [view, setView] = useState<View>("active");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>("name");
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  // menu flips above its button when the row is low in the viewport
  const [menuUp, setMenuUp] = useState(false);
  const router = useRouter();
  // demo-only deactivate/reactivate toggles, keyed by staff id
  const [statusOverride, setStatusOverride] = useState<Record<string, StaffRow["status"]>>({});
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!openMenu) return;
    const close = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpenMenu(null);
      else if (!(e.target as HTMLElement).closest(".dmorewrap")) setOpenMenu(null);
    };
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [openMenu]);

  const withStatus = staff.map((s) => ({ ...s, status: statusOverride[s.id] ?? s.status }));
  const warnStaff = withStatus.filter((s) => s.compliance.state !== "ok");
  const activeCount = withStatus.filter((s) => s.status === "Active").length;

  const rows = useMemo(() => {
    const base = view === "warn" ? warnStaff : withStatus;
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
  }, [withStatus, warnStaff, view, query, sort]);

  const tabIdx = view === "active" ? 0 : view === "warn" ? 1 : 2;
  const tab = (idx: number, key: View, val: number, label: string, sub: string) => (
    <button
      key={key}
      className={`dirtab${view === key ? " on" : ""}`}
      onClick={() => setView(key)}
    >
      <span className="dtval">{val}</span>
      <span className="dtlab">{label}</span>
      <span className="dtsub">{sub}</span>
    </button>
  );

  return (
    <div ref={rootRef}>
      <div className="dirtabs" data-view={view} style={{ "--idx": tabIdx } as React.CSSProperties}>
        <span className="dirtab-slide" style={{ left: `calc(6px + ${tabIdx} * (100% - 12px) / 3)` }} />
        {tab(0, "active", activeCount, "Active staff", "Currently working")}
        {tab(1, "warn", warnStaff.length, "Need attention", "Compliance & work rights")}
        {tab(2, "pending", pending.length, "Pending invites", "Awaiting acceptance")}
      </div>

      {view !== "pending" && (
        <div className="dirtools">
          <div className="dsearch">
            <Icon name="search" size={17} />
            <input
              className="dsearchin"
              placeholder="Search name or role..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <label className="dsortwrap">
            <Icon name="arrowDown" size={14} />
            <select className="dsort" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
              <option value="name">Name (A–Z)</option>
              <option value="role">Role</option>
              <option value="exp">Compliance expiry</option>
            </select>
          </label>
        </div>
      )}

      {view === "pending" ? (
        <div className="dir">
          {pending.map((p) => (
            <div key={p.email} className={`invrow${p.state === "expired" ? " expired" : ""}`}>
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
            </div>
          ))}
        </div>
      ) : (
        <div className="dir">
          <div className="dirhead">
            <span>Name</span>
            <span>Role</span>
            <span>Vehicle</span>
            <span>Compliance &amp; rights</span>
            <span></span>
          </div>
          <div className="dirrows">
            {rows.map((s) => {
              const inactive = s.status === "Inactive";
              return (
                <div
                  key={s.id}
                  className={`dirrow${inactive ? " off" : ""}`}
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
                    <span className="dav" style={{ background: `hsl(${hue(s.name)} 64% 42%)` }}>
                      {s.initials}
                    </span>
                    <span>
                      <b>{s.name}</b>
                      <em>{s.email}</em>
                    </span>
                    {inactive && <span className="dofftag">Inactive</span>}
                  </span>
                  <span className="drole">{s.role}</span>
                  <span className="dveh">{s.vehicle || "—"}</span>
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
                        setOpenMenu(openMenu === s.id ? null : s.id);
                      }}
                    >
                      <Icon name="dots" size={18} />
                    </button>
                    {openMenu === s.id && (
                      <div className={`dmenu open${menuUp ? " up" : ""}`}>
                        <Link href={`/dashboard/team/${s.id}`}>
                          <Icon name="arrowUR" size={15} />
                          View profile
                        </Link>
                        <a href={`mailto:${s.email}`}>
                          <Icon name="mail" size={15} />
                          Message
                        </a>
                        {inactive ? (
                          <button
                            onClick={() => {
                              setStatusOverride((o) => ({ ...o, [s.id]: "Active" }));
                              setOpenMenu(null);
                            }}
                          >
                            <Icon name="rotate" size={15} />
                            Reactivate
                          </button>
                        ) : (
                          <button
                            className="danger"
                            onClick={() => {
                              setStatusOverride((o) => ({ ...o, [s.id]: "Inactive" }));
                              setOpenMenu(null);
                            }}
                          >
                            <Icon name="userx" size={15} />
                            Deactivate
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
    </div>
  );
}
