/* Every sentence leave on the ServiceM8 board says, by key — pure, and
   importing nothing (leave to ServiceM8).

   The leave screens, the owner's ServiceM8 screen and the sender use these
   keys verbatim; none defines a leave sentence of its own. sm8-leave-plan
   re-exports them as LEAVE_WORDS, and sm8-write-plan reads the few it needs
   (a leave row's verdicts). This module imports nothing so all of them can
   import it without a cycle between them.

   THE BOARD'S TWO NAMES ARE ISAAC'S (2026-09-28): sick and personal leave
   reads "Sick leave" on the ServiceM8 board, and everything else — annual,
   unpaid, and a casual's day they can't work — reads "Leave". ServiceM8 has
   one kind of staff leave (`staff-annual-leave`, read off the live account
   on 2026-09-28), so the name is the only thing that tells them apart
   there.

   Placeholders are {name} and {n}; fillWords (sm8-note-words) puts them
   in. */

export const LEAVE_WORDS = {
  /* The name an availability goes to ServiceM8 under: what the dispatch
     board shows on the person's day. */
  board: {
    sick: "Sick leave",
    leave: "Leave",
  },
  /* The name the owner's list and a cancel's note call a leave row by: its
     payload is `{ name: <this> }`, and the create's is the board's name. */
  label: {
    remove: "Leave taken off the ServiceM8 board",
    fallback: "Leave",
  },
  /* A row's reason, stored filled (as a booking's is). */
  row: {
    notApproved: "The leave isn't approved any more, so it didn't go to ServiceM8.",
    dayOffGone: "The day off was taken down before it went to ServiceM8.",
    personInactive: "ServiceM8 has {name} as inactive, so the leave didn't go.",
    personGone: "ServiceM8 no longer has that person, so the leave didn't go.",
    removedThere: "Someone took the leave off the ServiceM8 board.",
    refused: "ServiceM8 refused the leave.",
    removeRefused: "ServiceM8 refused to take the leave off its board.",
    forbidden: "ServiceM8 didn't allow HeyTiff to add this leave.",
    scopeHeld: "ServiceM8 hasn't given HeyTiff permission to add leave. It goes once ServiceM8 is reconnected.",
    stillThere: "The leave is still on the ServiceM8 board. Take it off there.",
    nothingThere: "It never reached ServiceM8, so there was nothing to take off.",
    unsure: "ServiceM8 answered, then couldn't show the leave. Check the ServiceM8 board.",
    threw: "Something went wrong sending the leave. Trying again shortly.",
    threwGaveUp: "Something went wrong sending the leave, after several tries.",
    tooSlow: "HeyTiff took too long to send the leave, after several tries.",
    switchedOff: "Sending leave to ServiceM8 was switched off before it went.",
  },
  /* Why leave couldn't be queued, said beside the decision that asked. */
  press: {
    kindOff: "Sending leave to ServiceM8 is switched off. An owner can change that in Integrations, ServiceM8.",
    scope: "ServiceM8 hasn't given HeyTiff permission to add leave yet. An owner can change that in Integrations, ServiceM8.",
    unlinked: "{name} isn't linked to anyone in ServiceM8, so the leave stays off its board. An owner can link them in Integrations, ServiceM8.",
    denied: "{name} said the ServiceM8 person they're linked to isn't them, so the leave stays off its board.",
    inactive: "ServiceM8 has {name} as inactive, so the leave stays off its board.",
    capped: "Sending to ServiceM8 is paused. An owner can change that in Integrations, ServiceM8.",
    unreadable: "HeyTiff couldn't read the ServiceM8 settings. Nothing was sent or cancelled.",
  },
  /* The owner's ServiceM8 screen. */
  card: {
    leave: "Leave",
    leaveGroup: "Sending leave to ServiceM8",
    leaveConsent:
      "ServiceM8 hasn't given HeyTiff permission to add leave yet, so no leave can go. Reconnect ServiceM8 above and approve it on ServiceM8's screen.",
    leaveOffOne: "Leave is off. 1 leave entry that was waiting won't go.",
    leaveOffMany: "Leave is off. {n} leave entries that were waiting won't go.",
    leaveUnavailable: "Leave can't be sent from this deployment yet.",
  },
  /* These extend NOTE_WORDS.kindWords and BOOKING_WORDS.kindWords. */
  kindWords: {
    leaveOne: "1 leave entry",
    leaveMany: "{n} leave entries",
  },
} as const;
