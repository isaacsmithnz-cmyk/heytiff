/* Every sentence a note to ServiceM8 says, by key — pure, and importing
   nothing.

   B and C use these keys verbatim; neither defines words of its own for a
   note's state. sm8-note-plan re-exports them as NOTE_WORDS (the public
   contract), and sm8-write-plan reads the few it needs for a note's
   verdicts. This module imports nothing so those two can both import it
   without a cycle between them.

   TWO SENTENCES ARE WRITE_WORDS' OWN, copied here because importing
   sm8-write-plan would make that cycle: press.capped is WRITE_WORDS.paused
   and press.unreadable is WRITE_WORDS.settingsUnread. A test holds them
   equal (sm8-note-plan.test).

   Placeholders are {name} (a HeyTiff name), {sm8Name} (a ServiceM8 name),
   {n}, {files}, {notes}, {why} and {reason}; `fillWords` puts them in. */

export const NOTE_WORDS = {
  scope: {
    notes:
      "Lets HeyTiff add, change and remove notes on a job. HeyTiff adds the notes people write or reply with here, each sent as that person, marks a flagged note done when someone answers it here, and removes a note only when whoever sent it takes it back.",
  },
  card: {
    heading: "Sending to ServiceM8",
    files: "Files",
    notes: "Notes",
    filesGroup: "Sending files to ServiceM8",
    notesGroup: "Sending notes to ServiceM8",
    off: "Off",
    on: "On",
    onLine: "On. {n} sent in the last 30 days.",
    onLineNone: "On.",
    trialLine: "Trial run. Each send from a job is checked and listed here. Nothing reaches ServiceM8.",
    notesConsent:
      "ServiceM8 hasn't given HeyTiff permission to add notes yet, so no note can go. Reconnect ServiceM8 above and approve it on ServiceM8's screen.",
    filesConsent:
      "ServiceM8 hasn't given HeyTiff permission to add files yet, so nothing can go. Reconnect ServiceM8 above and approve it on ServiceM8's screen.",
    notesOffOne: "Notes are off. 1 note that was waiting won't go.",
    notesOffMany: "Notes are off. {n} notes that were waiting won't go.",
    filesOffOne: "Files are off. 1 file that was waiting won't go.",
    filesOffMany: "Files are off. {n} files that were waiting won't go.",
    notAKind: "That isn't something HeyTiff sends.",
    notesUnavailable: "Notes can't be sent from this deployment yet.",
  },
  label: {
    diary: "Note",
    reply: "Reply",
    done: "Done.",
    flag_done: "Flagged note marked done",
    flag_clear: "Done mark taken off",
    take_back: "Note taken out of ServiceM8",
    fallback: "A note",
  },
  kindWords: {
    fileOne: "1 file",
    fileMany: "{n} files",
    noteOne: "1 note",
    noteMany: "{n} notes",
    both: "{files} and {notes}",
    heldAll: "ServiceM8 hasn't given HeyTiff permission to add files or notes. They go once ServiceM8 is reconnected.",
    allOff: "Sending files and notes to ServiceM8 is switched off.",
  },
  press: {
    kindOff: "Sending notes to ServiceM8 is switched off. An owner can change that in Integrations, ServiceM8.",
    notesScope: "ServiceM8 hasn't given HeyTiff permission to add notes yet. An owner can change that in Integrations, ServiceM8.",
    unlinked: "Link yourself to ServiceM8 first. An owner can do that in Integrations, ServiceM8.",
    noCard: "This login has no staff card, so nothing can go to ServiceM8 as you.",
    confirm: "Is {sm8Name} you?",
    denied: "You said you aren't {sm8Name} in ServiceM8. An owner can fix your link in Integrations, ServiceM8.",
    inactive: "ServiceM8 has {sm8Name} as inactive, so nothing can go as you.",
    unknown: "HeyTiff couldn't check your ServiceM8 link. Nothing was sent.",
    badLink: "Your ServiceM8 link is broken. An owner can fix it in Integrations, ServiceM8.",
    linkChanged: "Your ServiceM8 link changed. Look again.",
    jobGone: "That job isn't in ServiceM8's copy any more.",
    noNote: "That note is no longer here.",
    removedThere: "Someone removed it in ServiceM8, so HeyTiff won't send it again.",
    notYours: "Only {name}, who sent it, can take it out of ServiceM8.",
    notMarker: "Only {name}, who marked it done, can take that back.",
    notAuthor: "Only the person who wrote it can send it to ServiceM8.",
    notMentioned: "That note doesn't mention you.",
    notFlagged: "That note isn't flagged in ServiceM8.",
    changed: "Changed in ServiceM8. Look again.",
    inFlight: "That's going to ServiceM8 right now. Try again in a moment.",
    inFlightFinal: "That's going to ServiceM8 right now, so it can't be taken back here.",
    emptyReply: "Write a reply first.",
    saveFailed: "Couldn't save that reply.",
    unqueued: "HeyTiff couldn't queue it. Try again.",
    takeBackOff:
      "Sending notes to ServiceM8 is switched off, so it can't be taken out of ServiceM8. An owner can change that in Integrations, ServiceM8.",
    removeHeld: "This note was queued for ServiceM8, so it can be removed only once sending notes is back on.",
    /** WRITE_WORDS.paused */
    capped: "Sending to ServiceM8 is paused. An owner can change that in Integrations, ServiceM8.",
    /** WRITE_WORDS.settingsUnread */
    unreadable: "HeyTiff couldn't read the ServiceM8 settings. Nothing was sent or cancelled.",
  },
  row: {
    unlinked: "{name} isn't linked to ServiceM8.",
    noCard: "The person who pressed it has no staff card any more.",
    unconfirmed: "{name} hasn't confirmed their ServiceM8 link.",
    denied: "{name} said the ServiceM8 link isn't them.",
    inactive: "{sm8Name} isn't active in ServiceM8.",
    unknown: "HeyTiff couldn't check {name}'s ServiceM8 link.",
    badLink: "{name}'s ServiceM8 link is broken. An owner can fix it in Integrations, ServiceM8.",
    capped: "Sending was paused at 60 in an hour, so it didn't queue.",
    unqueued: "HeyTiff couldn't queue it.",
    unreadable: "HeyTiff couldn't read the ServiceM8 settings, so it didn't queue.",
    personForbidden: "{name}'s ServiceM8 login can't do this.",
    loginUnchecked: "HeyTiff couldn't check whether ServiceM8 still accepts this login. Trying again in a minute.",
    scopeHeldNote: "ServiceM8 hasn't given HeyTiff permission to add notes. It goes once ServiceM8 is reconnected.",
    noteRefused: "ServiceM8 refused the note.",
    noteTooLong: "ServiceM8 said the note is too long.",
    noteGone: "The note isn't in ServiceM8 any more.",
    noteUnsure: "HeyTiff couldn't tell whether the note reached ServiceM8. Send it again if it isn't there.",
    notKept: "ServiceM8 took the change but didn't keep it.",
    noteWordsCleared: "The note's words were cleared after 30 days, so it can't go now.",
    jobGone: "That job isn't in ServiceM8's copy any more.",
    changed: "Changed in ServiceM8. Look again.",
    takenBackBeforeSent: "Taken back before it went.",
    nothingToTakeBack: "It never reached ServiceM8, so there was nothing to take back.",
    notSender: "Only the person who sent it can take it out of ServiceM8.",
    notesSwitchedOff: "Sending notes to ServiceM8 was switched off before it went.",
    filesSwitchedOff: "Sending files to ServiceM8 was switched off before it went.",
    doneStale: "It waited more than a day, so it didn't go.",
    noteThrew: "HeyTiff couldn't send the note. Trying again shortly.",
    noteThrewGaveUp: "HeyTiff couldn't send the note, after several tries.",
    noteTooSlow: "HeyTiff took too long to send the note, after several tries.",
  },
  line: {
    sending: "Sending to ServiceM8…",
    waitingWhy: "Not in ServiceM8 yet. {why}",
    sent: "In ServiceM8",
    notSent: "Not sent to ServiceM8. {reason}",
    unsure: "HeyTiff can't tell whether this reached ServiceM8. Look there before you send it again.",
    trial: "Trial run, not sent",
    takingOut: "Taking it out of ServiceM8…",
    stillIn: "Still in ServiceM8. {reason}",
    removedThere: "Removed in ServiceM8",
  },
  why: {
    paused: "Sending is paused.",
    reconnect: "ServiceM8 needs reconnecting.",
    off: "Sending notes is switched off.",
    trial: "Sending is a trial run.",
    retry: "Trying again shortly.",
    notSending: "Sending to ServiceM8 is off, or ServiceM8 isn't connected.",
    notTakenOut: "HeyTiff hasn't taken it out yet.",
  },
  flag: {
    flagged: "Flagged in ServiceM8",
    marking: "Marking done in ServiceM8…",
    waitingWhy: "Not marked done in ServiceM8 yet. {why}",
    done: "Done in ServiceM8",
    doneBy: "Done in ServiceM8, by {name}",
    notMarked: "Not marked done in ServiceM8. {reason}",
    unmarking: "Taking the done mark off in ServiceM8…",
    trial: "Trial run, not sent",
  },
  door: {
    reply: "Reply",
    sendReply: "Send reply",
    cancel: "Cancel",
    undo: "Undo",
    remove: "Remove",
    sendAgain: "Send again",
    tryAgain: "Try again",
    sendToSm8: "Send to ServiceM8",
    markDone: "Mark done",
    markDoneAgain: "Mark done again",
    yes: "Yes",
    notMe: "Not me",
    linkPeople: "Link people",
    alsoInSm8: "Also in ServiceM8",
    replyPlaceholder: "Write a reply, or say it…",
    peopleDenied: "Says this isn't them.",
  },
  bell: {
    doneNotSent: "Done didn't go to ServiceM8",
    doneStillIn: "Done not taken out of ServiceM8",
    doneUnsure: "Done may not have reached ServiceM8",
  },
} as const;

/** A sentence with its placeholders filled. A placeholder with no value is
    left as it is, so a missing name shows as a bug in review rather than as
    a sentence with a hole in it. */
export function fillWords(template: string, vars: Record<string, string | number | null | undefined>): string {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) => {
    const v = vars[key];
    return v === null || v === undefined || v === "" ? whole : String(v);
  });
}
