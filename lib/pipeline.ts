import {
  db,
  getSettings,
  logActivity,
  setShowStatus,
  STOPPED_STATUSES,
  type Pitch,
  type Settings,
  type Show,
} from "./db";
import { classifyReply, draftFollowup, draftPitch, scoreFit } from "./ai";
import {
  categoryList,
  emailFromFeed,
  lastActivity,
  latestEpisodes,
  podcastById,
  searchPodcasts,
  stripHtml,
  verifyEmail,
} from "./podcasts";
import { emailOf, getThread, gmailAccount, header, plainBody, sendEmail, stripQuoted } from "./gmail";

// ---------- helpers ----------

async function getShow(id: number): Promise<Show> {
  const rows = await db()`select * from shows where id = ${id}`;
  if (!rows.length) throw new Error(`Show ${id} not found`);
  return rows[0] as unknown as Show;
}

async function isSuppressed(email: string) {
  const rows = await db()`select 1 from suppressions where email = ${email.toLowerCase()}`;
  return rows.length > 0;
}

function sendable(show: Show) {
  return !!show.host_email && show.email_status !== "invalid";
}

function firstName(full: string) {
  return full.trim().split(/\s+/)[0] ?? full;
}

export async function notifySlack(s: Settings, text: string) {
  if (!s.slack_webhook_url) return;
  try {
    await fetch(s.slack_webhook_url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
  } catch {
    // Slack is best-effort
  }
}

function zoned(tz: string, d = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "numeric",
    hourCycle: "h23",
    weekday: "short",
  }).formatToParts(d);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const weekday = parts.find((p) => p.type === "weekday")?.value ?? "Mon";
  return { hour, weekend: weekday === "Sat" || weekday === "Sun" };
}

export async function sentToday(tz: string): Promise<number> {
  const rows = await db()`
    select count(*)::int as n from pitches
    where sent_at is not null
      and (sent_at at time zone ${tz})::date = (now() at time zone ${tz})::date`;
  return rows[0].n as number;
}

// ---------- discovery ----------

export async function addShow(feedId: number | string, opts: { autoDraft: boolean }) {
  const existing = await db()`select id from shows where podcast_index_id = ${String(feedId)}`;
  if (existing.length) return { showId: existing[0].id as number, created: false };

  const feed = await podcastById(feedId);
  if (!feed) throw new Error("Podcast not found in Podcast Index.");
  const [episodes, email] = await Promise.all([latestEpisodes(feed.id, 5), emailFromFeed(feed.url)]);

  let emailStatus = "missing";
  if (email) emailStatus = (await isSuppressed(email)) ? "invalid" : await verifyEmail(email);
  const status = !email || emailStatus === "invalid" ? "no_email" : "new";

  const inserted = await db()`
    insert into shows (podcast_index_id, title, author, feed_url, image_url, link, description, categories,
      host_email, email_status, last_episode_at, episode_count, latest_episodes, status)
    values (${String(feed.id)}, ${feed.title}, ${feed.author || feed.ownerName || null}, ${feed.url},
      ${feed.artwork || feed.image || null}, ${feed.link || null}, ${stripHtml(feed.description ?? "").slice(0, 3000)},
      ${categoryList(feed)}, ${email}, ${emailStatus}, ${lastActivity(feed)}, ${feed.episodeCount ?? null},
      ${JSON.stringify(episodes)}::jsonb, ${status})
    on conflict (feed_url) do update set updated_at = now()
    returning id`;
  const showId = inserted[0].id as number;
  await logActivity(showId, "added", `Added ${feed.title}${email ? "" : " (no host email found)"}`);

  const s = await getSettings();
  let show = await getShow(showId);
  try {
    const fit = await scoreFit(s, show);
    await db()`update shows set fit_score = ${fit.score}, fit_reason = ${fit.reason}, updated_at = now() where id = ${showId}`;
    show = await getShow(showId);
    if (opts.autoDraft && fit.score >= s.min_fit_score && sendable(show)) {
      await draftForShow(showId);
    }
  } catch (err) {
    await logActivity(showId, "error", `Fit scoring failed: ${(err as Error).message}`);
  }
  return { showId, created: true };
}

