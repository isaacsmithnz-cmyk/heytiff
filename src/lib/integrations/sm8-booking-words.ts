/* Every sentence a booking to ServiceM8 says, by key — pure, and importing
   nothing (two-way phase 3, PR A).

   The job card, the Schedule, Home, the bell and the owner's screen use
   these keys verbatim; none defines a booking sentence of its own.
   sm8-booking-plan re-exports them as BOOKING_WORDS, and sm8-write-plan and
   providers read the few they need (a booking's verdicts, the two
   permissions' sentences). This module imports nothing so all of them can
   import it without a cycle between them.

   TWO SENTENCES ARE WRITE_WORDS' OWN, copied here because importing
   sm8-write-plan would make that cycle: press.capped is WRITE_WORDS.paused
   and press.unreadable is WRITE_WORDS.settingsUnread. A test holds them
   equal (sm8-booking-words.test). The other sentences a booking row may
   carry are reused where they live, never copied: NOTE_WORDS.row's
   takenBackBeforeSent and nothingToTakeBack, and the account-wide
   WRITE_WORDS (a reconnect, a bill, a limit, an unreachable ServiceM8).

   A ROW STORES THE FILLED SENTENCE, as a note's does (sm8-note-send), so a
   reason with a placeholder is recognised by sm8-booking-plan's reasonOf,
   never by comparing strings.

   Placeholders are {name}, {day}, {start}, {end}, {number}, {status}, {n},
   {list}, {place}, {why} and {reason}, and kindWords' {a}, {b} and {c};
   fillWords (sm8-note-words) puts them in. A day reads "Tue 6 Oct"
   (fmtAuWeekdayDayMonth); a time "9:00 am", and a range with one meridiem
   "9:00 to 11:00 am" (sm8-booking-plan's fmtRange). */

