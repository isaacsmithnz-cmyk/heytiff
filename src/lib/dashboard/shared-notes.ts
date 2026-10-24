/* A NOTE, AND THE PEOPLE IT IS TO (New › Note, Isaac, 24 October 2026:
   "Yes to new note"; the board https://claude.ai/artifact/NiPWtzHBwnetSyyiBag3Yp).

   A note is for note taking, not the task part: work to do is a Task. With
   no job it goes to the people you name, or to the office (the workspace's
   owners and admins) if you name nobody; with a job it is kept on the job's
   conversation too, as the job's own box keeps it, and anyone named hears
   about it. Each lands in Your feed under To you with Reply and Done. A note
   and its replies are one thread (docs/migrations/shared_notes.sql).

   Pure: the shapes the read hands Your feed (./shared-notes-query). */

export type NoteMessage = {
  id: string;
  authorId: string;
  name: string;
  body: string;
  /** "YYYY-MM-DD HH:MM", the account's clock */
  at: string;
};

export type NoteThread = {
  threadId: string;
  /** who wrote the note that opened it */
  rootAuthorId: string;
  jobUuid: string | null;
  /** "3450 Kingsford", or null with no job, or one the mirror doesn't hold */
  jobLabel: string | null;
  /** written to the office, rather than to people by name */
  toOffice: boolean;
  /** the viewer is in it as one of the office */
  viaOffice: boolean;
  /** oldest first; the first opened it */
  messages: NoteMessage[];
};

/** The longest note, as the table holds it. */
export const NOTE_MAX = 4000;
