"use client";

import { useContext, useId, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Dialog } from "@/components/parts/dialog";
import { Button, IconButton } from "@/components/parts/button";
import { Field, TextArea, TextInput } from "@/components/parts/field";
import { Tray } from "@/components/parts/tabs";
import { Tick } from "@/components/parts/tick";
import { TimeField } from "@/components/parts/time-field";
import { DateField } from "@/components/ui/date-field";
import { Icon } from "@/components/shell/icon";
import { WindowsContext } from "@/components/records/records-context";
import { deleteNotice, editNotice, postNotice } from "@/app/actions/dashboard";
import { deleteDocument } from "@/app/actions/documents";
import { cleanPollOptions, MAX_POLL_OPTIONS, POLL_ERROR_TEXT } from "@/lib/dashboard/polls";
import { isEventTime } from "@/lib/dashboard/events";
import { ALLOWED_TYPES, displayName, fmtBytes, MAX_NOTICE_FILES } from "@/lib/documents/files";
import { uploadFile, type UploadedFile } from "@/lib/documents/upload-client";
import type { BoardNotice } from "@/lib/dashboard/board";
import { hhmmOf, wheelOf } from "./clock";

/* WRITE A NOTICE, AND A NOTICE'S EDIT (rules 51 and 52): the noticeboard's
   composer, as a dialog over the board.

   A notice, a poll or an event. A poll asks a question with its answers,
   two to start with since a poll needs two, and may allow more than one
   answer; an event has a day, a start on the wheel and a place. Any of them
   takes photos and files, a day it comes off the board, and a pin to the
   top. The files go to storage as they're picked, before the notice
   exists, and posting is what claims them; a file taken out of the form
   comes out of the bucket too.

   Today's actions underneath, unchanged in what they decide: `postNotice`
   and `editNotice`. An edit is the author's, reaches the wording, the pin,
   the day it comes off and an event's when and where, never a poll's
   answers, which are fixed once people start voting. Posting keeps you on
   the board, with a toast whose Undo takes the notice down again
   (`deleteNotice`); an edit's Undo puts back what it said, its pin, its
   day off the board and its when and where, and takes out the files it
   added. The "Edited" mark an edit leaves stays: the action keeps no way
   to unsay it. */

type Kind = "notice" | "poll" | "event";

const KINDS = [
  { value: "notice", label: "Notice" },
  { value: "poll", label: "Poll" },
  { value: "event", label: "Event" },
] as const;

/** "PDF", "Photo": what a file is, as the board's list says it. */
const fileKind = (f: UploadedFile) =>
  f.mimeType === "application/pdf" ? "PDF" : f.mimeType.startsWith("image/") ? "Photo" : (f.fileName.split(".").pop() ?? "File").toUpperCase();

