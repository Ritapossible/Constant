/** Telegram links and STOP / START (D-082). */
import type { Q, Tx } from "./pool.js";

export const TELEGRAM_LINK_MINUTES = 15;

export async function createTelegramLink(q: Q, userId: string, code: string, now: Date): Promise<void> {
  await q.query("INSERT INTO telegram_links (code, user_id, created_at) VALUES ($1, $2, $3)", [code, userId, now]);
}

/**
 * Links the chat to the account behind an unused, recent code. A chat belongs to one account at a time: linking moves
 * it. Returns the user id, or null if the code is unknown, used or too old.
 */
export async function useTelegramLink(tx: Tx, code: string, chatId: string, now: Date): Promise<string | null> {
  const r = await tx.query<{ user_id: string }>(
    `UPDATE telegram_links SET used_at = $3 WHERE code = $1 AND used_at IS NULL
       AND created_at > $3::timestamptz - make_interval(mins => $2) RETURNING user_id`,
    [code, TELEGRAM_LINK_MINUTES, now],
  );
  const userId = r.rows[0]?.user_id;
  if (!userId) return null;
  await tx.query("UPDATE users SET telegram_chat_id = NULL WHERE telegram_chat_id = $1 AND id <> $2", [chatId, userId]);
  // Connecting Telegram makes it the first place messages go; the person can reorder in the app.
  await tx.query(
    `UPDATE users SET telegram_chat_id = $2, channels = array_prepend('telegram', array_remove(channels, 'telegram')), updated_at = now()
     WHERE id = $1 AND status <> 'closed'`,
    [userId, chatId],
  );
  return userId;
}

export async function userByTelegramChat(q: Q, chatId: string): Promise<{ id: string; status: string } | null> {
  return (await q.query<{ id: string; status: string }>("SELECT id, status FROM users WHERE telegram_chat_id = $1", [chatId])).rows[0] ?? null;
}

export async function unlinkTelegram(q: Q, userId: string): Promise<void> {
  await q.query("UPDATE users SET telegram_chat_id = NULL, channels = array_remove(channels, 'telegram'), updated_at = now() WHERE id = $1", [userId]);
}

/** STOP: every active bill is paused, marked as paused by STOP. Returns how many. */
export async function stopAllLines(tx: Tx, userId: string): Promise<number> {
  const r = await tx.query("UPDATE lines SET status = 'paused', paused_by = 'stop', updated_at = now() WHERE user_id = $1 AND status = 'active'", [userId]);
  return r.rowCount ?? 0;
}

/** The bills STOP paused, for START to resume. */
export async function linesPausedByStop(tx: Tx, userId: string): Promise<{ id: string; schedule: string; renew_day: number | null }[]> {
  return (
    await tx.query<{ id: string; schedule: string; renew_day: number | null }>(
      "SELECT id, schedule, renew_day FROM lines WHERE user_id = $1 AND status = 'paused' AND paused_by = 'stop' FOR UPDATE",
      [userId],
    )
  ).rows;
}
