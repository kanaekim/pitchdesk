import Link from "next/link";
import type { ReactNode } from "react";
import { db } from "@/lib/db";
import { logout } from "../actions";

export const dynamic = "force-dynamic";

async function counts() {
  try {
    const rows = await db()`
      select
        (select count(*)::int from pitches where status = 'draft') as queue,
        (select count(*)::int from replies where handled = false) as inbox`;
    return { queue: rows[0].queue as number, inbox: rows[0].inbox as number, ok: true };
  } catch {
    return { queue: 0, inbox: 0, ok: false };
  }
}

function NavItem({ href, label, count }: { href: string; label: string; count?: number }) {
  return (
    <Link
      href={href}
      className="flex items-center justify-between rounded-md px-3 py-2 text-sm text-ink/80 hover:bg-white hover:text-ink"
    >
      <span>{label}</span>
      {!!count && <span className="rounded-full bg-accent px-2 text-xs font-semibold text-white">{count}</span>}
    </Link>
  );
}

export default async function AppLayout({ children }: { children: ReactNode }) {
  const c = await counts();
  return (
    <div className="md:flex">
      <aside className="border-b border-line md:sticky md:top-0 md:h-screen md:w-56 md:shrink-0 md:border-r md:border-b-0">
        <div className="flex items-center justify-between px-5 py-5 md:block">
          <Link href="/" className="font-serif text-2xl">
            PitchDesk
          </Link>
          <p className="hidden text-xs text-muted md:block">The AI Boss · podcast outreach</p>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-3 pb-3 md:flex-col md:overflow-visible">
          <NavItem href="/" label="Dashboard" />
          <NavItem href="/discover" label="Discover" />
          <NavItem href="/queue" label="Approval queue" count={c.queue} />
          <NavItem href="/pipeline" label="Pipeline" />
          <NavItem href="/inbox" label="Inbox" count={c.inbox} />
          <NavItem href="/settings" label="Settings" />
        </nav>
        <form action={logout} className="hidden px-6 py-4 md:absolute md:bottom-0 md:block">
          <button className="text-xs text-muted hover:text-ink">Sign out</button>
        </form>
      </aside>
      <main className="mx-auto w-full max-w-5xl px-4 py-8 md:px-10">
        {!c.ok && (
          <div className="mb-6 rounded-lg border border-bad/30 bg-bad-soft px-4 py-3 text-sm text-bad">
            Can&apos;t reach the database. Check DATABASE_URL and run <code>npm run db:setup</code>.
          </div>
        )}
        {children}
      </main>
    </div>
  );
}
