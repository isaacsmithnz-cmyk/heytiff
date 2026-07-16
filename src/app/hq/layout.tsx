import { requireHqPage } from "@/lib/hq/guard";
import { HqNav } from "@/components/hq/hq-nav";
import "./hq.css";

/* HQ portal — the hidden platform-team surface. The layout is the primary
   access gate (it runs on every direct request to any /hq route): signed-out →
   login, non-allowlisted → 404. Each page re-guards too (belt-and-braces), and
   every /hq server action guards independently. */

export default async function HqLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { email } = await requireHqPage();

  return (
    <div className="hq">
      <header className="hq-top">
        <span className="hq-brand">
          <span className="hq-dot" />
          HeyTiff <b>HQ</b>
        </span>
        <HqNav />
        <div className="hq-who">
          <span>{email}</span>
          <a className="hq-exit" href="/dashboard">
            Exit ↗
          </a>
        </div>
      </header>
      {children}
    </div>
  );
}
