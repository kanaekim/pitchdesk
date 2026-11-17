import { db, type Episode } from "@/lib/db";
import { approveAction, regenerateAction, saveDraftAction, skipShowAction, unapproveAction } from "../../actions";
import { SubmitButton } from "@/components/SubmitButton";
import { Empty, Flash, FitScore, PageHeader, ShowLink, fmtDate } from "@/components/ui";

export const maxDuration = 120;

export default async function QueuePage({ searchParams }: { searchParams: Promise<{ msg?: string }> }) {
  const { msg } = await searchParams;
  const drafts = await db()`
    select p.*, sh.title, sh.author, sh.host_email, sh.email_status, sh.fit_score, sh.fit_reason, sh.latest_episodes, sh.image_url
    from pitches p join shows sh on sh.id = p.show_id
    where p.status = 'draft'
    order by p.step desc, sh.fit_score desc nulls last, p.created_at`;
  const approved = await db()`
    select p.id, p.step, p.subject, p.created_at, sh.id as show_id, sh.title
    from pitches p join shows sh on sh.id = p.show_id
    where p.status = 'approved' order by p.step desc, p.created_at`;

  return (
    <>
      <PageHeader
        title="Approval queue"
        subtitle="Nothing sends until it's approved here. Edit freely; the signature is already included."
      />
      <Flash msg={msg} />

      {drafts.length === 0 ? (
        <Empty>No drafts waiting. Add shows on Discover, or run auto-discovery.</Empty>
      ) : (
        <ul className="space-y-5">
          {drafts.map((d) => {
            const eps = (d.latest_episodes as Episode[]) ?? [];
            return (
              <li key={d.id as number} className="card p-5">
                <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                  <div className="flex gap-3">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={(d.image_url as string) || ""} alt="" className="h-12 w-12 rounded-md bg-paper object-cover" />
                    <div>
                      <ShowLink id={d.show_id as number} title={d.title as string} />
                      <div className="text-xs text-muted">
                        {(d.step as number) > 0 ? `Follow-up ${d.step} · ` : ""}
                        To {d.host_email as string} ({d.email_status as string})
                      </div>
                    </div>
                  </div>
                  <div className="text-right text-xs text-muted">
                    Fit <FitScore score={d.fit_score as number | null} />
                    <div className="max-w-xs">{d.fit_reason as string}</div>
                  </div>
                </div>

                <div className="grid gap-5 md:grid-cols-3">
                  <form className="md:col-span-2" action={approveAction}>
                    <input type="hidden" name="pitchId" value={d.id as number} />
                    <input type="hidden" name="showId" value={d.show_id as number} />
                    <label className="label">Subject</label>
                    <input name="subject" defaultValue={d.subject as string} className="input mb-3" disabled={(d.step as number) > 0} />
                    {(d.step as number) > 0 && <input type="hidden" name="subject" value={d.subject as string} />}
                    <label className="label">Body</label>
                    <textarea name="body" defaultValue={d.body as string} rows={12} className="input font-[inherit] leading-relaxed" />
                    <div className="mt-3 flex flex-wrap gap-2">
                      <SubmitButton className="btn-primary" pendingText="Approving…">
                        Approve & queue
                      </SubmitButton>
                      <SubmitButton formAction={saveDraftAction}>Save edits</SubmitButton>
                      {(d.step as number) === 0 && (
                        <SubmitButton formAction={regenerateAction} pendingText="Rewriting…">
                          Rewrite
                        </SubmitButton>
                      )}
                      <SubmitButton className="btn-danger" formAction={skipShowAction}>
                        Skip show
                      </SubmitButton>
                    </div>
                    {d.episode_ref ? (
                      <p className="mt-2 text-xs text-muted">References episode: “{d.episode_ref as string}”. Check it fits.</p>
                    ) : null}
                  </form>

                  <div className="text-sm">
                    <div className="label">Recent episodes</div>
                    {eps.length === 0 ? (
                      <p className="text-xs text-muted">None found.</p>
                    ) : (
                      <ul className="space-y-2">
                        {eps.slice(0, 4).map((e, i) => (
                          <li key={i}>
                            <div className="font-medium leading-snug">{e.title}</div>
                            <div className="text-xs text-muted">{fmtDate(e.date)}</div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {approved.length > 0 && (
        <section className="mt-10">
          <h2 className="mb-3 text-sm font-semibold">Approved, waiting to send ({approved.length})</h2>
          <ul className="card divide-y divide-line">
            {approved.map((a) => (
              <li key={a.id as number} className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
                <span>
                  <ShowLink id={a.show_id as number} title={a.title as string} />
                  <span className="text-muted"> · {(a.step as number) === 0 ? a.subject : `follow-up ${a.step}`}</span>
                </span>
                <form action={unapproveAction}>
                  <input type="hidden" name="pitchId" value={a.id as number} />
                  <SubmitButton className="text-xs text-muted hover:text-ink">Unapprove</SubmitButton>
                </form>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
