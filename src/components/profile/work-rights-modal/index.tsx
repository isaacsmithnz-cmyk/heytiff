"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/parts/button";
import { readWorkRightsDocument, type ReadWorkRightsResult } from "@/app/actions/work-rights-ai";
import type { StoredDocument } from "@/lib/documents/query";
import { uploadFile } from "@/lib/documents/upload-client";
import { fmtDay } from "@/lib/format/day";
import {
  DetailGrid,
  FrameFoot,
  FrameTitle,
  Group,
  HistoryRow,
  Nothing,
  RecordError,
  RecordFrame,
  RecordStatus,
  RemoveFromHistory,
  type DetailItem,
} from "@/components/record-modal/parts";
import { DocRows } from "@/components/record-modal/doc-rows";
import { ScanCard, scanInProgress, type ScanMode } from "@/components/record-modal/scan-card";
import {
  WORK_RIGHTS_DOC_KIND,
  checkAddedText,
  checkDocuments,
  checkEvent,
  checkFacts,
  checkHeadline,
  checkState,
  checkSubline,
  currentCheck,
  looseCheckDocuments,
  previousChecks,
  type WorkRightsCheckInput,
  type WorkRightsRecord,
} from "@/lib/staff/work-rights-records";
import type { SaveResult } from "../types";
import {
  CheckFields,
  SCAN_COPY,
  SCAN_COPY_NO_VISA,
  checkInput,
  emptyCheck,
  type Check,
} from "./check-fields";
import { isNoVisa } from "@/lib/staff/work-rights";
import { withCleanup } from "@/lib/ui/with-cleanup";

/* ONE PERSON'S RIGHT TO WORK, as a history of CHECKS.

   ONE SCREEN, unlike the licence and credential modals. Those have an identity
   to name — what kind of ticket, what colour — and a wall of many. A person
   has exactly one right to work, and it is not a thing you name; it is a thing
   you keep establishing. So there is no details screen and no add flow: the
   modal IS the record.

   WHAT MAKES THIS ONE DIFFERENT FROM THE OTHER TWO, and it is worth reading
   before changing anything here: the record in force is the LATEST CHECK, not
   the latest expiry. Status goes backwards — a substantive visa lapses to a
   bridging visa, full rights become conditional — and the most recent thing
   the employer verified is what they may rely on. See
   lib/staff/work-rights-records.ts.

   It wears the record window (record-modal/parts, the old-modals mock of
   27 October 2026): one Dialog at 560, the status line, groups under a
   hairline, and the action in the foot. */

