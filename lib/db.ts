import postgres from "postgres";

type Sql = ReturnType<typeof postgres>;
const g = globalThis as unknown as { __pitchdeskSql?: Sql };

function create(): Sql {
  return postgres(process.env.DATABASE_URL ?? "", {
    ssl: process.env.DATABASE_SSL === "false" ? false : "require",
    max: 5,
    idle_timeout: 20,
    connect_timeout: 15,
    prepare: false,
  });
}

// Lazily created so `next build` never needs a database.
export function db(): Sql {
  if (!g.__pitchdeskSql) g.__pitchdeskSql = create();
  return g.__pitchdeskSql;
}

// Pass objects/arrays to jsonb columns with this. Passing JSON.stringify(...) makes
// postgres.js encode it twice, so the column ends up holding a string instead of an array.
export function json(value: unknown) {
  return db().json(value as Parameters<Sql["json"]>[0]);
}

// Reads a jsonb value that may have been stored double-encoded by an earlier version.
export function fromJson<T>(value: unknown, fallback: T): T {
  if (typeof value === "string") {
    try {
      return fromJson(JSON.parse(value), fallback);
    } catch {
      return fallback;
    }
  }
  return (value ?? fallback) as T;
}

export type ShowStatus =
  | "new"
  | "no_email"
  | "drafted"
  | "approved"
  | "contacted"
  | "replied"
  | "booked"
  | "declined"
  | "no_response"
  | "bounced"
  | "skipped";

export const SHOW_STATUSES: ShowStatus[] = [
  "new",
  "no_email",
  "drafted",
  "approved",
  "contacted",
  "replied",
  "booked",
  "declined",
  "no_response",
  "bounced",
  "skipped",
];

export const STOPPED_STATUSES: ShowStatus[] = ["replied", "booked", "declined", "bounced", "skipped", "no_response"];

export interface Settings {
  guest_name: string;
  sender_name: string;
  offer: string;
  proof: string;
  ask: string;
  topics: string;
  voice: string;
  signature: string;
  subject_lines: string[];
  discovery_terms: string[];
  daily_cap: number;
  per_run_cap: number;
  send_start_hour: number;
  send_end_hour: number;
  timezone: string;
  followup1_days: number;
  followup2_days: number;
  auto_approve_followups: boolean;
  min_fit_score: number;
  sending_paused: boolean;
  slack_webhook_url: string;
  last_tick_at: Date | null;
  last_tick_log: string;
}

export interface Episode {
  title: string;
  description: string;
  date: string | null;
  link?: string | null;
}

export interface Show {
  id: number;
  podcast_index_id: string | null;
  title: string;
  author: string | null;
  feed_url: string | null;
  image_url: string | null;
  link: string | null;
  description: string | null;
  categories: string | null;
  host_email: string | null;
  email_status: string;
  last_episode_at: Date | null;
  episode_count: number | null;
  latest_episodes: Episode[];
  fit_score: number | null;
  fit_reason: string | null;
  status: ShowStatus;
  notes: string;
  created_at: Date;
  updated_at: Date;
}

export interface Pitch {
  id: number;
  show_id: number;
  step: number;
  subject: string;
  body: string;
  episode_ref: string | null;
  status: "draft" | "approved" | "sent" | "cancelled" | "failed";
  send_after: Date | null;
  sent_at: Date | null;
  gmail_message_id: string | null;
  gmail_thread_id: string | null;
  rfc_message_id: string | null;
  error: string | null;
  created_at: Date;
}

export interface Reply {
  id: number;
  show_id: number;
  gmail_message_id: string;
  thread_id: string;
  from_email: string | null;
  subject: string | null;
  body: string | null;
  received_at: Date | null;
  classification: string | null;
  suggested_reply: string | null;
  handled: boolean;
  created_at: Date;
}

export async function getSettings(): Promise<Settings> {
  const rows = await db()`select * from settings where id = 1`;
  if (!rows.length) throw new Error("Settings missing. Run `npm run db:setup` first.");
  const s = rows[0] as unknown as Settings;
  s.subject_lines = fromJson<string[]>(s.subject_lines, []);
  s.discovery_terms = fromJson<string[]>(s.discovery_terms, []);
  return s;
}

export async function logActivity(showId: number | null, kind: string, message: string) {
  await db()`insert into activity (show_id, kind, message) values (${showId}, ${kind}, ${message})`;
}

export async function setShowStatus(showId: number, status: ShowStatus) {
  await db()`update shows set status = ${status}, updated_at = now() where id = ${showId}`;
}
