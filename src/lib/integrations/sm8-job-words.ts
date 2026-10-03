/* Every sentence a new job sent to ServiceM8 says, by key — pure, and
   importing nothing (new jobs to ServiceM8).

   The New job form, the owner's ServiceM8 screen and the sender use these
   keys verbatim; none defines a sentence of its own. sm8-job-plan
   re-exports them as JOB_WORDS, and sm8-write-plan reads the few it needs
   (a job row's verdicts).

   SERVICEM8 MAY CHARGE FOR A JOB (its own reference, 2026-10-03: "creating
   jobs may incur account charges"), so the switch and the form say so
   where the decision is made.

   Placeholders are {name} and {n}; fillWords (sm8-note-words) puts them
   in. */

export const JOB_WORDS = {
  /* The name the owner's list calls a job row by: its payload is
     `{ name: <this> }`. */
  label: {
    fallback: "A new job",
    named: "New job for {name}",
  },
  /* A row's reason, stored filled. */
  row: {
    clientGone: "ServiceM8 no longer has that client, so the job didn't go.",
    parentGone: "ServiceM8 no longer has the client this site belongs to, so the job didn't go.",
    companyRemovedThere: "Someone removed the new client in ServiceM8 before the job went, so it didn't.",
    jobRemovedThere: "Someone removed the new job in ServiceM8, so HeyTiff won't send it again.",
    companyRefused: "ServiceM8 refused the new client.",
    jobRefused: "ServiceM8 refused the job.",
    contactRefused: "The job is in ServiceM8, but it refused the contact. Add them to the job there.",
    forbidden: "ServiceM8 didn't allow HeyTiff to add this job.",
    scopeHeld: "ServiceM8 hasn't given HeyTiff permission to add jobs. It goes once ServiceM8 is reconnected.",
    unsure: "ServiceM8 answered, then couldn't show the job. Check ServiceM8 before trying again.",
    partialClient: "{name} was added to ServiceM8 as a client, but the job wasn't. Try again, or add the job there.",
    threw: "Something went wrong sending the job. Trying again shortly.",
    threwGaveUp: "Something went wrong sending the job, after several tries.",
    tooSlow: "HeyTiff took too long to send the job, after several tries.",
    switchedOff: "Sending new jobs to ServiceM8 was switched off before it went.",
    takenBack: "Taken back before it went to ServiceM8.",
  },
  /* Why a job couldn't be queued, said on the form. */
  press: {
    kindOff: "Sending new jobs to ServiceM8 is switched off. An owner can change that in Integrations, ServiceM8.",
    scope: "ServiceM8 hasn't given HeyTiff permission to add jobs yet. An owner can change that in Integrations, ServiceM8.",
    capped: "Sending to ServiceM8 is paused. An owner can change that in Integrations, ServiceM8.",
    unreadable: "HeyTiff couldn't read the ServiceM8 settings. Nothing was sent.",
    unqueued: "HeyTiff couldn't queue the job. Nothing was sent; try again.",
    clientGone: "ServiceM8 no longer has that client. Choose them again.",
    parentGone: "ServiceM8 no longer has that builder. Choose them again.",
    noManage: "Only someone who runs the Workboard can start a job in ServiceM8.",
    alreadyGoing: "It's on its way to ServiceM8 already.",
    cantTakeBack: "It's in ServiceM8 already. Remove it there.",
  },
  /* The owner's ServiceM8 screen. */
  card: {
    jobs: "New jobs",
    jobsGroup: "Starting jobs in ServiceM8",
    jobsConsent:
      "ServiceM8 hasn't given HeyTiff permission to add jobs yet, so no new job can go. Reconnect ServiceM8 above and approve it on ServiceM8's screen.",
    jobsOffOne: "New jobs are off. 1 new job that was waiting won't go.",
    jobsOffMany: "New jobs are off. {n} new jobs that were waiting won't go.",
    jobsUnavailable: "New jobs can't be sent from this deployment yet.",
    charges: "ServiceM8 may charge for jobs, as it does for jobs started there.",
  },
  /* These extend the other kinds' kindWords. */
  kindWords: {
    jobOne: "1 new job",
    jobMany: "{n} new jobs",
  },
  /* What each new permission is asked for, on ServiceM8's consent screen. */
  scope: {
    createJobs:
      "Lets HeyTiff start new jobs in ServiceM8. HeyTiff starts a job, as a quote, only when someone presses Create on its New job form. ServiceM8 may charge for jobs, as it does for jobs started there.",
    customers:
      "Lets HeyTiff add, change and remove clients and their sites. HeyTiff adds a new client, or a new site under a builder, when someone starts a job for one on its New job form, and changes a client's name or address only when someone saves it on a job's card. It never removes one.",
    jobContacts:
      "Lets HeyTiff add, change and remove the contacts on a job. HeyTiff adds the contact someone gives on its New job form, and adds, changes or removes a job's contacts only when someone saves them on that job's card.",
  },
} as const;
