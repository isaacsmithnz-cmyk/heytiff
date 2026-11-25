import type { Metadata } from "next";
import { Mail, Part, PublicPage } from "@/components/public-page";

export const metadata: Metadata = { title: "Privacy" };

/* What HeyTiff keeps and who else handles it, in plain words. Every line
   here is something the code does: the recording is never kept
   (api/mobile/transcribe), location is kept only while clocked on and only
   where the business has it on (lib/mobile/where), and the providers are
   the ones the server calls. Change the page when one of those changes. */

const PROVIDERS: [string, string, string][] = [
  ["Auth0", "signing in", "United States"],
  ["Supabase", "the database and files", "Singapore"],
  ["Vercel", "the website and its servers", "United States"],
  ["Anthropic", "Tiff's answers and her reading of documents", "United States"],
  ["Voyage AI", "searching your Library", "United States"],
  ["ElevenLabs", "turning speech into words", "United States"],
  ["Resend", "sending email", "United States"],
  ["Google Maps", "addresses, directions and travel times", "United States"],
  ["Expo", "app updates and notifications", "United States"],
];

export default function PrivacyPage() {
  return (
    <PublicPage heading="Privacy" updated="25 November 2026">
      <p>
        HeyTiff is software for trade businesses: jobs, schedules, quotes, time and documents, with Tiff, an assistant
        that reads them. This page says what HeyTiff keeps about you, why, and who else handles it. It covers the
        website at go.hey-tiff.com and the HeyTiff app for iPhone, iPad and Android. HeyTiff is run from
        New South Wales, Australia, and follows the Australian Privacy Principles.
      </p>

      <Part heading="What we keep">
        <ul className="flex list-disc flex-col gap-2 pl-5">
          <li>
            Your account: your name, your email address, and your phone number if you add it. Signing in is handled by
            Auth0, and HeyTiff never sees your password.
          </li>
          <li>
            Your business’s work: the jobs, customers, sites, contacts, notes, photos, documents, quotes, invoices,
            tasks and messages your business puts into HeyTiff, and what it brings across from ServiceM8 or Xero when
            it connects them.
          </li>
          <li>
            Your time and papers: when you clock on and off, your time on each job, leave, expenses, your vehicle, and
            the licences and other papers your business keeps for its team.
          </li>
          <li>
            Where you are, only while you’re clocked on, and only if your business has its team’s location
            turned on. It puts your time on each job as you arrive and leave, and it stops when you clock off. You can
            turn location off for HeyTiff in your phone’s settings.
          </li>
          <li>
            Your voice, only when you speak to Tiff or dictate a note. The recording is turned into words and is not
            kept.
          </li>
          <li>Photos and files you choose to add. The camera is used only when you take a photo.</li>
          <li>
            Your phone: a token so we can send you notifications, and the app’s version. When you report a bug
            from the app, it sends a picture of the screen you were on.
          </li>
        </ul>
      </Part>

      <Part heading="Why we keep it">
        <p>
          To run HeyTiff for your business: to show your team its jobs, schedule and records, to work out time and
          costs, to send the notifications and emails your business asks for, and to let Tiff answer questions and
          draft quotes from your business’s own records. We don’t sell your information, we don’t show
          ads, and we don’t use it for anything but running HeyTiff.
        </p>
      </Part>

      <Part heading="Who else handles it">
        <p>These companies run parts of HeyTiff for us, each only for its part:</p>
        <ul className="flex list-disc flex-col gap-2 pl-5">
          {PROVIDERS.map(([name, what, where]) => (
            <li key={name}>
              {name}, {what}. {where}.
            </li>
          ))}
          <li>ServiceM8 and Xero, only when your business connects them.</li>
        </ul>
        <p>
          So your information is stored and handled outside Australia, mainly in Singapore and the United States. We
          choose providers that protect it to a standard like the Australian Privacy Principles.
        </p>
      </Part>

      <Part heading="If you’re a customer of a business that uses HeyTiff">
        <p>
          That business decides what it keeps about you, and it’s the one to ask first. We hold your details for
          it and use them only to run HeyTiff for it.
        </p>
      </Part>

      <Part heading="How long we keep it">
        <p>
          While your business uses HeyTiff. If you leave a business, it keeps the work records you made for it, such
          as job notes and time. You can delete your account in the app, under More › Delete account, or ask us
          at <Mail /> and we’ll delete it within 30 days.
        </p>
      </Part>

      <Part heading="Seeing and correcting it">
        <p>
          Ask us at <Mail /> for what we hold about you, or to correct it, and we’ll answer within 30 days.
        </p>
      </Part>

      <Part heading="Keeping it safe">
        <p>
          Everything is sent encrypted, and inside HeyTiff each person sees only what their role in the business
          allows.
        </p>
      </Part>

      <Part heading="Children">
        <p>HeyTiff is a tool for work and isn’t meant for anyone under 16.</p>
      </Part>

      <Part heading="Changes">
        <p>
          When this page changes, its date changes. If a change matters to how your information is used, we’ll
          say so in the app.
        </p>
      </Part>

      <Part heading="Questions and complaints">
        <p>
          Write to <Mail />. If you’re not happy with our answer, you can complain to the Office of the Australian
          Information Commissioner at{" "}
          <a href="https://www.oaic.gov.au" className="font-semibold underline decoration-1 underline-offset-4">
            oaic.gov.au
          </a>
          .
        </p>
      </Part>
    </PublicPage>
  );
}
