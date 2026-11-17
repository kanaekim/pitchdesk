import Link from "next/link";
import { db, getSettings } from "@/lib/db";
import { gmailAccount } from "@/lib/gmail";
import { sentToday } from "@/lib/pipeline";
import { runNowAction, togglePauseAction } from "../actions";
import { SubmitButton } from "@/components/SubmitButton";
import { Badge, Flash, PageHeader, fmtRelative } from "@/components/ui";

export const maxDuration = 300;

const FUNNEL = ["drafted", "approved", "contacted", "replied", "booked", "declined", "no_response", "bounced"];

async function load() {
  const s = await getSettings();
  const gmail = await gmailAccount();
  const today = await sentToday(s.timezone);
  const byStatus = Object.fromEntries(
    (await db()`select status, count(*)::int as n from shows group by status`).map((r) => [r.status as string, r.n as number]),
  ) as Record<string, number>;
  const totals = (
    await db()`
      select
        (select count(distinct show_id)::int from pitches where status = 'sent' and step = 0) as contacted,
        (select count(distinct show_id)::int from replies where classification not in ('out_of_office','bounce')) as replied,
        (select count(*)::int from shows where status = 'booked') as booked,
        (select count(*)::int from pitches where status = 'sent' and sent_at > now() - interval '7 days') as sent7`
  )[0];
  const activity = await db()`
    select a.*, sh.title from activity a left join shows sh on sh.id = a.show_id
    order by a.created_at desc limit 15`;
  return { s, gmail, today, byStatus, totals, activity };
}

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ msg?: string }> }) {
  const { msg } = await searchParams;
  const data = await load().catch(() => null);
  if (!data) {
    return (
      <>
        <PageHeader title="Dashboard" />
        <p className="text-sm text-muted">Set up the database to see the dashboard.</p>
      </>
    );
  }
  const { s, gmail, today, byStatus, totals, activity } = data;

  const contacted = totals.contacted as number;
  const replyRate = contacted ? Math.round(((totals.replied as number) / contacted) * 100) : 0;
  const bookRate = contacted ? Math.round(((totals.booked as number) / contacted) * 100) : 0;

  const stats = [
    { label: "Shows pitched", value: contacted },
    { label: "Reply rate", value: `${replyRate}%`, sub: `${totals.replied} replies` },
    { label: "Booked", value: totals.booked as number, sub: `${bookRate}% of pitched` },
    { label: "Sent today", value: `${today} / ${s.daily_cap}`, sub: `${totals.sent7} this week` },
  ];

  return (
    <>
      <PageHeader title="Dashboard" subtitle={`Pitching ${s.guest_name} to CEO and board audiences`}>
        <form action={togglePauseAction}>
          <SubmitButton className={s.sending_paused ? "btn-primary" : "btn"}>
            {s.sending_paused ? "Resume sending" : "Pause sending"}
          </SubmitButton>
        </form>
        <form action={runNowAction}>
          <SubmitButton className="btn" pendingText="Running…">
            Run now
          </SubmitButton>
        </form>
      </PageHeader>
      <Flash msg={msg} />

      {!gmail && (
        <div className="mb-6 rounded-lg border border-accent/30 bg-accent-soft px-4 py-3 text-sm">
          Gmail isn&apos;t connected, so nothing can send yet.{" "}
          <Link href="/settings" className="font-medium underline">
            Connect Kathy&apos;s inbox
          </Link>
        </div>
      )}
      {s.sending_paused && (
        <div className="mb-6 rounded-lg border border-warn/30 bg-warn-soft px-4 py-3 text-sm text-warn">
          Sending is paused. Approved pitches wait until you resume.
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {stats.map((x) => (
          <div key={x.label} className="card p-4">
            <div className="text-xs uppercase tracking-wide text-muted">{x.label}</div>
            <div className="mt-1 font-serif text-3xl">{x.value}</div>
            {x.sub && <div className="text-xs text-muted">{x.sub}</div>}
          </div>
        ))}
      </div>

      <div className="mt-6 grid gap-6 md:grid-cols-5">
        <section className="card p-5 md:col-span-2">
          <h2 className="mb-3 text-sm font-semibold">Pipeline</h2>
          <ul className="space-y-2">
            {FUNNEL.map((st) => (
              <li key={st} className="flex items-center justify-between text-sm">
                <Link href={`/pipeline?status=${st}`} className="hover:underline">
                  <Badge value={st} />
                </Link>
                <span className="font-mono">{byStatus[st] ?? 0}</span>
              </li>
            ))}
          </ul>
          <div className="mt-4 border-t border-line pt-3 text-xs text-muted">
            {gmail ? `Sending as ${gmail.email}` : "Gmail not connected"}
            <br />
            Window {s.send_start_hour}:00–{s.send_end_hour}:00 weekdays · {s.timezone}
            <br />
            Last run {fmtRelative(s.last_tick_at)}
          </div>
        </section>

        <section className="card p-5 md:col-span-3">
          <h2 className="mb-3 text-sm font-semibold">Recent activity</h2>
          {activity.length === 0 ? (
            <p className="text-sm text-muted">
              Nothing yet. Start on the <Link href="/discover" className="underline">Discover</Link> page.
            </p>
          ) : (
            <ul className="divide-y divide-line">
              {activity.map((a) => (
                <li key={a.id as number} className="flex items-start justify-between gap-3 py-2 text-sm">
                  <span>
                    {a.show_id ? (
                      <Link href={`/shows/${a.show_id}`} className="font-medium hover:underline">
                        {a.title as string}
                      </Link>
                    ) : null}
                    {a.show_id ? " · " : ""}
                    <span className="text-ink/80">{a.message as string}</span>
                  </span>
                  <span className="shrink-0 text-xs text-muted">{fmtRelative(a.created_at as Date)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}