export async function runDiscovery(maxNew = 8): Promise<string[]> {
  const s = await getSettings();
  const log: string[] = [];
  const known = new Set(
    (await db()`select podcast_index_id from shows where podcast_index_id is not null`).map((r) => String(r.podcast_index_id)),
  );
  const cutoff = Date.now() - 60 * 24 * 3600 * 1000;
  const picks: number[] = [];

  for (const term of s.discovery_terms) {
    if (picks.length >= maxNew) break;
    let feeds;
    try {
      feeds = await searchPodcasts(term, 40);
    } catch (err) {
      log.push(`Search "${term}" failed: ${(err as Error).message}`);
      continue;
    }
    for (const f of feeds) {
      if (picks.length >= maxNew) break;
      const id = String(f.id);
      if (known.has(id)) continue;
      const active = lastActivity(f);
      if (!active || active.getTime() < cutoff) continue;
      if ((f.episodeCount ?? 0) < 15) continue;
      if (f.language && !f.language.toLowerCase().startsWith("en")) continue;
      known.add(id);
      picks.push(f.id);
    }
  }

  for (const id of picks) {
    try {
      const r = await addShow(id, { autoDraft: true });
      const show = await getShow(r.showId);
      log.push(`${show.title}: fit ${show.fit_score ?? "?"}, ${show.status}`);
    } catch (err) {
      log.push(`Feed ${id} failed: ${(err as Error).message}`);
    }
  }
  if (!picks.length) log.push("No new active shows found for the saved search terms. Try new terms in Settings.");
  return log;
}

// ---------- drafting & approval ----------

export async function draftForShow(showId: number) {
  const s = await getSettings();
  const show = await getShow(showId);
  if (!sendable(show)) throw new Error("This show has no usable host email.");
  const draft = await draftPitch(s, show);
  const body = `${draft.body}\n\n${s.signature}`.trim();
  await db()`update pitches set status = 'cancelled' where show_id = ${showId} and step = 0 and status in ('draft','approved')`;
  await db()`
    insert into pitches (show_id, step, subject, body, episode_ref, status)
    values (${showId}, 0, ${draft.subject}, ${body}, ${draft.episode_ref}, 'draft')`;
  await setShowStatus(showId, "drafted");
  await logActivity(showId, "drafted", `Pitch drafted: "${draft.subject}"`);
}

export async function approvePitch(pitchId: number, subject: string, body: string) {
  const rows = await db()`
    update pitches set subject = ${subject}, body = ${body}, status = 'approved', send_after = now()
    where id = ${pitchId} and status = 'draft' returning show_id, step`;
  if (!rows.length) return;
  const showId = rows[0].show_id as number;
  if ((rows[0].step as number) === 0) await setShowStatus(showId, "approved");
  await logActivity(showId, "approved", rows[0].step === 0 ? "Pitch approved and queued" : `Follow-up ${rows[0].step} approved`);
}

export async function cancelPending(showId: number) {
  await db()`update pitches set status = 'cancelled' where show_id = ${showId} and status in ('draft','approved')`;
}

// ---------- sending ----------

