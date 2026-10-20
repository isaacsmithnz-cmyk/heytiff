"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { removeVehicle as removeVehicleAction } from "@/app/actions/fleet";
import { Button } from "@/components/parts/button";
import { ConfirmDialog } from "@/components/parts/dialog";
import { Fade } from "@/components/parts/fade";
import { Menu, type MenuItem } from "@/components/parts/menu";
import { StateWord } from "@/components/parts/state";
import { SectionTabs, type TabItem } from "@/components/parts/tabs";
import { Icon } from "@/components/shell/icon";
import { namePage } from "@/components/shell/page-names";
import { uploadFile } from "@/lib/documents/upload-client";
import type { VehiclePageData } from "@/lib/fleet/vehicle-page-data";
import {
  SECTION_LABEL,
  headLine,
  headState,
  issueGroups,
  vehicleTabLabel,
  type VehicleSection,
} from "@/lib/fleet/vehicle-page";
import { useFleetActions } from "../fleet-state";
import { STATUS_LABEL, fuelEconomy, valuationStale, type LogKind, type VehicleLog, type VehicleStatus } from "../logic";
import { EditLogModal, LogModal } from "../modals";
import { VehicleModal, addScreen, logScreen, type Screen } from "../vehicle-modal";
import { photoSrc } from "../vehicle-modal/derive";
import { VehicleForm } from "../vehicle-modal/vehicle-form";
import { Documents, Fuel, Issues, Kilometres, Money, Overview, Service, type Doors, type PageView } from "./sections";

/* ONE VEHICLE AS A PAGE (v2, "A vehicle's own page", 18 October; the boards
   v2-board-vehicle-overview, -service, -issues and -km), inside the frame at
   /dashboard/vehicles/<id>.

   The head: its name and rego, one grey line (the driver, the kilometres,
   the model) and where it stands as one word; Add (Service, Issue,
   Kilometres, Document) and Actions (Change status, Change photo, then
   Remove vehicle in red, last). Under it the sections, kept in the address
   as `?tab=` (replaced, not pushed, as the job page keeps its own).

   TODAY'S ENGINES UNDERNEATH (6-revisions, "The forms keep today's
   engines"). Nothing here logs, renews, values or corrects on its own:
   - a new entry, an entry read on its own (with Correct entry and Mark
     resolved), a renewal and the money each open today's own screen of the
     vehicle card (vehicle-modal/), one at a time (`single`), and close back
     to the page;
   - Edit details and Edit schedule open Add a vehicle's form filled in, the rego
     read by Tiff included; Correct entry opens today's correction;
   - the driver, the status and the photo go through the same actions the
     card's controls call; Remove vehicle asks first, then calls the same
     removal.

   THE DRIVER'S OWN VEHICLE is the same page, read-only where My vehicle is
   read-only today (F-175): fuel, a reading and an issue through My
   vehicle's own logging dialog, their own entries corrected, nothing else.
   No Actions, no renewals, no paper and no money; the server never sent
   them (lib/fleet/vehicle-page-data). */

type Over =
  | { t: "none" }
  | { t: "screen"; screen: Screen }
  | { t: "form" }
  | { t: "fix"; log: VehicleLog; back: Screen | null }
  | { t: "log"; kind: LogKind }
  | { t: "remove" };

type MenuKey = "add" | "docs" | "actions" | "status";

const DOC_ITEMS: readonly MenuItem[] = [
  { key: "rego", label: "Rego notice" },
  { key: "ctp", label: "Green slip" },
  { key: "insurance", label: "Certificate of insurance" },
  { key: "purchase_invoice", label: "Purchase invoice" },
  { key: "finance_agreement", label: "Finance agreement" },
];

const STATUS_ITEMS: readonly MenuItem[] = (Object.keys(STATUS_LABEL) as VehicleStatus[]).map((k) => ({ key: k, label: STATUS_LABEL[k] }));

