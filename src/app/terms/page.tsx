import type { Metadata } from "next";
import Link from "next/link";
import { Mail, Part, PublicPage } from "@/components/public-page";

export const metadata: Metadata = { title: "Terms" };

/* The terms of using HeyTiff, in plain words, beside /privacy and /support
   and linked from the front page's foot (26 November 2026). Every line is
   something the app does today: new businesses join by invitation, an
   owner decides who joins, Tiff drafts and the business decides, an account
   is deleted in the app under More › Delete account, and nothing is charged
   yet. Change the page when one of those changes, and its date with it. */

export default function TermsPage() {
  return (
    <PublicPage heading="Terms" updated="26 November 2026">
      <p>
        These terms are between you and HeyTiff, which is run from New South Wales, Australia. By signing in to
        HeyTiff, on the web or in the app, you agree to them. If you use HeyTiff for a business, you agree for that
        business too.
      </p>

      <Part heading="Your account">
        <p>
          New businesses join HeyTiff by invitation for now. Keep your sign-in to yourself, and write to <Mail /> if
          you think someone else has used it. The person who sets up a business’s workspace is its owner, and decides
          who else joins and what each person can see.
        </p>
      </Part>

      <Part heading="Your business’s information">
        <p>
          What your business puts into HeyTiff stays your business’s. You let us store it and work with it only to run
          HeyTiff for you, as the{" "}
          <Link href="/privacy" className="font-semibold underline decoration-1 underline-offset-4">
            privacy page
          </Link>{" "}
          says. You’re responsible for having the right to put it there, your customers’ details included.
        </p>
      </Part>

      <Part heading="Tiff’s work">
        <p>
          Tiff drafts quotes, reads plans and documents, and answers from your business’s own records. She can be
          wrong. Check a price, a design, a measurement or a safety document before you send it or rely on it: what
          goes out under your business’s name is your business’s call.
        </p>
      </Part>

      <Part heading="Using it fairly">
        <ul className="flex list-disc flex-col gap-2 pl-5">
          <li>Don’t use HeyTiff to break the law, or to send anything you have no right to send.</li>
          <li>Don’t try to reach another business’s information, or to get around what your role allows.</li>
          <li>Don’t overload HeyTiff, copy it, or take it apart to build something like it.</li>
        </ul>
      </Part>

      <Part heading="Paying">
        <p>
          We don’t charge for HeyTiff yet. Before we do, we’ll tell your business’s owner the price and give them time
          to decide.
        </p>
      </Part>

      <Part heading="Connected services">
        <p>
          When your business connects ServiceM8 or Xero, their own terms apply to them, and we’re not responsible for
          what they do or don’t do.
        </p>
      </Part>

      <Part heading="If something goes wrong">
        <p>
          We work to keep HeyTiff running and your information safe, but we can’t promise it will never be down or
          never lose anything. As far as the law allows, we’re not liable for lost profits or indirect losses, and what
          we owe you is limited to what you paid us in the 12 months before. Nothing here takes away your rights under
          the Australian Consumer Law.
        </p>
      </Part>

      <Part heading="Ending">
        <p>
          You can stop at any time and delete your account in the app, under More › Delete account. We can suspend or
          close an account that breaks these terms, and we’ll tell you why. If we ever close HeyTiff, we’ll give owners
          30 days to take their business’s information out.
        </p>
      </Part>

      <Part heading="Changes">
        <p>When these terms change, their date changes. If a change matters, we’ll say so in the app before it applies.</p>
      </Part>

      <Part heading="The law">
        <p>These terms follow the law of New South Wales, Australia. Questions go to <Mail />.</p>
      </Part>
    </PublicPage>
  );
}
