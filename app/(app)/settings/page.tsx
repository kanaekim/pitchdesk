import type { ReactNode } from "react";
import { getSettings } from "@/lib/db";
import { gmailAccount } from "@/lib/gmail";
import { disconnectGmailAction, saveSettingsAction } from "../../actions";
import { SubmitButton } from "@/components/SubmitButton";
import { Flash, PageHeader } from "@/components/ui";

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div>
      <label className="label">{label}</label>
      {children}
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  );
}

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ msg?: string; gmail?: string }> }) {
  const { msg, gmail: gmailMsg } = await searchParams;
  const s = await getSettings();
  const gmail = await gmailAccount();

  return (
    <>
      <PageHeader title="Settings" subtitle="Kathy's guest profile, sending rules and connections." />
      <Flash msg={msg ?? (gmailMsg === "connected" ? "Gmail connected." : gmailMsg ? `Gmail ${gmailMsg}` : undefined)} />

      <section className="card mb-6 p-5">
        <h2 className="mb-1 text-sm font-semibold">Gmail</h2>
        {gmail ? (
          <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
            <span>
              Sending as <strong>{gmail.email}</strong>
            </span>
            <form action={disconnectGmailAction}>
              <SubmitButton className="btn-danger">Disconnect</SubmitButton>
            </form>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
            <span className="text-muted">Connect the inbox pitches should come from. Kathy signs in with Google.</span>
            <a href="/api/gmail/connect" className="btn-primary">
              Connect Gmail
            </a>
          </div>
        )}
      </section>

      <form action={saveSettingsAction} className="space-y-6">
        <section className="card space-y-4 p-5">
          <h2 className="text-sm font-semibold">Guest profile</h2>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Guest name">
              <input name="guest_name" defaultValue={s.guest_name} className="input" />
            </Field>
            <Field label="Sender display name">
              <input name="sender_name" defaultValue={s.sender_name} className="input" />
            </Field>
          </div>
          <Field label="Who she is and who it's for">
            <textarea name="offer" defaultValue={s.offer} rows={6} className="input" />
          </Field>
          <Field label="Proof points" hint="The AI only uses facts from here. Keep the 25 vs 40 headcount consistent with theaiboss.ai.">
            <textarea name="proof" defaultValue={s.proof} rows={4} className="input" />
          </Field>
          <Field label="The ask">
            <textarea name="ask" defaultValue={s.ask} rows={3} className="input" />
          </Field>
          <Field label="Episode topics">
            <textarea name="topics" defaultValue={s.topics} rows={7} className="input" />
          </Field>
          <Field label="Voice">
            <textarea name="voice" defaultValue={s.voice} rows={3} className="input" />
          </Field>
          <Field label="Signature">
            <textarea name="signature" defaultValue={s.signature} rows={3} className="input" />
          </Field>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Subject lines" hint="One per line. {{podcast}} becomes the show name.">
              <textarea name="subject_lines" defaultValue={s.subject_lines.join("\n")} rows={6} className="input" />
            </Field>
            <Field label="Auto-discovery search terms" hint="One per line.">
              <textarea name="discovery_terms" defaultValue={s.discovery_terms.join("\n")} rows={6} className="input" />
            </Field>
          </div>
        </section>

        <section className="card space-y-4 p-5">
          <h2 className="text-sm font-semibold">Sending rules</h2>
          <div className="grid gap-4 md:grid-cols-4">
            <Field label="Daily cap" hint="20–40 protects her domain.">
              <input name="daily_cap" type="number" defaultValue={s.daily_cap} className="input" />
            </Field>
            <Field label="Per 15-min run">
              <input name="per_run_cap" type="number" defaultValue={s.per_run_cap} className="input" />
            </Field>
            <Field label="Start hour">
              <input name="send_start_hour" type="number" defaultValue={s.send_start_hour} className="input" />
            </Field>
            <Field label="End hour">
              <input name="send_end_hour" type="number" defaultValue={s.send_end_hour} className="input" />
            </Field>
            <Field label="Timezone">
              <input name="timezone" defaultValue={s.timezone} className="input" />
            </Field>
            <Field label="Follow-up 1 after (days)">
              <input name="followup1_days" type="number" defaultValue={s.followup1_days} className="input" />
            </Field>
            <Field label="Follow-up 2 after (days)">
              <input name="followup2_days" type="number" defaultValue={s.followup2_days} className="input" />
            </Field>
            <Field label="Min fit score to auto-draft">
              <input name="min_fit_score" type="number" defaultValue={s.min_fit_score} className="input" />
            </Field>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="auto_approve_followups" defaultChecked={s.auto_approve_followups} />
            Send follow-ups automatically (otherwise they wait in the approval queue)
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="sending_paused" defaultChecked={s.sending_paused} />
            Pause all sending
          </label>
          <Field label="Slack webhook URL (optional)" hint="Pings a channel when a host replies.">
            <input name="slack_webhook_url" defaultValue={s.slack_webhook_url} className="input" />
          </Field>
        </section>

        <SubmitButton className="btn-primary" pendingText="Saving…">
          Save settings
        </SubmitButton>
      </form>
    </>
  );
}
