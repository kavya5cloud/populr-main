import { db, ensureSchema, RUNTIME_DDL, type Sql } from "@/lib/db";
import { sendEmail, type EmailMessage } from "@/lib/services/email";
import { accessForUser, trialEndsAt } from "./gate";
import { FREE_AI_ACTIONS, PRICE } from "./plans";

// The two emails about a trial ending. Most people who stop using a trial don't decide to
// leave; they just never hear that it's ending. Each email goes to an account at most once.
//
// Only accounts whose trial ends around now are written to. Anyone whose trial ended long ago
// hears nothing from this, so switching it on never mails the whole user list.

const DAY = 86_400_000;
const WARN_DAYS = 3;
const ENDED_WITHIN_DAYS = 3;
const ACCOUNT = "https://www.trypopulr.in/account";

export type NoticeKind = "trial_ending" | "trial_ended";

/** Which email is due for a trial ending at this moment, if any. */
export function noticeDue(endsAt: number, now: number): NoticeKind | null {
  if (endsAt > now) return endsAt - now <= WARN_DAYS * DAY ? "trial_ending" : null;
  return now - endsAt <= ENDED_WITHIN_DAYS * DAY ? "trial_ended" : null;
}

export function noticeEmail(kind: NoticeKind, to: string, endsAt: number, now: number): EmailMessage {
  const pay = `Populr is $${PRICE.monthly} a month or $${PRICE.yearly} a year, and you can cancel anytime:\n${ACCOUNT}`;
  const free = `If you don't subscribe, nothing is deleted and any fixes already live on your site stay live. You move to the free plan: one site and ${FREE_AI_ACTIONS} AI actions a month, without publishing, images or new automatic fixes.`;
  if (kind === "trial_ending") {
    const days = Math.max(1, Math.ceil((endsAt - now) / DAY));
    return {
      to,
      subject: `Your Populr trial ends in ${days} day${days === 1 ? "" : "s"}`,
      text: `Your free trial of Populr ends in ${days} day${days === 1 ? "" : "s"}.\n\n${pay}\n\n${free}\n\nThe Populr team`,
    };
  }
  return {
    to,
    subject: "Your Populr trial has ended",
    text: `Your free trial of Populr has ended, so your account is now on the free plan.\n\nNothing was deleted, and any fixes already live on your site stay live. You keep one site and ${FREE_AI_ACTIONS} AI actions a month. Publishing, images and new automatic fixes need a subscription.\n\n${pay}\n\nThe Populr team`,
  };
}

async function ensureTable(sql: Sql) {
  if (!RUNTIME_DDL) return;
  await sql`
    CREATE TABLE IF NOT EXISTS billing_notices (
      user_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      sent_at BIGINT NOT NULL,
      PRIMARY KEY (user_id, kind)
    )`;
}

export type NoticeRun = { checked: number; sent: number; failed: number };

/**
 * One pass over accounts young enough to be near the end of a trial. The row is claimed before
 * sending, so two runs at once can't send twice, and released if sending fails, so a provider
 * outage is retried tomorrow rather than losing the email for good.
 */
export async function sendTrialNotices(now: number = Date.now()): Promise<NoticeRun> {
  const run: NoticeRun = { checked: 0, sent: 0, failed: 0 };
  const sql = db();
  if (!sql) return run;
  await ensureSchema(sql);
  await ensureTable(sql);

  const users = (await sql`
    SELECT id, email FROM users WHERE created_at > ${new Date(now - 120 * DAY).toISOString()}
    ORDER BY created_at LIMIT 500`) as { id: string; email: string }[];

  for (const u of users) {
    run.checked++;
    const endsAt = await trialEndsAt(u.id);
    if (endsAt == null) continue;
    const kind = noticeDue(endsAt, now);
    if (!kind) continue;
    // A subscriber's trial date still passes. They aren't on a trial any more.
    const access = await accessForUser(u.id, now);
    if (kind === "trial_ending" ? access.reason !== "trial" : access.reason !== "trial_ended") continue;

    const claimed = (await sql`
      INSERT INTO billing_notices (user_id, kind, sent_at) VALUES (${u.id}, ${kind}, ${now})
      ON CONFLICT (user_id, kind) DO NOTHING RETURNING user_id`) as unknown[];
    if (!claimed.length) continue;

    const res = await sendEmail(noticeEmail(kind, u.email, endsAt, now));
    if (res.sent) run.sent++;
    else {
      run.failed++;
      await sql`DELETE FROM billing_notices WHERE user_id = ${u.id} AND kind = ${kind}`;
    }
  }
  return run;
}