export function WorkRightsModal({
  staffId,
  subject,
  records,
  documents,
  today,
  warnDays,
  onRecord,
  onAttach,
  onRemoveCheck,
  onClose,
}: {
  staffId: string;
  /** Whose card this is — null when it is your own, which is how the copy
      knows to say "your" rather than a name. */
  subject: string | null;
  records: WorkRightsRecord[];
  documents: StoredDocument[];
  today: string;
  warnDays: number;
  onRecord: (input: WorkRightsCheckInput) => Promise<SaveResult>;
  onAttach: (recordId: string, documentId: string) => Promise<SaveResult>;
  onRemoveCheck: (recordId: string) => Promise<SaveResult>;
  onClose: () => void;
}) {
  const current = currentCheck(records);
  const history = previousChecks(records);
  const state = checkState(current, today, warnDays);
  const recorded = current !== null;

  const [panelOpen, setPanelOpen] = useState(!recorded);
  const [mode, setMode] = useState<ScanMode>("idle");
  const [check, setCheck] = useState<Check>(emptyCheck);
  const [docId, setDocId] = useState<string | null>(null);
  const [openDoc, setOpenDoc] = useState<string | null>(null);
  const [openHist, setOpenHist] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const attachInput = useRef<HTMLInputElement>(null);

  /* Escape closes, and so does the scrim, except while a scan is in
     progress — see scanInProgress. Close still closes. */
  const softClose = () => {
    if (!scanInProgress()) onClose();
  };

  const run = async (fn: () => Promise<SaveResult>) => {
    setPending(true);
    setError(null);
    await withCleanup(async () => {
      const res = await fn();
      if (!res.ok) setError(res.error);
    }, () => setPending(false));
  };

  const showFields = mode === "scanned" || mode === "manual";
  const canSave = check.status.trim() !== "" && check.checkedOn.trim() !== "" && !pending;

  const fill = (r: ReadWorkRightsResult) => {
    if (!r.ok) return;
    setCheck((p) => ({
      status: r.status ?? p.status,
      visaType: r.visaType ?? p.visaType,
      hoursCondition: r.hoursCondition ?? p.hoursCondition,
      expiresOn: r.expiresOn ?? p.expiresOn,
      checkedOn: r.checkedOn ?? p.checkedOn,
    }));
  };

  const save = () => {
    if (!canSave) return;
    void run(async () => {
      const res = await onRecord({
        ...checkInput(check, mode === "scanned" ? "scan" : "manual"),
        documentId: docId,
      });
      if (res.ok) {
        setCheck(emptyCheck);
        setDocId(null);
        setMode("idle");
        setPanelOpen(false);
      }
      return res;
    });
  };

  /* Which check this is: the one being typed if a status has been chosen,
     else the record's. A citizen has no site to visit. */
  const noVisaStatus = isNoVisa(check.status || current?.status || "");
  const scanCopy = noVisaStatus ? SCAN_COPY_NO_VISA : SCAN_COPY;
  const facts: DetailItem[] = current ? checkFacts(current, state) : [];
  const currentDocs = current ? checkDocuments(documents, current) : [];
  const loose = looseCheckDocuments(documents, records);
  const who = subject?.trim();

  return (
    <RecordFrame width={560} onClose={softClose}>
      <FrameTitle>Right to work</FrameTitle>
      {who && <p className="mk-records-lead">{who}</p>}
      {error && <RecordError>{error}</RecordError>}

      {/* THE WORDS ARE THE VERB. "A check" is the compliance industry's noun
          for the row in the table; what a person DOES is check whether
          someone may work here — look at a passport, or look a visa up — and
          write down what they saw. Every button and heading is that verb, and
          the action is in the foot (Isaac, on the walk: "I don't know what
          record a check actually means"). */}
      <RecordStatus state={state} word={checkHeadline(current, today, warnDays)} line={checkSubline(current)} />

      {current && (
        <Group name={`Checked ${fmtDay(current.checkedOn)}`} aside={checkAddedText(current)}>
          {facts.length > 0 && <DetailGrid items={facts} />}
        </Group>
      )}

      {current && (
        <Group
          name="Evidence"
          action={
            <>
              <Button kind="second" size={32} onClick={() => attachInput.current?.click()}>
                Add document
              </Button>
              <input
                ref={attachInput}
                type="file"
                accept="image/*,application/pdf"
                aria-label="Add document"
                hidden
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (!file) return;
                  const up = await uploadFile(file, WORK_RIGHTS_DOC_KIND).catch(() => null);
                  if (up?.ok) void run(() => onAttach(current.id, up.file.documentId));
                }}
              />
            </>
          }
        >
          <DocRows
            docs={currentDocs}
            openId={openDoc}
            onOpen={(id) => {
              setOpenDoc(id);
              if (id) setOpenHist(null);
            }}
            emptyText="No evidence filed under this check yet."
          />
        </Group>
      )}

      {panelOpen && (
        <ScanCard<ReadWorkRightsResult>
          heading={noVisaStatus ? SCAN_COPY_NO_VISA.heading : recorded ? "Check it again" : SCAN_COPY.heading}
          prompt={scanCopy.prompt}
          paper={scanCopy.paper}
          attachLabel={scanCopy.attach}
          docKind={WORK_RIGHTS_DOC_KIND}
          read={(b64, mt) => readWorkRightsDocument(b64, mt, staffId)}
          onRead={(r, id) => {
            fill(r);
            setDocId(id);
          }}
          onAttached={(id) => setDocId(id)}
          onCancel={recorded ? () => setPanelOpen(false) : undefined}
          mode={mode}
          onMode={(m) => {
            setMode(m);
            if (m === "idle") {
              setCheck(emptyCheck);
              setDocId(null);
            }
          }}
        >
          <CheckFields value={check} onChange={setCheck} today={today} />
        </ScanCard>
      )}

      <Group name="Checked before">
        {history.length === 0 ? (
          <Nothing>Nothing checked before this.</Nothing>
        ) : (
          history.map((r) => {
            const expanded = openHist === r.id;
            const docs = checkDocuments(documents, r);
            return (
              <HistoryRow
                key={r.id}
                name={checkEvent(r)}
                line={docs.length === 1 ? "1 document" : `${docs.length} documents`}
                aside={[`Checked ${fmtDay(r.checkedOn)}`]}
                open={expanded}
                onToggle={() => {
                  setOpenHist(expanded ? null : r.id);
                  setOpenDoc(null);
                }}
              >
                <DetailGrid dense items={checkFacts(r, "ok")} />
                <DocRows docs={docs} openId={openDoc} onOpen={setOpenDoc} emptyText="No evidence filed." />
                <div className="rcw-histfoot">
                  <span>{checkAddedText(r) || "Filed by hand"}</span>
                  <RemoveFromHistory
                    label="Remove this check"
                    heading="Remove this check?"
                    confirm="Remove check"
                    disabled={pending}
                    onConfirm={() => void run(() => onRemoveCheck(r.id))}
                  >
                    {`The check of ${fmtDay(r.checkedOn)} comes out of the history. There is no undo.`}
                  </RemoveFromHistory>
                </div>
              </HistoryRow>
            );
          })
        )}
      </Group>

      {loose.length > 0 && (
        <Group name="Other documents" aside="Not filed under a check">
          <DocRows docs={loose} openId={openDoc} onOpen={setOpenDoc} />
        </Group>
      )}

      <FrameFoot>
        {recorded && !panelOpen && (
          <>
            <Button kind="second" onClick={() => setPanelOpen(true)}>
              Check it again
            </Button>
            <span className="mk-gap" />
          </>
        )}
        <Button kind="quiet" onClick={onClose}>
          {showFields ? "Cancel" : "Close"}
        </Button>
        {showFields && (
          <Button kind="main" onClick={save} disabled={!canSave}>
            {pending ? "Saving the check" : "Save what you found"}
          </Button>
        )}
      </FrameFoot>
    </RecordFrame>
  );
}
