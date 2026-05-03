import { db } from "@workspace/db";
import { activityLogTable, type ActivityType } from "@workspace/db";
import { logger } from "./logger";

type Diffable = Record<string, unknown> | null | undefined;

function diff(before: Diffable, after: Diffable): Record<string, { from: unknown; to: unknown }> {
  const out: Record<string, { from: unknown; to: unknown }> = {};
  const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  for (const k of keys) {
    const a = before?.[k];
    const b = after?.[k];
    const aJson = JSON.stringify(a ?? null);
    const bJson = JSON.stringify(b ?? null);
    if (aJson !== bJson) out[k] = { from: a ?? null, to: b ?? null };
  }
  return out;
}

export async function logAdminAction(opts: {
  type: ActivityType;
  actor?: string;
  bookingId?: number | null;
  attendeeId?: number | null;
  summary?: string;
  before?: Diffable;
  after?: Diffable;
  meta?: Record<string, unknown>;
}): Promise<void> {
  try {
    const data: Record<string, unknown> = {};
    if (opts.summary) data.summary = opts.summary;
    if (opts.before !== undefined || opts.after !== undefined) {
      const changes = diff(opts.before, opts.after);
      if (Object.keys(changes).length > 0) data.changes = changes;
      if (opts.before !== undefined) data.before = opts.before;
      if (opts.after !== undefined) data.after = opts.after;
    }
    if (opts.meta) Object.assign(data, opts.meta);

    await db.insert(activityLogTable).values({
      type: opts.type,
      actor: opts.actor || "admin",
      bookingId: opts.bookingId ?? null,
      attendeeId: opts.attendeeId ?? null,
      data: Object.keys(data).length > 0 ? data : null,
    });
  } catch (err) {
    // Audit logging must never break the underlying admin operation. Log loudly
    // so operators can investigate, but swallow the error.
    logger.error({ err, type: opts.type }, "Failed to write admin audit log entry");
  }
}
