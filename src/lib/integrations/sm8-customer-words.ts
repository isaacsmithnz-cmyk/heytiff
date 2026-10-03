/* Every sentence a customer change sent to ServiceM8 says, by key — pure,
   and importing nothing (customer details to ServiceM8).

   The job card's customer dialog, the owner's ServiceM8 screen and the
   sender use these keys verbatim. sm8-customer-plan re-exports them as
   CUSTOMER_WORDS. Placeholders are {name} and {n}. */

export const CUSTOMER_WORDS = {
  /* The name the owner's list calls a row by: its payload is `{ name: <this> }`. */
  label: {
    fallback: "A customer change",
    contactAdd: "Contact {name} added",
    contactEdit: "Contact {name} changed",
    contactRemove: "Contact {name} removed",
    client: "{name}'s name or address changed",
    billing: "Billing address changed",
  },
  /* A row's reason, stored filled. */
  row: {
    gone: "ServiceM8 no longer has that record, so the change didn't go.",
    refused: "ServiceM8 refused the change.",
    forbidden: "ServiceM8 didn't allow HeyTiff to make this change.",
    scopeHeld: "ServiceM8 hasn't given HeyTiff permission to change customers. It goes once ServiceM8 is reconnected.",
    unsure: "ServiceM8 answered, then couldn't show the change. Check ServiceM8.",
    stillThere: "The contact is still on the job in ServiceM8. Remove them there.",
    threw: "Something went wrong sending the change. Trying again shortly.",
    threwGaveUp: "Something went wrong sending the change, after several tries.",
    tooSlow: "HeyTiff took too long to send the change, after several tries.",
    switchedOff: "Sending customer changes to ServiceM8 was switched off before it went.",
  },
  /* Why a save couldn't go, said in the dialog. */
  press: {
    kindOff: "Saving customer details to ServiceM8 is switched off. An owner can change that in Integrations, ServiceM8.",
    scope: "ServiceM8 hasn't given HeyTiff permission to change customers yet. An owner can change that in Integrations, ServiceM8.",
    capped: "Sending to ServiceM8 is paused. An owner can change that in Integrations, ServiceM8.",
    unreadable: "HeyTiff couldn't read the ServiceM8 settings. Nothing was saved.",
    unqueued: "HeyTiff couldn't save that. Nothing was sent; try again.",
    noManage: "Only someone who runs the Workboard can change a customer in ServiceM8.",
    nothing: "Nothing has changed.",
  },
  /* The owner's ServiceM8 screen. */
  card: {
    customers: "Customer details",
    customersGroup: "Saving customer details to ServiceM8",
    customersConsent:
      "ServiceM8 hasn't given HeyTiff permission to change customers yet, so no change can go. Reconnect ServiceM8 above and approve it on ServiceM8's screen.",
    customersOffOne: "Customer details are off. 1 change that was waiting won't go.",
    customersOffMany: "Customer details are off. {n} changes that were waiting won't go.",
    customersUnavailable: "Customer details can't be saved to ServiceM8 from this deployment yet.",
  },
  kindWords: {
    customerOne: "1 customer change",
    customerMany: "{n} customer changes",
  },
} as const;
