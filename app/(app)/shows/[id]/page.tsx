import { notFound } from "next/navigation";
import { db, fromJson, type Episode, type Pitch, type Reply, type Show } from "@/lib/db";
import { enrichAction, regenerateAction, setStatusAction, updateShowAction, setPitchEmailAction } from "../../../actions";
import type { ContactEmail } from "@/lib/enrich";
import { HostProfile } from "@/components/HostProfile";
import { SubmitButton } from "@/components/SubmitButton";
import { Badge, Flash, FitScore, PageHeader, fmtDate, fmtRelative } from "@/components/ui";

export const maxDuration = 120;

export default async function ShowPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ msg?: string }>;
}) {
  const { id } = await params;
  const { msg } = await searchParams;
  const showId = Number(id);
  if (!Number.isInteger(showId)) notFound();
  const rows = await db()`select * from shows where id = ${showId}`;
  if (!rows.length) notFound();
  const show = rows[0] as unknown as Show;
  show.latest_episodes = fromJson<Episode[]>(show.latest_episodes, []);
  const pitches = (await db()`select * from pitches where show_id = ${showId} order by created_at`) as unknown as Pitch[];
  const replies = (await db()`select * from replies where show_id = ${showId} order by received_at`) as unknown as Reply[];
  const activity = await db()`select * from activity where show_id = ${showId} order by created_at desc limit 30`;
  const here = `/shows/${showId}`;
  const contacts = fromJson<ContactEmail[]>(show.contact_emails, []);
  const hasDraft = pitches.some((p) => p.status === "draft" || p.status === "approved");

  return (
    <>
      <PageHeader title={show.title} subtitle={show.author ?? undefined}>
        <Badge value={show.status} />
      </PageHeader>
      <Flash msg={msg} />

      <div className="grid gap-6 md:grid-cols-3">
        <div className="space-y-6 md:col-span-2">
          <HostProfile show={show} />

          <section className="card p-5">
            <div className="flex gap-4">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={show.image_url ?? ""} alt="" className="h-20 w-20 shrink-0 rounded-md bg-paper object-cover" />
              <div className="text-sm">
                <p className="text-ink/80">{(show.description ?? "").slice(0, 500)}</p>
                <p className="mt-2 text-xs text-muted">
                  {show.categories} · {show.episode_count ?? "?"} episodes · last {fmtDate(show.last_episode_at)}
                  {show.link && (
                    <>
                      {" · "}
                      <a href={show.link} target="_blank" rel="noreferrer" className="underline">
                        website
                      </a>
                    </>
                  )}
                </p>
              </div>
            </div>
            <div className="mt-4 border-t border-line pt-3 text-sm">
              Fit <FitScore score={show.fit_score} /> <span className="text-muted">· {show.fit_reason}</span>
            </div>
          </section>

          <section className="card p-5">
            <h2 className="mb-3 text-sm font-semibold">Conversation</h2>
            {pitches.length === 0 && replies.length === 0 && <p className="text-sm text-muted">No emails yet.</p>}
            <ol className="space-y-4">
              {[
                ...pitches.map((p) => ({ kind: "pitch" as const, at: p.sent_at ?? p.created_at, p })),
                ...replies.map((r) => ({ kind: "reply" as const, at: r.received_at ?? r.created_at, r })),
              ]
                .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime())
                .map((item) =>
                  item.kind === "pitch" ? (
                    <li key={`p${item.p.id}`} className="rounded-lg border border-line p-3">
                      <div className="mb-1 flex justify-between text-xs text-muted">
                        <span>
                          Kathy · {item.p.step === 0 ? "pitch" : `follow-up ${item.p.step}`} · <Badge value={item.p.status} />
                        </span>
                        <span>{fmtRelative(item.at)}</span>
                      </div>
                      <div className="text-sm font-medium">{item.p.subject}</div>
                      <pre className="mt-1 font-sans text-sm whitespace-pre-wrap text-ink/80">{item.p.body}</pre>
                      {item.p.error && <p className="mt-1 text-xs text-bad">{item.p.error}</p>}
                    </li>
                  ) : (
                    <li key={`r${item.r.id}`} className="rounded-lg border border-good/30 bg-good-soft/40 p-3">
                      <div className="mb-1 flex justify-between text-xs text-muted">
                        <span>
                          {item.r.from_email} · <Badge value={item.r.classification ?? "other"} />
                        </span>
                        <span>{fmtRelative(item.at)}</span>
                      </div>
                      <pre className="font-sans text-sm whitespace-pre-wrap">{item.r.body}</pre>
                    </li>
                  ),
                )}
            </ol>
          </section>
        </div>

        <div className="space-y-6">
          <section className="card p-5">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold">Contact routes</h2>
              <form action={enrichAction}>
                <input type="hidden" name="showId" value={show.id} />
                <SubmitButton className="text-xs text-muted hover:text-ink" pendingText="Looking up…">
                  {show.enriched_at ? "Re-run lookup" : "Find host"}
                </SubmitButton>
              </form>
            </div>
            {!show.enriched_at ? (
              <p className="text-sm text-muted">Not looked up yet. Click “Find host” to get the host profile, LinkedIn and emails.</p>
            ) : (
              <div className="space-y-2 text-sm">
                {show.host_linkedin && (
                  <div>
                    <a href={show.host_linkedin} target="_blank" rel="noreferrer" className="underline">
                      LinkedIn profile
                    </a>
                    <span className="text-xs text-muted"> · via {show.host_linkedin_source}</span>
                  </div>
                )}
                {show.guest_form_url && (
                  <div>
                    <a href={show.guest_form_url} target="_blank" rel="noreferrer" className="font-medium text-good underline">
                      Guest application form
                    </a>
                    <div className="text-xs text-muted">The show asks guests to apply here. Often better than a cold email.</div>
                  </div>
                )}
                {show.contact_page_url && (
                  <div>
                    <a href={show.contact_page_url} target="_blank" rel="noreferrer" className="underline">
                      Contact page
                    </a>
                  </div>
                )}
                <div>
                  <div className="label mt-3">Emails found</div>
                  {contacts.length === 0 ? (
                    <p className="text-xs text-muted">None.</p>
                  ) : (
                    <ul className="space-y-1.5">
                      {contacts.map((c) => (
                        <li key={c.email} className="flex items-center justify-between gap-2 text-xs">
                          <span className="min-w-0 break-all">
                            {c.email}
                            <span className="text-muted">
                              {" "}
                              · {c.source === "rss" ? "podcast feed" : c.source === "website" ? "show website" : "Apollo"}
                              {c.status ? ` · ${c.status}` : ""}
                            </span>
                          </span>
                          {c.email === show.host_email ? (
                            <span className="shrink-0 text-good">pitching</span>
                          ) : (
                            <form action={setPitchEmailAction} className="shrink-0">
                              <input type="hidden" name="showId" value={show.id} />
                              <input type="hidden" name="email" value={c.email} />
                              <input type="hidden" name="source" value={c.source} />
                              <SubmitButton className="text-muted underline hover:text-ink">Use</SubmitButton>
                            </form>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                  {contacts.some((c) => c.source === "apollo") && (
                    <p className="mt-2 text-xs text-muted">
                      The direct email comes from Apollo, not from the show. Pitches go to the published address unless you click
                      Use. The direct one is there as a backup or for a personal follow-up.
                    </p>
                  )}
                </div>
                {show.enrich_notes && <p className="text-xs text-muted">{show.enrich_notes}</p>}
              </div>
            )}
          </section>

          <section className="card p-5">
            <h2 className="mb-3 text-sm font-semibold">Actions</h2>
            <div className="flex flex-wrap gap-2">
              {!hasDraft && ["new", "drafted", "no_response", "skipped"].includes(show.status) && show.host_email && (
                <form action={regenerateAction}>
                  <input type="hidden" name="showId" value={show.id} />
                  <input type="hidden" name="returnTo" value="/queue" />
                  <SubmitButton className="btn-primary" pendingText="Drafting…">
                    Draft pitch
                  </SubmitButton>
                </form>
              )}
              {[
                ["booked", "Mark booked"],
                ["declined", "Mark declined"],
                ["skipped", "Skip"],
              ].map(([st, label]) => (
                <form key={st} action={setStatusAction}>
                  <input type="hidden" name="showId" value={show.id} />
                  <input type="hidden" name="status" value={st} />
                  <input type="hidden" name="returnTo" value={here} />
                  <SubmitButton className={st === "booked" ? "btn-primary" : "btn"}>{label}</SubmitButton>
                </form>
              ))}
            </div>
          </section>

          <section className="card p-5">
            <form action={updateShowAction} className="space-y-3">
              <input type="hidden" name="showId" value={show.id} />
              <div>
                <label className="label">Host email ({show.email_status})</label>
                <input name="host_email" defaultValue={show.host_email ?? ""} className="input" />
              </div>
              <div>
                <label className="label">Notes</label>
                <textarea name="notes" defaultValue={show.notes} rows={4} className="input" />
              </div>
              <SubmitButton>Save</SubmitButton>
            </form>
          </section>

          <section className="card p-5">
            <h2 className="mb-2 text-sm font-semibold">Recent episodes</h2>
            <ul className="space-y-2 text-sm">
              {(show.latest_episodes ?? []).map((e, i) => (
                <li key={i}>
                  <div className="font-medium leading-snug">{e.title}</div>
                  <div className="text-xs text-muted">{fmtDate(e.date)}</div>
                </li>
              ))}
            </ul>
          </section>

          <section className="card p-5">
            <h2 className="mb-2 text-sm font-semibold">History</h2>
            <ul className="space-y-1 text-xs">
              {activity.map((a) => (
                <li key={a.id as number} className="flex justify-between gap-2">
                  <span>{a.message as string}</span>
                  <span className="shrink-0 text-muted">{fmtRelative(a.created_at as Date)}</span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </>
  );
}
