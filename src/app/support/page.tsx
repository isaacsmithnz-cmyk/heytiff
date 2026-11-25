import type { Metadata } from "next";
import Link from "next/link";
import { Mail, Part, PublicPage } from "@/components/public-page";

export const metadata: Metadata = { title: "Support" };

/* The App Store's support link (25 November 2026): who to write to, and
   the three things people ask. */

export default function SupportPage() {
  return (
    <PublicPage heading="Support">
      <p>
        Write to <Mail /> with what you were doing and what happened, and we’ll get back to you within one
        business day. In the app, the bug button at the top of every screen sends us a picture of it.
      </p>

      <Part heading="Getting into HeyTiff">
        <p>
          HeyTiff is used by a business and its team. If you work for one, ask the person who runs it to invite you:
          you’ll get an email to set your password, then sign in on go.hey-tiff.com or in the app with the same
          email.
        </p>
      </Part>

      <Part heading="Can’t sign in">
        <p>
          On the sign-in page, press Forgot password and we’ll email you a link. Use the email address your
          business invited.
        </p>
      </Part>

      <Part heading="Deleting your account">
        <p>
          Write to <Mail /> from the email you sign in with, and we’ll delete your account within 30 days. The
          work records you made for a business, such as job notes and time, stay with that business.
        </p>
      </Part>

      <Part heading="Privacy">
        <p>
          What HeyTiff keeps and who else handles it is on the{" "}
          <Link href="/privacy" className="font-semibold underline decoration-1 underline-offset-4">
            privacy page
          </Link>
          .
        </p>
      </Part>
    </PublicPage>
  );
}
