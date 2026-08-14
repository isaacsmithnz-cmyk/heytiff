export default async function InviteErrorPage({
  searchParams,
}: {
  searchParams: Promise<{ msg?: string }>;
}) {
  const { msg } = await searchParams;

  return (
    <div className="flex flex-col items-center justify-center min-h-screen gap-4">
      <p className="text-sm text-red-500">{msg ?? "Something went wrong with this invite."}</p>
      {/* zinc-500: 400 is 2.62:1 on white, under AA at this size. Same fix as
          the sibling /no-org screen — both are screens an invitee can land on
          before they have ever seen the app. */}
      <a href="/dashboard" className="text-sm text-zinc-500 hover:text-zinc-700">
        Go to dashboard
      </a>
    </div>
  );
}
