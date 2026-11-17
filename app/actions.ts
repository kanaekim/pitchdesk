"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db, getSettings, json, logActivity, setShowStatus, SHOW_STATUSES, type ShowStatus } from "@/lib/db";
import { SESSION_COOKIE, sessionToken } from "@/lib/auth";
import { addShow, approvePitch, cancelPending, draftForShow, runDiscovery, runTick } from "@/lib/pipeline";
import { createDraftReply, disconnectGmail } from "@/lib/gmail";
import { getSearch, runSmartSearch } from "@/lib/smart";
import { enrichShow } from "@/lib/enrich";
import { verifyEmail } from "@/lib/podcasts";

function num(fd: FormData, key: string) {
  const v = Number(fd.get(key));
  if (!Number.isFinite(v)) throw new Error(`Bad ${key}`);
  return v;
}
function str(fd: FormData, key: string) {
  return String(fd.get(key) ?? "");
}
function back(path: string, msg: string): never {
  const sep = path.includes("?") ? "&" : "?";
  redirect(`${path}${sep}msg=${encodeURIComponent(msg)}`);
}

// ---------- auth ----------

export async function login(fd: FormData) {
  if (str(fd, "password") !== process.env.APP_PASSWORD) redirect("/login?error=1");
  (await cookies()).set(SESSION_COOKIE, await sessionToken(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  redirect("/");
}

export async function logout() {
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/login");
}

// ---------- discovery ----------

export async function addShowAction(fd: FormData) {
  const feedId = str(fd, "feedId");
  const returnTo = str(fd, "returnTo") || "/discover";
  const fitScore = fd.get("fitScore");
  const fit =
    fitScore !== null && fitScore !== "" && Number(fitScore) >= 0
      ? { score: Number(fitScore), reason: str(fd, "fitReason") }
      : undefined;
  let msg: string;
  try {
    const r = await addShow(feedId, { autoDraft: true, fit });
    msg = r.created ? "Show added. Strong fits get a draft pitch in the Approval queue." : "Already in your pipeline.";
  } catch (e) {
    msg = `Could not add: ${(e as Error).message}`;
  }
  revalidatePath("/", "layout");
  back(returnTo, msg);
}

export async function smartSearchAction(fd: FormData) {
  const brief = str(fd, "brief").trim();
  if (!brief) back("/discover", "Describe the shows you're looking for.");
  let id: number | null = null;
  let err = "";
  try {
    id = await runSmartSearch(brief);
  } catch (e) {
    err = (e as Error).message;
  }
  if (id === null) back("/discover", `Smart search failed: ${err}`);
  redirect(`/discover?sid=${id}`);
}

export async function addTopAction(fd: FormData) {
  const sid = num(fd, "sid");
  const min = num(fd, "min");
  const search = await getSearch(sid);
  if (!search) back("/discover", "Search not found.");
  const known = new Set(
    (await db()`select podcast_index_id from shows where podcast_index_id is not null`).map((r) => String(r.podcast_index_id)),
  );
  const picks = search.results
    .filter((r) => r.score >= min && r.hostEmail && !known.has(String(r.feedId)))
    .slice(0, 8);
  let added = 0;
  const errors: string[] = [];
  for (const r of picks) {
    try {
      const res = await addShow(r.feedId, { autoDraft: true, fit: { score: r.score, reason: r.reason } });
      if (res.created) added++;
    } catch (e) {
      errors.push(`${r.title}: ${(e as Error).message}`);
    }
  }
  revalidatePath("/", "layout");
  const msg = picks.length
    ? `Added ${added} show${added === 1 ? "" : "s"} and drafted pitches. Review them in the Approval queue.${errors.length ? ` ${errors.length} failed.` : ""}`
    : `No new shows scored ${min}+ with a host email.`;
  back(`/discover?sid=${sid}`, msg);
}

export async function runDiscoveryAction() {
  let log: string[];
  try {
    log = await runDiscovery(8);
  } catch (e) {
    log = [(e as Error).message];
  }
  revalidatePath("/", "layout");
  back("/discover", log.join(" · "));
}

// ---------- queue ----------

export async function approveAction(fd: FormData) {
  await approvePitch(num(fd, "pitchId"), str(fd, "subject").trim(), str(fd, "body").trim());
  revalidatePath("/", "layout");
  back(str(fd, "returnTo") || "/queue", "Approved. It will go out in the next send window.");
}

export async function saveDraftAction(fd: FormData) {
  await db()`update pitches set subject = ${str(fd, "subject").trim()}, body = ${str(fd, "body").trim()}
    where id = ${num(fd, "pitchId")} and status = 'draft'`;
  revalidatePath("/", "layout");
  back(str(fd, "returnTo") || "/queue", "Draft saved.");
}

export async function regenerateAction(fd: FormData) {
  const showId = num(fd, "showId");
  let msg = "New draft written.";
  try {
    await draftForShow(showId);
  } catch (e) {
    msg = `Could not draft: ${(e as Error).message}`;
  }
  revalidatePath("/", "layout");
  back(str(fd, "returnTo") || "/queue", msg);
}

export async function skipShowAction(fd: FormData) {
  const showId = num(fd, "showId");
  await cancelPending(showId);
  await setShowStatus(showId, "skipped");
  await logActivity(showId, "skipped", "Skipped");
  revalidatePath("/", "layout");
  back(str(fd, "returnTo") || "/queue", "Skipped.");
}

export async function unapproveAction(fd: FormData) {
  const pitchId = num(fd, "pitchId");
  const rows = await db()`update pitches set status = 'draft', send_after = null
    where id = ${pitchId} and status = 'approved' returning show_id, step`;
  if (rows.length && rows[0].step === 0) await setShowStatus(rows[0].show_id as number, "drafted");
  revalidatePath("/", "layout");
  back(str(fd, "returnTo") || "/queue", "Moved back to drafts.");
}

// ---------- show detail ----------

export async function setStatusAction(fd: FormData) {
  const showId = num(fd, "showId");
  const status = str(fd, "status") as ShowStatus;
  if (!SHOW_STATUSES.includes(status)) throw new Error("Bad status");
  if (["booked", "declined", "skipped"].includes(status)) await cancelPending(showId);
  await setShowStatus(showId, status);
  await logActivity(showId, "status", `Marked ${status}`);
  if (status === "booked") {
    await db()`update replies set handled = true where show_id = ${showId}`;
  }
  revalidatePath("/", "layout");
  back(str(fd, "returnTo") || `/shows/${showId}`, `Marked ${status.replace("_", " ")}.`);
}

export async function updateShowAction(fd: FormData) {
  const showId = num(fd, "showId");
  const email = str(fd, "host_email").trim().toLowerCase() || null;
  await db()`update shows set host_email = ${email}, notes = ${str(fd, "notes")},
    email_status = case when host_email is distinct from ${email} then 'unknown' else email_status end,
    status = case when status = 'no_email' and ${email}::text is not null then 'new' else status end,
    updated_at = now() where id = ${showId}`;
  revalidatePath("/", "layout");
  back(`/shows/${showId}`, "Saved.");
}

export async function enrichAction(fd: FormData) {
  const showId = num(fd, "showId");
  let msg: string;
  try {
    msg = (await enrichShow(showId, { useApollo: true })).join(" ");
  } catch (e) {
    msg = `Host lookup failed: ${(e as Error).message}`;
  }
  revalidatePath("/", "layout");
  back(`/shows/${showId}`, msg);
}

export async function setPitchEmailAction(fd: FormData) {
  const showId = num(fd, "showId");
  const email = str(fd, "email").trim().toLowerCase();
  const source = str(fd, "source");
  if (!email.includes("@")) back(`/shows/${showId}`, "That doesn't look like an email.");
  const status = await verifyEmail(email);
  await db()`update shows set host_email = ${email}, email_status = ${status},
    status = case when status = 'no_email' then 'new' else status end, updated_at = now()
    where id = ${showId}`;
  await logActivity(showId, "email", `Pitch email set to ${email} (from ${source}, check: ${status})`);
  revalidatePath("/", "layout");
  back(`/shows/${showId}`, `Pitches will go to ${email}. Draft a pitch when you're ready.`);
}

// ---------- inbox ----------

export async function saveReplyToGmailAction(fd: FormData) {
  const replyId = num(fd, "replyId");
  const body = str(fd, "body").trim();
  const rows = await db()`select r.*, sh.title from replies r join shows sh on sh.id = r.show_id where r.id = ${replyId}`;
  if (!rows.length) back("/inbox", "Reply not found.");
  const r = rows[0];
  const s = await getSettings();
  const subject = String(r.subject ?? "");
  try {
    await createDraftReply({
      to: r.from_email as string,
      fromName: s.sender_name || s.guest_name,
      subject: /^re:/i.test(subject) ? subject : `Re: ${subject}`,
      body: `${body}\n\n${s.guest_name.split(" ")[0]}`,
      threadId: r.thread_id as string,
      inReplyTo: (r.rfc_message_id as string) ?? null,
    });
    await db()`update replies set suggested_reply = ${body}, handled = true where id = ${replyId}`;
    await logActivity(r.show_id as number, "reply_draft", "Reply saved to Gmail drafts");
  } catch (e) {
    back("/inbox", `Could not save draft: ${(e as Error).message}`);
  }
  revalidatePath("/", "layout");
  back("/inbox", `Saved to Kathy's Gmail drafts in the ${r.title as string} thread. Review and send from Gmail.`);
}

export async function markHandledAction(fd: FormData) {
  await db()`update replies set handled = true where id = ${num(fd, "replyId")}`;
  revalidatePath("/", "layout");
  back("/inbox", "Marked handled.");
}

// ---------- settings ----------

export async function saveSettingsAction(fd: FormData) {
  const lines = (k: string) =>
    str(fd, k)
      .split("\n")
      .map((x) => x.trim())
      .filter(Boolean);
  const int = (k: string, min: number, max: number) => Math.max(min, Math.min(max, Math.round(num(fd, k))));
  await db()`
    update settings set
      guest_name = ${str(fd, "guest_name")}, sender_name = ${str(fd, "sender_name")},
      offer = ${str(fd, "offer")}, proof = ${str(fd, "proof")}, ask = ${str(fd, "ask")},
      topics = ${str(fd, "topics")}, voice = ${str(fd, "voice")}, signature = ${str(fd, "signature")},
      subject_lines = ${json(lines("subject_lines"))},
      discovery_terms = ${json(lines("discovery_terms"))},
      daily_cap = ${int("daily_cap", 1, 200)}, per_run_cap = ${int("per_run_cap", 1, 20)},
      send_start_hour = ${int("send_start_hour", 0, 23)}, send_end_hour = ${int("send_end_hour", 1, 24)},
      timezone = ${str(fd, "timezone") || "America/Toronto"},
      followup1_days = ${int("followup1_days", 1, 30)}, followup2_days = ${int("followup2_days", 1, 30)},
      auto_approve_followups = ${fd.get("auto_approve_followups") === "on"},
      min_fit_score = ${int("min_fit_score", 0, 100)},
      sending_paused = ${fd.get("sending_paused") === "on"},
      slack_webhook_url = ${str(fd, "slack_webhook_url").trim()},
      updated_at = now()
    where id = 1`;
  revalidatePath("/", "layout");
  back("/settings", "Settings saved.");
}

export async function disconnectGmailAction() {
  await disconnectGmail();
  await logActivity(null, "gmail", "Gmail disconnected");
  revalidatePath("/", "layout");
  back("/settings", "Gmail disconnected.");
}

export async function togglePauseAction() {
  await db()`update settings set sending_paused = not sending_paused where id = 1`;
  revalidatePath("/", "layout");
  back("/", "Sending toggled.");
}

export async function runNowAction() {
  let log: string[];
  try {
    log = await runTick();
  } catch (e) {
    log = [(e as Error).message];
  }
  revalidatePath("/", "layout");
  back("/", log.join(" · ").slice(0, 600));
}