export async function runSender(): Promise<string[]> {
  const log: string[] = [];
  const s = await getSettings();
  if (s.sending_paused) return ["Sending is paused."];
  const acct = await gmailAccount();
  if (!acct) return ["Gmail not connected."];

  const { hour, weekend } = zoned(s.timezone);
  if (weekend || hour < s.send_start_hour || hour >= s.send_end_hour) {
    return [`Outside send window (${s.send_start_hour}:00-${s.send_end_hour}:00 weekdays, ${s.timezone}).`];
  }
  const remaining = s.daily_cap - (await sentToday(s.timezone));
  const n = Math.max(0, Math.min(remaining, s.per_run_cap));
  if (n === 0) return ["Daily cap reached."];

  const due = await db()`
    select p.*, sh.host_email, sh.status as show_status, sh.title as show_title
    from pitches p join shows sh on sh.id = p.show_id
    where p.status = 'approved' and (p.send_after is null or p.send_after <= now())
    order by p.step desc, p.created_at
    limit ${n}`;

  for (const row of due) {
    const p = row as unknown as Pitch & { host_email: string | null; show_status: string; show_title: string };
    // Initial pitches go out from shows in "approved"; follow-ups only while the sequence is live.
    if ((STOPPED_STATUSES as string[]).includes(p.show_status)) {
      await db()`update pitches set status = 'cancelled' where id = ${p.id}`;
      continue;
    }
    if (!p.host_email || (await isSuppressed(p.host_email))) {
      await db()`update pitches set status = 'failed', error = 'No sendable email' where id = ${p.id}`;
      continue;
    }
    try {
      let threadId: string | null = null;
      let inReplyTo: string | null = null;
      let subject = p.subject;
      if (p.step > 0) {
        const sent = await db()`
          select subject, gmail_thread_id, rfc_message_id from pitches
          where show_id = ${p.show_id} and status = 'sent' order by step desc`;
        const first = sent[sent.length - 1];
        if (!first?.gmail_thread_id) throw new Error("Original pitch thread not found");
        threadId = first.gmail_thread_id as string;
        inReplyTo = (sent[0].rfc_message_id as string) ?? null;
        subject = `Re: ${first.subject as string}`;
      }
      const res = await sendEmail({
        to: p.host_email,
        fromName: s.sender_name || s.guest_name,
        subject,
        body: p.body,
        threadId,
        inReplyTo,
      });
      await db()`
        update pitches set status = 'sent', sent_at = now(), subject = ${subject}, gmail_message_id = ${res.id},
          gmail_thread_id = ${res.threadId}, rfc_message_id = ${res.rfcMessageId}, error = null
        where id = ${p.id}`;
      if (p.step === 0) await setShowStatus(p.show_id, "contacted");
      await logActivity(p.show_id, "sent", p.step === 0 ? `Pitch sent to ${p.host_email}` : `Follow-up ${p.step} sent`);
      log.push(`Sent ${p.step === 0 ? "pitch" : `follow-up ${p.step}`} to ${p.show_title}`);
    } catch (err) {
      const msg = (err as Error).message;
      await db()`update pitches set status = 'failed', error = ${msg} where id = ${p.id}`;
      await logActivity(p.show_id, "error", `Send failed: ${msg}`);
      log.push(`Failed ${p.show_title}: ${msg}`);
    }
  }
  if (!due.length) log.push("Nothing due to send.");
  return log;
}

// ---------- sequences ----------

export async function runSequences(maxDrafts = 5): Promise<string[]> {
  const log: string[] = [];
  const s = await getSettings();
  const shows = await db()`
    select sh.* from shows sh
    where sh.status = 'contacted'
      and not exists (select 1 from pitches p where p.show_id = sh.id and p.status in ('draft','approved'))`;
  let drafted = 0;
  for (const row of shows) {
    const show = row as unknown as Show;
    const sent = (await db()`
      select * from pitches where show_id = ${show.id} and status = 'sent' order by step`) as unknown as Pitch[];
    if (!sent.length) continue;
    const last = sent[sent.length - 1];
    const days = (Date.now() - new Date(last.sent_at ?? last.created_at).getTime()) / 86_400_000;
    const nextStep = last.step + 1;
    const wait = last.step === 0 ? s.followup1_days : s.followup2_days;
    if (days < wait) continue;

    if (nextStep > 2) {
      await setShowStatus(show.id, "no_response");
      await logActivity(show.id, "sequence", "Sequence finished with no reply");
      log.push(`${show.title}: no response, sequence closed`);
      continue;
    }
    if (drafted >= maxDrafts) break;
    try {
      const text = await draftFollowup(s, show, sent[0].body, nextStep);
      const body = `${text}\n\n${firstName(s.guest_name)}`;
      const status = s.auto_approve_followups ? "approved" : "draft";
      await db()`
        insert into pitches (show_id, step, subject, body, status, send_after)
        values (${show.id}, ${nextStep}, ${sent[0].subject}, ${body}, ${status}, ${status === "approved" ? new Date() : null})`;
      await logActivity(show.id, "drafted", `Follow-up ${nextStep} ${status === "approved" ? "queued" : "drafted for review"}`);
      log.push(`${show.title}: follow-up ${nextStep} ${status}`);
      drafted++;
    } catch (err) {
      log.push(`${show.title}: follow-up draft failed: ${(err as Error).message}`);
    }
  }
  return log;
}

// ---------- reply detection ----------

