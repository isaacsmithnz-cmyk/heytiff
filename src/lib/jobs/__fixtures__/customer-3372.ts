import { templateMarked, type CustomerMessage } from "../customer-messages";

/* A JOB'S CUSTOMER CONVERSATION, SHAPED LIKE JOB 3372'S (read on 26 October
   2026: 17 messages, both ways, by email and by text), ANONYMISED: the
   customer is Marco, the team Dana and Sam, the business Acme Air. The
   five-job flag is set as the read sets it: the quote emails and the quote
   follow-up went out on hundreds of the business's jobs. */

let n = 0;
const msg = (over: Partial<CustomerMessage> & Pick<CustomerMessage, "kind" | "side" | "stamp" | "text">): CustomerMessage => ({
  id: `m${++n}`,
  name: over.side === "them" ? "Marco" : "Dana",
  subject: null,
  from: null,
  to: null,
  seenStamp: null,
  files: [],
  template: over.side === "us" && templateMarked(over.text),
  ...over,
});

const BOOKING = (when: string) =>
  `Hi Marco,\nAcme Air has availability to attend to your air conditioning service:\n${when} at 1 Example Street\nSydney NSW 2000\n\nPLEASE OPEN THE LINK BELOW TO REPLY:\n* 'YES' to confirm the booking.\n* 'NO' and provide dates that are best available to rebook.\n\nDana Lee`;
const ON_THE_WAY = (who: string, mins: number) =>
  `Hello Marco,\nThis is a courtesy message to let you know ${who} from Acme Air is on the way and will be arriving in approximately ${mins} minutes. Track my arrival at https://sm8.link/abc123`;

export const fixture3372 = (): CustomerMessage[] => {
  n = 0;
  return [
    msg({ kind: "email", side: "us", stamp: "2026-09-29 08:31:06", subject: "Request for Air Conditioning Quote – 1 Example Street", text: "Dear Marco,\n\nThank you for the opportunity to provide a quotation for your air conditioning requirements.", seenStamp: "2026-09-29 09:45:53", files: [{ id: "f-quote-1", name: "Acme Air Quote #3372", type: ".pdf" }], template: true }),
    msg({ kind: "email", side: "us", stamp: "2026-10-06 09:31:18", subject: "Your Quote from Acme Air (Ref #3372)", text: "Hi Marco!\n\nI hope you've been well.\n\nI just wanted to follow up on the quote we sent through last week.", seenStamp: "2026-10-06 09:56:11", template: true }),
    msg({ kind: "email", side: "them", stamp: "2026-10-06 10:03:39", subject: "Re: Your Quote from Acme Air (Ref #3372)", text: "Hi Dana,\n\nHope you had a good break.\n\nYou mentioned having one of your team visit today." }),
    msg({ kind: "sms", side: "us", stamp: "2026-10-06 10:56:15", text: BOOKING("2:00 PM on Tuesday 6th October 2026") }),
    msg({ kind: "email", side: "them", stamp: "2026-10-06 11:06:49", subject: "Re: Your Quote from Acme Air (Ref #3372)", text: "Thanks, Dana, just got the text re 2pm visit." }),
    msg({ kind: "sms", side: "them", stamp: "2026-10-06 11:40:19", text: "Yes" }),
    msg({ kind: "email", side: "us", stamp: "2026-10-06 11:51:06", subject: "Re: Your Quote from Acme Air (Ref #3372)", text: "Hello Marco,\n\nYes, I'll be attending at 2:00 PM today.", seenStamp: "2026-10-06 11:56:32" }),
    msg({ kind: "sms", side: "us", stamp: "2026-10-06 13:32:18", text: ON_THE_WAY("Dana", 32) }),
    msg({ kind: "sms", side: "us", stamp: "2026-10-07 08:34:27", text: BOOKING("7:30 AM on Friday 16th October 2026") }),
    msg({ kind: "sms", side: "them", stamp: "2026-10-07 08:55:46", text: "YES" }),
    msg({ kind: "email", side: "us", stamp: "2026-10-12 16:19:53", subject: "Request for Air Conditioning Quote – 1 Example Street", text: "Dear Marco,\n\nThank you for the opportunity to provide a quotation.", seenStamp: "2026-10-13 18:46:38", files: [{ id: "f-quote-2", name: "Acme Air Quote #3372", type: ".pdf" }], template: true }),
    msg({ kind: "sms", side: "us", stamp: "2026-10-14 08:54:07", text: BOOKING("2:00 PM on Wednesday 14th October 2026") }),
    msg({ kind: "sms", side: "them", stamp: "2026-10-14 08:58:27", text: "YES" }),
    msg({ kind: "sms", side: "us", stamp: "2026-10-16 07:26:56", name: "Sam", text: ON_THE_WAY("Sam", 23) }),
    msg({ kind: "email", side: "us", stamp: "2026-10-20 11:49:46", subject: "Invoice RE: 1 Example Street / Job # 3372", text: "Hi Marco,\n\nPlease find a copy of your Acme Air invoice regarding Job #3372 attached.\nView your invoice online here:\n\nhttps://sm8.link/fa2w", seenStamp: "2026-10-20 12:58:43", files: [{ id: "f-invoice", name: "Acme Air Invoice #3372", type: ".pdf" }] }),
    msg({ kind: "sms", side: "us", stamp: "2026-10-20 11:53:01", text: "Please find your Acme Air invoice attached for $13200.00\n\nhttps://sm8.link/fa2w" }),
    msg({ kind: "sms", side: "us", stamp: "2026-10-20 11:53:31", text: "Filters have been ordered just waiting their arrival. Thanks Dana" }),
  ];
};