export function NoticeForm({
  today,
  notice = null,
  onClose,
}: {
  /** The server's AU day, for the date pickers. */
  today: string;
  /** The notice Edit was pressed on; left out, the form writes a new one. */
  notice?: BoardNotice | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const host = useContext(WindowsContext);
  const dayId = useId();
  const offId = useId();
  const fileInput = useRef<HTMLInputElement>(null);
  const editing = !!notice;

  const [kind, setKind] = useState<Kind>(notice?.kind ?? "notice");
  const [title, setTitle] = useState(notice?.title ?? "");
  const [body, setBody] = useState(notice?.body ?? "");
  const [pinned, setPinned] = useState(notice?.pinned ?? false);
  const [expiresAt, setExpiresAt] = useState(notice?.expiresAt ?? "");
  // two empty answers up front: a poll needs two, so ask for two
  const [options, setOptions] = useState<string[]>(["", ""]);
  const [multi, setMulti] = useState(false);
  const [eventDate, setEventDate] = useState(notice?.event?.date ?? "");
  const [eventTime, setEventTime] = useState(notice?.event?.time ?? "");
  const [eventLocation, setEventLocation] = useState(notice?.event?.location ?? "");
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const draftPoll = useMemo(() => cleanPollOptions(options), [options]);
  const composingPoll = kind === "poll" && !editing;
  // an event's when/where stays editable after posting: plans move
  const showingEvent = kind === "event";
  const word = kind === "poll" ? "poll" : kind === "event" ? "event" : "notice";

  const blocked =
    !title.trim() ||
    (composingPoll && !draftPoll.ok) ||
    (showingEvent && (!eventDate || (!!eventTime && !isEventTime(eventTime))));

  const close = () => {
    for (const f of files) if (f.previewUrl) URL.revokeObjectURL(f.previewUrl);
    onClose();
  };

  /* Picking files uploads them straight away: the notice they'll hang off
     doesn't exist yet, and won't until Post. One failure doesn't cancel the
     rest of the selection; it just says which one didn't make it. */
  const pickFiles = async (picked: FileList | null) => {
    if (!picked || picked.length === 0) return;
    setError(null);
    setUploading(true);
    let room = MAX_NOTICE_FILES - files.length;
    for (const file of Array.from(picked)) {
      if (room <= 0) {
        setError(`You can attach up to ${MAX_NOTICE_FILES} files.`);
        break;
      }
      const res = await uploadFile(file, "notice_attachment");
      if (!res.ok) {
        setError(`${displayName(file.name)}: ${res.error}`);
        continue;
      }
      room -= 1;
      setFiles((prev) => [...prev, res.file]);
    }
    setUploading(false);
  };

  const dropFile = (documentId: string) => {
    const going = files.find((f) => f.documentId === documentId);
    if (going?.previewUrl) URL.revokeObjectURL(going.previewUrl);
    setFiles((prev) => prev.filter((f) => f.documentId !== documentId));
    // it was already in storage, so taking it out of the form has to take it
    // out of the bucket too; otherwise it's billable and invisible
    void deleteDocument(documentId);
  };

  /** The event's day moves the day it comes off the board with it, while
      that was the event's own day or unset, as the action's default is. */
  const setDay = (iso: string) => {
    if (!editing && (!expiresAt || expiresAt === eventDate)) setExpiresAt(iso);
    setEventDate(iso);
  };

  const submit = async () => {
    if (pending || uploading || blocked) return;
    setPending(true);
    setError(null);
    const documentIds = files.map((f) => f.documentId);
    const when = showingEvent ? { eventDate, eventTime: eventTime || undefined, eventLocation } : {};
    if (notice) {
      // an EDIT reaches the wording, and an event's when/where, but never a
      // poll's answers, which are fixed once people start voting
      const res = await editNotice({
        noticeId: notice.id,
        title,
        body: body || undefined,
        pinned,
        expiresAt: expiresAt || null,
        documentIds,
        ...when,
      });
      setPending(false);
      if (!res.ok) return setError(res.error ?? "Something went wrong.");
      close();
      router.refresh();
      const was = {
        noticeId: notice.id,
        title: notice.title,
        body: notice.body ?? undefined,
        pinned: notice.pinned,
        expiresAt: notice.expiresAt,
        documentIds: [],
        ...(notice.event
          ? { eventDate: notice.event.date, eventTime: notice.event.time ?? undefined, eventLocation: notice.event.location ?? "" }
          : {}),
      };
      host?.toast(`${word[0]!.toUpperCase()}${word.slice(1)} saved`, async () => {
        await editNotice(was);
        for (const id of documentIds) await deleteDocument(id);
        router.refresh();
      });
      return;
    }
    const res = await postNotice({
      title,
      body: body || undefined,
      pinned,
      expiresAt: expiresAt || null,
      kind,
      documentIds,
      ...(kind === "poll" ? { options, multi } : {}),
      ...when,
    });
    setPending(false);
    if (!res.ok) return setError(res.error ?? "Something went wrong.");
    close();
    router.refresh();
    host?.toast(`${word[0]!.toUpperCase()}${word.slice(1)} posted`, async () => {
      await deleteNotice(res.id);
      router.refresh();
    });
  };

  const heading = editing ? `Edit ${word}` : "Write a notice";
  const go = editing ? "Save changes" : `Post ${word}`;
  const going = editing ? `Saving the ${word}` : `Posting the ${word}`;

  return (
    <Dialog
      heading={heading}
      width={560}
      onClose={close}
      foot={
        <>
          <Button kind="second" onClick={close}>
            Cancel
          </Button>
          <Button kind="main" disabled={pending || uploading || blocked} onClick={() => void submit()}>
            {pending ? going : go}
          </Button>
        </>
      }
    >
      <form
        className="mk-form"
        aria-label={heading}
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        {!editing && (
          <div className="pt-field">
            <span className="pt-field-label">Kind</span>
            <Tray ariaLabel="Kind" options={KINDS} value={kind} onChange={setKind} />
          </div>
        )}
        <Field label={composingPoll ? "Question" : showingEvent ? "What's on" : "Title"}>
          <TextInput value={title} data-autofocus onChange={(e) => setTitle(e.target.value)} />
        </Field>
        {/* A textarea, because this is the announcement: the board keeps its
            line breaks. */}
        <Field label={composingPoll ? "Any detail" : "Message"}>
          <TextArea value={body} rows={3} onChange={(e) => setBody(e.target.value)} />
        </Field>

        {showingEvent && (
          <>
            <div className="mk-pair">
              <Field label="Day" id={dayId}>
                <DateField id={dayId} value={eventDate || null} today={today} onChange={(iso) => setDay(iso ?? "")} />
              </Field>
              <Field label="Start">
                <div className="mk-team-time">
                  <TimeField value={wheelOf(eventTime)} onChange={(v) => setEventTime(hhmmOf(v))} placeholder="No time" />
                  {eventTime && <IconButton glyph="clear" label="Clear the start" onClick={() => setEventTime("")} />}
                </div>
              </Field>
            </div>
            <Field label="Where">
              <TextInput value={eventLocation} onChange={(e) => setEventLocation(e.target.value)} />
            </Field>
          </>
        )}

        {composingPoll && (
          <div className="pt-field">
            <span className="pt-field-label">Answers</span>
            <ul className="mk-team-list">
              {options.map((o, i) => (
                <li className="mk-team-answer" key={i}>
                  <TextInput
                    value={o}
                    aria-label={`Answer ${i + 1}`}
                    onChange={(e) => setOptions((prev) => prev.map((x, j) => (j === i ? e.target.value : x)))}
                  />
                  {options.length > 2 && (
                    <IconButton
                      glyph="clear"
                      label={`Remove answer ${i + 1}`}
                      onClick={() => setOptions((prev) => prev.filter((_, j) => j !== i))}
                    />
                  )}
                </li>
              ))}
            </ul>
            {options.length < MAX_POLL_OPTIONS && (
              <div className="mk-team-files">
                <Button icon="plus" onClick={() => setOptions((prev) => [...prev, ""])}>
                  Add an answer
                </Button>
              </div>
            )}
            {/* only say so once there's something to say it about */}
            {!draftPoll.ok && options.some((o) => o.trim()) && <p className="mk-team-wrong">{POLL_ERROR_TEXT[draftPoll.error]}</p>}
          </div>
        )}
        {composingPoll && <Tick label="Allow more than one answer" checked={multi} onChange={setMulti} />}

        <div className="pt-field">
          <span className="pt-field-label">Photos and files</span>
          <div className="mk-team-files">
            {files.length > 0 && (
              <ul className="mk-team-list" aria-label="Photos and files">
                {files.map((f) => (
                  <li className="mk-team-file" key={f.documentId}>
                    {f.previewUrl ? (
                      /* eslint-disable-next-line @next/next/no-img-element --
                         an in-memory object URL; there is nothing to optimise */
                      <img src={f.previewUrl} alt={displayName(f.fileName)} />
                    ) : (
                      <Icon name="file" size={16} />
                    )}
                    <span className="mk-team-file-text">
                      <span className="mk-team-file-name">{displayName(f.fileName)}</span>
                      <span className="mk-team-file-size">
                        {fileKind(f)}, {fmtBytes(f.sizeBytes)}
                      </span>
                    </span>
                    <Button kind="quiet" size={32} aria-label={`Remove ${displayName(f.fileName)}`} onClick={() => dropFile(f.documentId)}>
                      Remove
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            {files.length < MAX_NOTICE_FILES && (
              <Button icon="upload" disabled={uploading} onClick={() => fileInput.current?.click()}>
                {uploading ? "Uploading the file" : "Attach a file"}
              </Button>
            )}
            <input
              ref={fileInput}
              type="file"
              multiple
              hidden
              accept={Object.keys(ALLOWED_TYPES).join(",")}
              onChange={(e) => {
                void pickFiles(e.target.files);
                e.target.value = "";
              }}
            />
          </div>
        </div>

        <Field label="Comes off the board" id={offId}>
          <DateField
            id={offId}
            value={expiresAt || null}
            today={today}
            clearable
            placeholder={showingEvent ? "The event's day" : "No date"}
            onChange={(iso) => setExpiresAt(iso ?? "")}
          />
        </Field>
        <Tick label="Pin to the top" checked={pinned} onChange={setPinned} />
        {error && (
          <p className="mk-team-wrong" role="alert">
            {error}
          </p>
        )}
      </form>
    </Dialog>
  );
}
