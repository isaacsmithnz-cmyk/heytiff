/* Every sentence an accepted quote sent to ServiceM8 says, by key — pure,
   and importing nothing (quotes to ServiceM8, Isaac, 2026-10-05).

   The job card's Quote section, the owner's ServiceM8 screen and the sender
   use these keys verbatim. sm8-quote-plan re-exports them as QUOTE_WORDS.
   Placeholders are {name} and {n}. */

export const QUOTE_WORDS = {
  /* The name the owner's list calls a row by: its payload is `{ name: <this> }`. */
  label: {
    fallback: "An accepted quote",
    job: "Accepted quote: the job's scope and status",
    add: "Accepted quote: line {name} added",
    off: "Accepted quote: line {name} taken off",
  },
  /* A row's reason, stored filled. */
  row: {
    gone: "ServiceM8 no longer has that job or line, so the change didn't go.",
    notQuote: "The job isn't a quote or a work order in ServiceM8 any more, so the quote didn't go.",
    refused: "ServiceM8 refused the change.",
    forbidden: "ServiceM8 didn't allow HeyTiff to change this job.",
    scopeHeld: "ServiceM8 hasn't given HeyTiff permission to change a job's lines. It goes once ServiceM8 is reconnected.",
    unsure: "ServiceM8 answered, then couldn't show the line. Check the job in ServiceM8.",
    stillThere: "The line is still on the job in ServiceM8. Remove it there.",
    threw: "Something went wrong sending the quote. Trying again shortly.",
    threwGaveUp: "Something went wrong sending the quote, after several tries.",
    tooSlow: "HeyTiff took too long to send the quote, after several tries.",
    switchedOff: "Sending accepted quotes to ServiceM8 was switched off before it went.",
  },
  /* Why a send couldn't go, said on the card. */
  press: {
    kindOff: "Sending accepted quotes to ServiceM8 is switched off. An owner can change that in Integrations, ServiceM8.",
    capped: "Sending to ServiceM8 is paused. An owner can change that in Integrations, ServiceM8.",
    unreadable: "HeyTiff couldn't read the ServiceM8 settings. Nothing was sent.",
    unqueued: "HeyTiff couldn't send that. Nothing went; try again.",
    changed: "The job has changed in ServiceM8 since you looked. Look at what goes again, then send.",
    quoteChanged: "The quote has changed since this was shown. Look at what goes again, then send.",
    scope: "ServiceM8 hasn't given HeyTiff permission to change a job's lines yet. An owner can change that in Integrations, ServiceM8.",
    noManage: "Only someone who runs the Workboard and sees money can send a quote to ServiceM8.",
  },
  /* The owner's ServiceM8 screen. */
  card: {
    quotes: "Accepted quotes",
    quotesGroup: "Sending accepted quotes to ServiceM8",
    quotesConsent:
      "ServiceM8 hasn't given HeyTiff permission to change a job's lines yet, so no quote can go. Reconnect ServiceM8 above and approve it on ServiceM8's screen.",
    quotesOffOne: "Accepted quotes are off. 1 change that was waiting won't go.",
    quotesOffMany: "Accepted quotes are off. {n} changes that were waiting won't go.",
    quotesUnavailable: "Accepted quotes can't be sent to ServiceM8 from this deployment yet.",
  },
  scope: {
    materials:
      "Lets HeyTiff add, change and remove the lines on a job. HeyTiff only touches a job you send an accepted quote for: it puts the quote's lines on (one per option at its total, or every line when your customers see line items) and takes off the lines that were there.",
  },
  kindWords: {
    quoteOne: "1 quote change",
    quoteMany: "{n} quote changes",
  },
} as const;
