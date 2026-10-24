import { HomeFeed } from "@/components/dashboard/home-feed";
import { homeView } from "@/lib/dashboard/home-view";
import { loadDashboard } from "@/lib/dashboard/page-data";

/* YOUR FEED, ALL OF IT — Home's Show all (Isaac, 24 October 2026: "an
   option to open up your feed to view everything on a separate page"). The
   same items as Home's Your feed (lib/dashboard/home-view), none held back,
   as /dashboard/todo is To do's. */
export default async function FeedPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const [data, { reply }] = await Promise.all([loadDashboard(), searchParams]);
  const view = homeView(data);
  return (
    <div className="page in full">
      <div className="wrap hm">
        <HomeFeed
          items={view.feed}
          replyTo={typeof reply === "string" && /^[0-9a-f-]{36}$/i.test(reply) ? reply : null}
          all
          headingLevel={1}
        />
      </div>
    </div>
  );
}