export async function runReplyCheck(maxThreads = 40): Promise<string[]> {
  const log: string[] = [];
  const acct = await gmailAccount();
  if (!acct) return ["Gmail not connected."];
  const me = acct.email.toLowerCase();
  const s = await getSettings();

  const threads = await db()`
    select distinct on (p.show_id) p.show_id, p.gmail_thread_id, p.body
    from pitches p join shows sh on sh.id = p.show_id
    where p.status = 'sent' and p.step = 0 and p.gmail_thread_id is not null and sh.status = 'contacted'
    order by p.show_id, p.sent_at
    limit ${maxThreads}`;

  for (const t of threads) {
    const showId = t.show_id as number;
    try {
      const thread = await getThread(t.gmail_thread_id as string);
      const ours = new Set(
        (await db()`select gmail_message_id from pitches where show_id = ${showId} and gmail_message_id is not null`).map(
          (r) => r.gmail_message_id as string,
        ),
      );
      const seen = new Set(
        (await db()`select gmail_message_id from replies where show_id = ${showId}`).map((r) => r.gmail_message_id as string),
      );
      for (const msg of thread.messages ?? []) {
        if (ours.has(msg.id) || seen.has(msg.id)) continue;
        const from = emailOf(header(msg, "From"));
        if (from === me) continue;
        const show = await getShow(showId);

        if (/mailer-daemon|postmaster/i.test(from)) {
          await setShowStatus(showId, "bounced");
          await cancelPending(showId);
          if (show.host_email) {
            await db()`insert into suppressions (email, reason) values (${show.host_email}, 'bounced') on conflict do nothing`;
          }
          await db()`
            insert into replies (show_id, gmail_message_id, thread_id, from_email, subject, body, received_at, classification, handled)
            values (${showId}, ${msg.id}, ${msg.threadId}, ${from}, ${header(msg, "Subject")}, ${msg.snippet ?? ""},
              ${new Date(Number(msg.internalDate ?? Date.now()))}, 'bounce', true)
            on conflict (gmail_message_id) do nothing`;
          await logActivity(showId, "bounced", `Bounced: ${show.host_email}`);
          log.push(`${show.title}: bounced`);
          break;
        }

        const text = stripQuoted(plainBody(msg)) || msg.snippet || "";
        const triage = await classifyReply(s, show, t.body as string, text);
        const isOoo = triage.classification === "out_of_office";
        await db()`
          insert into replies (show_id, gmail_message_id, thread_id, from_email, rfc_message_id, subject, body,
            received_at, classification, suggested_reply, handled)
          values (${showId}, ${msg.id}, ${msg.threadId}, ${from}, ${header(msg, "Message-ID") || null}, ${header(msg, "Subject")},
            ${text.slice(0, 10000)}, ${new Date(Number(msg.internalDate ?? Date.now()))}, ${triage.classification},
            ${triage.suggested_reply}, ${isOoo})
          on conflict (gmail_message_id) do nothing`;

        if (isOoo) {
          await logActivity(showId, "reply", "Out-of-office auto-reply (sequence continues)");
          continue;
        }
        await cancelPending(showId);
        await setShowStatus(showId, triage.classification === "negative" ? "declined" : "replied");
        await logActivity(showId, "reply", `Reply from ${from} (${triage.classification})`);
        await notifySlack(s, `:speech_balloon: ${show.title} replied to Kathy's pitch (${triage.classification}). Open PitchDesk inbox.`);
        log.push(`${show.title}: reply (${triage.classification})`);
        break;
      }
    } catch (err) {
      log.push(`Show ${showId}: reply check failed: ${(err as Error).message}`);
    }
  }
  return log;
}

// ---------- the scheduled tick ----------

export async function runTick(): Promise<string[]> {
  const out: string[] = [];
  for (const [name, fn] of [
    ["replies", () => runReplyCheck()],
    ["sequences", () => runSequences()],
    ["sender", () => runSender()],
  ] as const) {
    try {
      const r = await fn();
      out.push(...r.map((l) => `[${name}] ${l}`));
    } catch (err) {
      out.push(`[${name}] error: ${(err as Error).message}`);
    }
  }
  await db()`update settings set last_tick_at = now(), last_tick_log = ${out.join("\n").slice(0, 4000)} where id = 1`;
  return out;
}
