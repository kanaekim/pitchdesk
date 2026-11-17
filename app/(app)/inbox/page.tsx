import { db } from "@/lib/db";
import { markHandledAction, saveReplyToGmailAction, setStatusAction } from "../../actions";
import { SubmitButton } from "@/components/SubmitButton";
import { Badge, Empty, Flash, PageHeader, ShowLink, fmtRelative } from "@/components/ui";

export default async function InboxPage({ searchParams }: { searchParams: Promise<{ msg?: string }> }) {
  const { msg } = await searchParams;
  const open = await db()`
    select r.*, sh.title, sh.status as show_status from replies r join shows sh on sh.id = r.show_id
    where r.handled = false order by r.received_at desc`;
  const done = await db()`
    select r.id, r.show_id, r.from_email, r.classification, r.received_at, sh.title, sh.status as show_status
    from replies r join shows sh on sh.id = r.show_id
    where r.handled = true order by r.received_at desc limit 25`;

  return (
    <>
      <PageHeader
        title="Inbox"
        subtitle="Host replies, triaged. Edit the suggested answer and save it to Kathy's Gmail drafts, then send from Gmail."
      />
      <Flash msg={msg} />

      {open.length === 0 ? (
        <Empty>No replies waiting.</Empty>
      ) : (
        <ul className="space-y-5">
          {open.map((r) => (
            <li key={r.id as number} className="card p-5">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <ShowLink id={r.show_id as number} title={r.title as string} />
                  <span className="text-sm text-muted"> · {r.from_email as string}</span>
                </div>
                <div className="flex items-center gap-2 text-xs text-muted">
                  <Badge value={(r.classification as string) ?? "other"} />
                  {fmtRelative(r.received_at as Date)}
                </div>
              </div>
              <pre className="mb-4 rounded-lg bg-paper p-3 font-sans text-sm whitespace-pre-wrap">{r.body as string}</pre>

              <form action={saveReplyToGmailAction}>
                <input type="hidden" name="replyId" value={r.id as number} />
                <label className="label">Suggested reply</label>
                <textarea name="body" defaultValue={(r.suggested_reply as string) ?? ""} rows={6} className="input" />
                <div className="mt-3 flex flex-wrap gap-2">
                  <SubmitButton className="btn-primary" pendingText="Saving…">
                    Save to Gmail drafts
                  </SubmitButton>
                  <SubmitButton formAction={markHandledAction}>Mark handled</SubmitButton>
                </div>
              </form>
              <form action={setStatusAction} className="mt-2 flex gap-2">
                <input type="hidden" name="showId" value={r.show_id as number} />
                <input type="hidden" name="returnTo" value="/inbox" />
                <SubmitButton name="status" value="booked">
                  Mark booked
                </SubmitButton>
                <SubmitButton name="status" value="declined">
                  Mark declined
                </SubmitButton>
              </form>
            </li>
          ))}
        </ul>
      )}

      {done.length > 0 && (
        <section className="mt-10">
          <h2 className="mb-3 text-sm font-semibold">Handled</h2>
          <ul className="card divide-y divide-line">
            {done.map((r) => (
              <li key={r.id as number} className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
                <span>
                  <ShowLink id={r.show_id as number} title={r.title as string} />
                  <span className="text-muted"> · {r.from_email as string}</span>
                </span>
                <span className="flex items-center gap-2">
                  <Badge value={(r.classification as string) ?? "other"} />
                  <Badge value={r.show_status as string} />
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