export const BOOKING_WORDS = {
  /* What each permission allows, and what HeyTiff does with it: the whole
     reach, as providers.ts's rule asks (F9, F10). */
  scope: {
    schedule:
      "Lets HeyTiff add, change and remove bookings, job allocations, booking windows and availability in ServiceM8. HeyTiff only adds the bookings people make here with Book in, and removes one only when whoever made it takes it back, or when someone clears a finished job's leftover booking. It never moves a booking, and never touches allocations, booking windows or availability.",
    jobs: "Lets HeyTiff change and remove jobs. HeyTiff changes one thing only: a Quote someone books in here becomes a Work Order, when they say so. It never removes a job.",
  },
  /* The Book in panel on the job card's Visits face (PR D). */
  panel: {
    title: "Book in job {number}",
    who: "Who",
    day: "Day",
    start: "Start",
    length: "How long",
    pickWho: "Pick who",
    you: "You",
    addAnother: "Add another",
    remove: "Remove",
    book: "Book in",
    bookMany: "Book {n} in",
    cancel: "Cancel",
    checking: "Checking ServiceM8…",
    readFailed: "HeyTiff couldn't check ServiceM8 just now, so it can't book. Try again in a moment.",
    zone: "Times are {place} time.",
    makeWorkOrder: "Make it a Work Order",
    quoteBecomes: "This Quote becomes a Work Order in ServiceM8.",
    quoteStays: "It stays a Quote in ServiceM8.",
    confirmOne: "Books {name} on {day}, {start} to {end}.",
    confirmMany: "Books {n}:",
    confirmRow: "{name}, {day}, {start} to {end}.",
    already: "Already booked: {list}.",
    dayOf: "{name} that day: {list}.",
    dayFree: "{name} has nothing else that day.",
    dayUnread: "HeyTiff couldn't check {name}'s day in ServiceM8.",
    /** One booking in dayOf's {list}: "job 3342, 8:00 to 11:00 am" (PR D). */
    dayJob: "job {number}, {start} to {end}",
    clash: "That overlaps job {number}, {start} to {end}.",
    /** The same, for a job the mirror can't number yet (PR D). */
    clashUnnumbered: "That overlaps another job, {start} to {end}.",
    trial: "Trial run. Nothing goes to ServiceM8. It's checked and listed on the ServiceM8 screen.",
    heldPaused: "Sending is paused, so this waits until it's back on.",
    heldReconnect: "ServiceM8 needs reconnecting, so this waits until it is.",
  },
  /* Said to whoever pressed; nothing is queued. */
  press: {
    unavailable: "Booking in ServiceM8 isn't available yet.",
    kindOff: "Sending bookings to ServiceM8 is switched off. An owner can change that in Integrations, ServiceM8.",
    scope: "ServiceM8 hasn't given HeyTiff permission to book yet. An owner can change that in Integrations, ServiceM8.",
    ownerOnly: "Only an owner can book from HeyTiff for now.",
    /** The Workboard's own words (workboard.ts's NO_MANAGE). */
    noManage: "You don't have access to manage the Workboard.",
    zoneUnknown:
      "HeyTiff doesn't know ServiceM8's time zone yet, so it can't book. An owner can sync ServiceM8 in Integrations, ServiceM8.",
    stale: "That was checked more than 10 minutes ago. Look again.",
    changed: "Changed in ServiceM8. Look again.",
    notBookable: "This job is {status} in ServiceM8, so it can't be booked.",
    jobGone: "That job isn't in ServiceM8 any more.",
    past: "That time has passed.",
    tooSoon: "That starts too soon to make the job a Work Order first. Pick a later time, or untick Make it a Work Order.",
    crossesMidnight: "A booking ends on the day it starts. Book the next day as its own.",
    /** A start or an end in the hour the account's clocks skip when they go
        forward (Sydney: 2026-10-04, 2:00 to 2:59 am): no instant reads it. */
    clocksForward: "The clocks go forward in {place} that day, so that time doesn't happen. Pick another time.",
    sameSlot: "{name} is already booked on this job at that time.",
    twice: "That's the same person at the same time twice.",
    tooMany: "Book up to 8 at a time.",
    techInactive: "{name} isn't active in ServiceM8.",
    onItsWay: "That booking is already on its way to ServiceM8.",
    takingOut: "That booking is still being taken out of ServiceM8. Try again in a moment.",
    notYours: "Only {name}, who booked it, can take it back here. It can be removed in ServiceM8.",
    changedNoUndo: "It was changed in ServiceM8 after it was booked, so HeyTiff won't take it out.",
    notFuture: "It has started, so HeyTiff won't take it out. It can be removed in ServiceM8.",
    keptOtherFirst:
      "That booking went into ServiceM8 at another time or on someone else. Take it back, or remove it in ServiceM8, first.",
    inFlight: "That's going to ServiceM8 right now. Try again in a moment.",
    notLeftover: "That isn't a leftover booking any more. Look again.",
    checkIn: "That's a check-in, and HeyTiff never removes one.",
    unqueued: "HeyTiff couldn't queue it. Try again.",
    /** WRITE_WORDS.paused */
    capped: "Sending to ServiceM8 is paused. An owner can change that in Integrations, ServiceM8.",
    /** WRITE_WORDS.settingsUnread */
    unreadable: "HeyTiff couldn't read the ServiceM8 settings. Nothing was sent or cancelled.",
  },
  /* A queue row's last_error: the reason a line reads. */
  row: {
    /* ServiceM8 refusing the write */
    scopeHeld: "ServiceM8 hasn't given HeyTiff permission to book. It goes once ServiceM8 is reconnected.",
    forbidden: "ServiceM8 didn't allow HeyTiff to do this.",
    refused: "ServiceM8 refused the booking.",
    statusRefused: "ServiceM8 refused the change to Work Order.",
    removeRefused: "ServiceM8 refused to remove the booking.",
    /* the job or the booking having moved */
    jobGone: "That job isn't in ServiceM8 any more.",
    jobNotBookable: "The job is {status} in ServiceM8 now. Look again.",
    changed: "Changed in ServiceM8. Look again.",
    slotTaken: "{name} is already booked on this job at that time in ServiceM8.",
    techInactive: "{name} isn't active in ServiceM8.",
    /* time and zone */
    past: "The time passed before it could go.",
    stale: "It waited more than a day, so it didn't go. Book it again if it's still right.",
    zoneUnknown: "HeyTiff doesn't know ServiceM8's time zone. Trying again shortly.",
    zoneChanged: "ServiceM8's time zone changed since this was booked. Book it again.",
    /* the status change */
    statusFirst: "The job wasn't made a Work Order, so this didn't go.",
    statusUnsure: "HeyTiff couldn't tell whether the job was made a Work Order, so this didn't go.",
    statusAlone: "Its bookings didn't go, so the job stays a Quote.",
    /* unsure or gone */
    bookingGone: "The booking isn't in ServiceM8 any more.",
    bookingUnsure: "HeyTiff couldn't tell whether the booking reached ServiceM8. Book it again if it isn't there.",
    /* the guards: each finishes its row sent, because it landed */
    timeNotKept: "ServiceM8 kept a different time for this booking. HeyTiff switched bookings off.",
    personNotKept: "ServiceM8 put this booking on someone else. HeyTiff switched bookings off.",
    fieldsNotKept: "ServiceM8 changed more than the status on this job. HeyTiff switched bookings off.",
    guardStopped: "HeyTiff switched bookings off after ServiceM8 kept something different on job {number}.",
    /** The marker on a sent row a read-back after a lost answer found
        changed: the line reads changedThere from it, before any sync. */
    movedThere: "It was changed in ServiceM8 after it was booked.",
    /* not kept, after the second read */
    statusNotKept: "ServiceM8 took the change but kept the job a Quote.",
    removeNotKept: "ServiceM8 took the removal but kept the booking.",
    /* a removal HeyTiff refused */
    changedNoTakeBack: "It was changed in ServiceM8 after it was booked, so HeyTiff didn't take it out.",
    checkIn: "Someone is checked in for it, so HeyTiff won't remove it.",
    notFuture: "It isn't a future booking any more.",
    notLeftover: "The job isn't finished in ServiceM8 any more. Look again.",
    /* the switch, and HeyTiff's own trouble */
    switchedOff: "Sending bookings to ServiceM8 was switched off before it went.",
    threw: "HeyTiff couldn't send the booking. Trying again shortly.",
    threwGaveUp: "HeyTiff couldn't send the booking, after several tries.",
    tooSlow: "HeyTiff took too long to send the booking, after several tries.",
  },
  line: {
    /* the booking */
    sending: "Booking in ServiceM8…",
    waitingWhy: "Not booked yet. {why}",
    sent: "Booked in ServiceM8",
    notSent: "Not booked. {reason}",
    keptOther: "Booked in ServiceM8 at another time. HeyTiff switched bookings off.",
    keptOtherPerson: "Booked in ServiceM8 on someone else. HeyTiff switched bookings off.",
    unsure: "HeyTiff can't tell whether this booking reached ServiceM8. Look there before you book it again.",
    trial: "Trial run, not booked",
    /* the status change */
    statusSending: "Making it a Work Order in ServiceM8…",
    statusSent: "Made a Work Order in ServiceM8",
    statusNotSent: "Not made a Work Order. {reason}",
    statusStays: "Still a Quote in ServiceM8.",
    statusUnsure: "It may have been made a Work Order in ServiceM8. Look there.",
    /* a take-back */
    takingOut: "Taking it out of ServiceM8…",
    stillIn: "Still in ServiceM8. {reason}",
    takenBack: "Taken back. The job stays a Work Order in ServiceM8.",
    /* changed there */
    removedThere: "Removed in ServiceM8",
    changedThere: "Changed in ServiceM8",
    /* a leftover: the Schedule's own words (focus.ts), as a sentence */
    leftover: "Marked complete in ServiceM8, still booked.",
    leftoverUnsuccessful: "Marked unsuccessful in ServiceM8, still booked.",
    /* a Clear */
    clearing: "Clearing it in ServiceM8…",
    clearWaiting: "Not cleared yet. {why}",
    notCleared: "Not cleared. {reason}",
    clearTrial: "Trial run, not cleared",
  },
  why: {
    paused: "Sending is paused.",
    reconnect: "ServiceM8 needs reconnecting.",
    off: "Sending bookings is switched off.",
    trial: "Sending is a trial run.",
    retry: "Trying again shortly.",
    waitingOnStatus: "It goes once the job is a Work Order.",
    notSending: "Sending to ServiceM8 is off, or ServiceM8 isn't connected.",
    notTakenOut: "HeyTiff hasn't taken it out yet.",
  },
  /* Each door is a word (law 25). tryAgain serves both try_again and
     take_out_again. */
  door: {
    undo: "Undo",
    cancel: "Cancel booking",
    tryAgain: "Try again",
    lookAgain: "Look again",
    bookAgain: "Book again",
    openInSm8: "Open in ServiceM8",
    /* a leftover */
    clearBooking: "Clear booking",
    keep: "Keep",
    /** Home's verb */
    clear: "Clear",
  },
  /* What fills a sentence's {name} or {status} when ServiceM8 names nobody,
     or no status: "The person booked isn't active in ServiceM8.", "The job
     is closed in ServiceM8 now." */
  fill: {
    person: "The person booked",
    status: "closed",
  },
  /* The name the owner's list and a cancel's note call a booking row by:
     its payload is `{ name: <this> }` and nothing else. */
  label: {
    create: "Booking",
    status: "Quote made a Work Order",
    undo: "Booking taken out of ServiceM8",
    clear: "Leftover booking cleared",
    fallback: "A booking",
  },
  /* The owner's ServiceM8 screen. */
  card: {
    bookings: "Bookings",
    bookingsGroup: "Sending bookings to ServiceM8",
    bookingsConsent:
      "ServiceM8 hasn't given HeyTiff permission to book yet, so no booking can go. Reconnect ServiceM8 above and approve it on ServiceM8's screen.",
    bookingsOffOne: "Bookings are off. 1 booking that was waiting won't go.",
    bookingsOffMany: "Bookings are off. {n} bookings that were waiting won't go.",
    bookingsUnavailable: "Bookings can't be sent from this deployment yet.",
    guardChip: "HeyTiff switched bookings off",
  },
  /* These extend NOTE_WORDS.kindWords. heldAny and offAll are said only
     where bookings are allowed; otherwise NOTE_WORDS' heldAll and allOff go
     byte for byte. */
  kindWords: {
    bookingOne: "1 booking",
    bookingMany: "{n} bookings",
    three: "{a}, {b} and {c}",
    heldAny: "ServiceM8 hasn't given HeyTiff every permission it needs. What's waiting goes once ServiceM8 is reconnected.",
    offAll: "Sending to ServiceM8 is switched off for every kind.",
  },
  home: {
    leftoverTitle: "Job {number} is finished but still booked",
    leftoverSub: "{name}, {day}, {start}.",
    leftoverSubMany: "{n} bookings left. The first is {name}, {day}, {start}.",
    clearConfirm: "Take {name}'s booking on {day}, {start} off job {number} in ServiceM8? The job is {status}. HeyTiff can't put it back.",
  },
  bell: {
    bookingNotSent: "Booking didn't go to ServiceM8",
    bookingStillIn: "Booking not taken out of ServiceM8",
    bookingUnsure: "Booking may not have reached ServiceM8",
    bookingKeptOther: "Booking went into ServiceM8 at another time or on someone else",
    leftoverNotCleared: "Leftover booking not cleared",
  },
} as const;