export function VehiclePage({
  data,
  sections,
  section: first,
}: {
  data: VehiclePageData;
  sections: readonly VehicleSection[];
  section: VehicleSection;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const fleet = useFleetActions();
  const [section, setSection] = useState<VehicleSection>(first);
  const [over, setOver] = useState<Over>({ t: "none" });
  const [menu, setMenu] = useState<MenuKey | null>(null);
  const [valuing, setValuing] = useState(false);
  const [valueError, setValueError] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  const addRef = useRef<HTMLButtonElement>(null);
  const actRef = useRef<HTMLButtonElement>(null);
  const photoInput = useRef<HTMLInputElement>(null);

  const register = data.lens === "register";
  const full = data.lens === "register" ? data.vehicle : null;
  const vehicle = data.vehicle;
  const logs = data.logs;
  const documents = data.lens === "register" ? data.documents : [];
  const policies = data.lens === "register" ? data.policies : [];
  const finance = data.lens === "register" ? data.finance : [];
  const staff = data.lens === "register" ? data.staff : [];
  const valuation = data.lens === "register" ? data.valuation : null;
  const pickable = data.lens === "driver" ? data.pickable : [];
  const driverName = full?.assignedTo ? (staff.find((s) => s.id === full.assignedTo)?.name ?? null) : null;
  const eco = fuelEconomy(logs);
  const issues = issueGroups(logs);
  const label = vehicleTabLabel(vehicle);
  const state = headState(vehicle, issues.open.length, data.warnDays);
  const photo = full ? photoSrc(full, documents) : { src: `/fleet/${vehicle.motorised ? "van" : "trailer"}.svg`, own: false };

  /* the open tab's name, "Hilux XQG 41B", with the truck */
  useEffect(() => {
    namePage(pathname, { label, icon: "truck" });
  }, [pathname, label]);

  const goSection = (key: string) => {
    const next = key as VehicleSection;
    setSection(next);
    const url = new URL(window.location.href);
    if (next === "overview") url.searchParams.delete("tab");
    else url.searchParams.set("tab", next);
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  };

  /* no numbers on the sections (rule 31, Isaac, 20 October): open issues
     put Issues' word in amber */
  const tabs: TabItem[] = sections.map((s) => ({ key: s, label: SECTION_LABEL[s], tone: s === "issues" && issues.open.length > 0 ? "look" : undefined }));

  /* A pool ute the driver can fuel while their own is off the road, as My
     vehicle offers it today. */
  const borrowable = pickable.find((p) => p.id !== vehicle.id && p.status === "active") ?? null;

  const canLog = (kind: LogKind): { ok: boolean; why?: string } => {
    if (vehicle.status === "sold") return { ok: false, why: "This vehicle has been sold." };
    if ((kind === "fuel" || kind === "odo") && !vehicle.motorised) return { ok: false };
    if (!register && kind === "service") return { ok: false };
    if (vehicle.status === "offroad" && kind === "odo") return { ok: false, why: "Off the road, so readings are paused. Issues can still be reported." };
    if (vehicle.status === "offroad" && kind === "fuel" && !(!register && borrowable))
      return { ok: false, why: "Off the road, so fuel is paused. Issues can still be reported." };
    return { ok: true };
  };

  const mine = (l: VehicleLog) => data.viewerStaffId !== null && l.staffId === data.viewerStaffId;

  const valueWithTiff = async () => {
    if (valuing) return;
    setValuing(true);
    setValueError(null);
    /* the register's own run: a route, not an action, because pricing
       against live listings runs long (app/api/fleet/value) */
    const res = await fetch("/api/fleet/value", { method: "POST" })
      .then((r) => r.json() as Promise<{ ok: boolean; running?: boolean; reason?: string }>)
      .catch(() => null);
    setValuing(false);
    if (!res) setValueError("Tiff couldn't be reached.");
    else if (res.ok) router.refresh();
    else if (res.running) setValueError("Tiff is already valuing the fleet. The value lands here when she's done.");
    else setValueError(res.reason || "Tiff couldn't complete that.");
  };

  const doors: Doors = {
    entry: (log) => {
      if (register) return () => setOver({ t: "screen", screen: logScreen(log.id) });
      return mine(log) ? () => setOver({ t: "fix", log, back: null }) : null;
    },
    log: (kind) => {
      if (!canLog(kind).ok) return;
      if (register) setOver({ t: "screen", screen: addScreen(kind) });
      else setOver({ t: "log", kind });
    },
    canLog,
    renew: (kind) => setOver({ t: "screen", screen: kind }),
    financials: () => setOver({ t: "screen", screen: "financials" }),
    edit: () => setOver({ t: "form" }),
    assign: (sid) => fleet.assignVehicle(vehicle.id, sid),
    docItems: DOC_ITEMS,
    onDoc: (key) => {
      if (key === "rego" || key === "ctp" || key === "insurance") setOver({ t: "screen", screen: key });
      else setOver({ t: "screen", screen: "financials" });
    },
    valueWithTiff: () => void valueWithTiff(),
    valuing,
    valueError,
  };

  const addItems: MenuItem[] = (register ? (["service", "issue", "odo", "document"] as const) : (["issue", "odo"] as const))
    .filter((k) => k !== "odo" || vehicle.motorised)
    .map((k) => {
      if (k === "document") return { key: k, label: "Document" };
      const can = canLog(k);
      return { key: k, label: k === "odo" ? "Kilometres" : k === "service" ? "Service" : "Issue", disabled: !can.ok, hint: can.ok ? undefined : "Paused while off road" };
    });

  const actionItems: MenuItem[] = [
    { key: "status", label: "Change status" },
    { key: "photo", label: "Change photo" },
    { key: "remove", label: "Remove vehicle", danger: true },
  ];

  const onAction = (key: string) => {
    if (key === "status") setMenu("status");
    else if (key === "photo") photoInput.current?.click();
    else if (key === "remove") setOver({ t: "remove" });
  };

  const remove = async () => {
    setRemoving(true);
    const res = await removeVehicleAction(vehicle.id);
    setRemoving(false);
    if (res.ok) router.replace("/dashboard/assets");
    else {
      setOver({ t: "none" });
      setRemoveError(res.error);
    }
  };

  const setPhoto = async (file: File) => {
    const up = await uploadFile(file, "vehicle_photo").catch(() => null);
    if (up?.ok) fleet.setVehiclePhoto(vehicle.id, up.file.documentId);
  };

  const view: PageView = {
    register,
    vehicle,
    full,
    logs,
    documents,
    policies,
    finance,
    valuation,
    valuationIsStale: full ? valuationStale(full, valuation ?? undefined) : false,
    staff,
    driverName,
    eco,
    today: data.today,
    warnDays: data.warnDays,
  };

  const error = fleet.error ?? removeError;
  const chevron = (
    <span className="vp-chev" aria-hidden="true">
      <Icon name="chevD" size={16} />
    </span>
  );

  return (
    <div className="page in">
      <div className="wrap vp">
        <header className="vp-head">
          <div className="vp-top">
            <span className={`vp-photo${photo.own ? " vp-photo--own" : ""}`}>
              {/* eslint-disable-next-line @next/next/no-img-element -- a signed, expiring URL, as on the card */}
              <img src={photo.src} alt="" />
            </span>
            <div className="vp-id">
              <h1 className="vp-name">
                <Fade>{label}</Fade>
              </h1>
              <p className="vp-line">
                <Fade className="vp-facts-line">{`${headLine(vehicle, register ? driverName : null)}.`}</Fade>
                {state.tone === "info" ? (
                  <span className="vp-stage">{state.word}</span>
                ) : (
                  <StateWord tone={state.tone} className="vp-stage">
                    {state.word}
                  </StateWord>
                )}
              </p>
            </div>
            <div className="vp-acts">
              {addItems.length > 0 && (
                <>
                  <Button
                    ref={addRef}
                    kind="second"
                    icon="plus"
                    aria-haspopup="menu"
                    aria-expanded={menu === "add" || menu === "docs"}
                    onClick={() => setMenu((m) => (m === "add" ? null : "add"))}
                  >
                    Add
                    {chevron}
                  </Button>
                  <Menu
                    anchor={addRef}
                    open={menu === "add"}
                    onClose={() => setMenu(null)}
                    onSelect={(key) => {
                      if (key === "document") setMenu("docs");
                      else {
                        setMenu(null);
                        doors.log(key as LogKind);
                      }
                    }}
                    items={addItems}
                    label="Add to this vehicle"
                    align="end"
                  />
                  <Menu
                    anchor={addRef}
                    open={menu === "docs"}
                    onClose={() => setMenu(null)}
                    onSelect={(key) => {
                      setMenu(null);
                      doors.onDoc(key);
                    }}
                    items={DOC_ITEMS}
                    label="Add a document"
                    align="end"
                  />
                </>
              )}
              {register && (
                <>
                  <Button
                    ref={actRef}
                    kind="second"
                    aria-haspopup="menu"
                    aria-expanded={menu === "actions" || menu === "status"}
                    onClick={() => setMenu((m) => (m === "actions" ? null : "actions"))}
                  >
                    Actions
                    {chevron}
                  </Button>
                  <Menu
                    anchor={actRef}
                    open={menu === "actions"}
                    onClose={() => setMenu(null)}
                    onSelect={(key) => {
                      if (key !== "status") setMenu(null);
                      onAction(key);
                    }}
                    items={actionItems}
                    label="Actions on this vehicle"
                    align="end"
                  />
                  <Menu
                    anchor={actRef}
                    open={menu === "status"}
                    kind="listbox"
                    chosen={vehicle.status}
                    onClose={() => setMenu(null)}
                    onSelect={(key) => {
                      setMenu(null);
                      if (full && key !== full.status) fleet.saveVehicle({ ...full, status: key as VehicleStatus });
                    }}
                    items={STATUS_ITEMS}
                    label="Status"
                    align="end"
                  />
                  <input
                    ref={photoInput}
                    type="file"
                    accept="image/*"
                    aria-label="Change photo"
                    hidden
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      e.target.value = "";
                      if (f) void setPhoto(f);
                    }}
                  />
                </>
              )}
            </div>
          </div>
          <SectionTabs items={tabs} current={section} onGo={goSection} ariaLabel="The vehicle" idPrefix="vp-tab" panelPrefix="vp-panel" />
        </header>

        {error && (
          <p className="vp-err" role="alert">
            {error}
          </p>
        )}

        <section className="vp-body" id={`vp-panel-${section}`} role="tabpanel" aria-labelledby={`vp-tab-${section}`}>
          {section === "service" ? (
            <Service view={view} doors={doors} />
          ) : section === "issues" ? (
            <Issues view={view} doors={doors} />
          ) : section === "kilometres" ? (
            <Kilometres view={view} doors={doors} />
          ) : section === "fuel" ? (
            <Fuel view={view} doors={doors} />
          ) : section === "documents" ? (
            <Documents view={view} doors={doors} />
          ) : section === "money" ? (
            <Money view={view} doors={doors} />
          ) : (
            <Overview view={view} doors={doors} />
          )}
        </section>
      </div>

      {over.t === "screen" && full && (
        <VehicleModal
          key={over.screen}
          single
          vehicle={full}
          logs={logs}
          eco={eco}
          valuation={valuation ?? undefined}
          valuationIsStale={view.valuationIsStale}
          documents={documents}
          policies={policies}
          finance={finance}
          staff={staff}
          today={data.today}
          warnDays={data.warnDays}
          fleet={fleet}
          initialScreen={over.screen}
          onClose={() => setOver({ t: "none" })}
          onEdit={() => setOver({ t: "form" })}
          onCorrect={(log) => setOver({ t: "fix", log, back: logScreen(log.id) })}
        />
      )}
      {over.t === "form" && full && (
        <VehicleForm
          initial={full}
          staff={staff}
          today={data.today}
          onClose={() => setOver({ t: "none" })}
        />
      )}
      {over.t === "fix" && (
        <EditLogModal
          log={over.log}
          today={data.today}
          onSave={(patch) => {
            fleet.editLog(over.log.id, patch);
            setOver(over.back ? { t: "screen", screen: over.back } : { t: "none" });
          }}
          onDelete={() => {
            fleet.deleteLog(over.log.id);
            setOver({ t: "none" });
          }}
          onClose={() => setOver(over.back ? { t: "screen", screen: over.back } : { t: "none" })}
        />
      )}
      {over.t === "log" && (
        <LogModal
          kind={over.kind}
          today={data.today}
          vehicle={over.kind === "fuel" && vehicle.status === "offroad" && borrowable ? borrowable : vehicle}
          fleetVehicles={pickable}
          onSave={(log) => {
            void fleet.addLog(log);
            setOver({ t: "none" });
          }}
          onClose={() => setOver({ t: "none" })}
        />
      )}
      {over.t === "remove" && (
        <ConfirmDialog
          heading={`Remove ${label}?`}
          confirm="Remove vehicle"
          busy={removing}
          onConfirm={() => void remove()}
          onClose={() => setOver({ t: "none" })}
        >
          Its fuel, service, issue and odometer history goes with it, and it leaves the register.
        </ConfirmDialog>
      )}
    </div>
  );
}
