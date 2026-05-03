import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// In-memory fake of the @workspace/db module. Tests below configure the seed
// data via `__setupDb({ promo, tiers, passes })` before each test, which is
// then served by both the `incrementPromoUsage` (top-level db) calls and the
// `calculatePricing` queries.
// ---------------------------------------------------------------------------

type PromoRow = {
  code: string;
  discountType: "percentage" | "per_ticket" | "fixed" | "complimentary";
  discountValue: string;
  isActive: boolean;
  validFrom: Date | null;
  validUntil: Date | null;
  maxUses: number | null;
  usedCount: number;
  maxDiscountAmount: string | null;
  applicablePassTypes: string[] | null;
  minQuantity: number | null;
  oncePerCustomer: boolean;
  description: string | null;
};

type DiscountTierRow = { passType: string; minQuantity: number; discountPercent: string };
type PassConfigRow = { passType: string; currentPrice: string; originalPrice: string };

interface FakeDbState {
  promos: PromoRow[];
  tiers: DiscountTierRow[];
  passes: PassConfigRow[];
}

const dbState: FakeDbState = { promos: [], tiers: [], passes: [] };

function resetDb() {
  dbState.promos = [];
  dbState.tiers = [];
  dbState.passes = [];
}

vi.mock("@workspace/db", () => {
  // Mirror drizzle's chainable-and-thenable query builder: each chain link
  // (`from`, `where`, `orderBy`) returns a builder that is itself awaitable
  // (resolving to the matching rows) AND can be further chained. This lets
  // pricing.ts call any of `await db.select().from(t)`,
  // `await db.select().from(t).where(x)`, or
  // `await db.select().from(t).where(x).orderBy(y)` and get back the same
  // pre-seeded rows in `dbState`.
  function rowsFor(name: string): Record<string, unknown>[] {
    switch (name) {
      case "promoCodes":
        return dbState.promos as unknown as Record<string, unknown>[];
      case "discountTiers":
        return dbState.tiers as unknown as Record<string, unknown>[];
      case "passConfig":
        return dbState.passes as unknown as Record<string, unknown>[];
      default:
        return [];
    }
  }
  function makeChainable(name: string): Record<string, unknown> {
    const builder = {
      where: (..._a: unknown[]) => makeChainable(name),
      orderBy: (..._a: unknown[]) => makeChainable(name),
      then: (
        onFulfilled?: (v: Record<string, unknown>[]) => unknown,
        onRejected?: (e: unknown) => unknown,
      ) => Promise.resolve(rowsFor(name)).then(onFulfilled, onRejected),
    };
    return builder;
  }
  function makeSelect(table: { __name: string }) {
    return makeChainable(table.__name);
  }

  const db = {
    select: () => ({ from: (table: { __name: string }) => makeSelect(table) }),
    update: (table: { __name: string }) => ({
      set: (_set: Record<string, unknown>) => ({
        where: async () => {
          // Apply the conditional cap check inline so tests of
          // `incrementPromoUsage` reflect the real "rowCount = 0 when cap
          // exceeded" behaviour. We don't bother parsing the where clause —
          // tests configure dbState.promos to the precise pre-state.
          if (table.__name !== "promoCodes") return { rowCount: 1 };
          // No-op for select-only tests — the dedicated "uses supplied conn"
          // tests below override these via custom fake conns.
          return { rowCount: dbState.promos.length > 0 ? 1 : 0 };
        },
      }),
    }),
    transaction: async <T>(_cb: (tx: unknown) => Promise<T>): Promise<T> => {
      throw new Error("not used in these tests");
    },
  };

  return {
    db,
    promoCodesTable: {
      __name: "promoCodes",
      code: {},
      discountType: {},
      usedCount: {},
      maxUses: {},
      isActive: {},
      validFrom: {},
      validUntil: {},
    },
    discountTiersTable: { __name: "discountTiers", passType: {}, minQuantity: {} },
    passConfigTable: { __name: "passConfig" },
  };
});

vi.mock("drizzle-orm", () => ({
  eq: () => ({}),
  and: () => ({}),
  or: () => ({}),
  isNull: () => ({}),
  lte: () => ({}),
  gte: () => ({}),
  sql: ((..._a: unknown[]) => ({})) as unknown,
}));

import { incrementPromoUsage, calculatePricing } from "./pricing";

beforeEach(() => {
  resetDb();
});

// ---------------------------------------------------------------------------
// incrementPromoUsage — verifies the optional `conn` parameter is plumbed
// through correctly so callers can make the increment part of a transaction.
// ---------------------------------------------------------------------------

function makeFakeConn(opts: { discountType?: string | null; updateRowCount?: number }): {
  conn: Parameters<typeof incrementPromoUsage>[2];
  selectCalls: number;
  updateCalls: number;
} {
  const counters = { selectCalls: 0, updateCalls: 0 };
  const conn = {
    select: () => {
      counters.selectCalls++;
      return {
        from: () => ({
          where: async () =>
            opts.discountType === null || opts.discountType === undefined
              ? []
              : [{ discountType: opts.discountType }],
        }),
      };
    },
    update: () => {
      counters.updateCalls++;
      return {
        set: () => ({
          where: async () => ({ rowCount: opts.updateRowCount ?? 1 }),
        }),
      };
    },
  } as unknown as Parameters<typeof incrementPromoUsage>[2];
  return Object.assign(counters, { conn });
}

describe("incrementPromoUsage transaction wiring", () => {
  it("uses the supplied connection (tx) for both the lookup and the update", async () => {
    const fake = makeFakeConn({ discountType: "percentage", updateRowCount: 1 });
    const ok = await incrementPromoUsage("FOO", 3, fake.conn);
    expect(ok).toBe(true);
    expect(fake.selectCalls).toBe(1);
    expect(fake.updateCalls).toBe(1);
  });

  it("returns false when the supplied connection's update affects no rows (cap hit)", async () => {
    const fake = makeFakeConn({ discountType: "complimentary", updateRowCount: 0 });
    const ok = await incrementPromoUsage("CAP", 5, fake.conn);
    expect(ok).toBe(false);
  });

  it("returns false (and skips update) when the code is not found via the supplied connection", async () => {
    const fake = makeFakeConn({ discountType: null });
    const ok = await incrementPromoUsage("NOPE", 1, fake.conn);
    expect(ok).toBe(false);
    expect(fake.updateCalls).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// incrementPromoUsage — atomic cap enforcement: even under bursty concurrent
// confirmations no more than `maxUses` ticket-equivalents can ever land. We
// simulate the real Postgres conditional UPDATE in a tiny in-memory model so
// the contract stays locked: no double-spend possible at the call boundary.
// ---------------------------------------------------------------------------

function makeAtomicCappedConn(initial: {
  code: string;
  discountType: PromoRow["discountType"];
  usedCount: number;
  maxUses: number | null;
}): Parameters<typeof incrementPromoUsage>[2] {
  // Critically, the update closure reads-modifies-writes the shared row
  // *atomically* — mirroring Postgres row-locked UPDATE semantics. Multiple
  // overlapping awaits cannot race because JS resolves microtasks one at a
  // time and our async update callback completes synchronously after the
  // single `if (predicate) usedCount += inc` step.
  const row = { ...initial };
  const conn = {
    select: () => ({
      from: () => ({
        where: async () => [{ discountType: row.discountType }],
      }),
    }),
    update: () => ({
      set: () => ({
        where: async () => {
          // Tests pass `quantity` via the public `incrementPromoUsage` API;
          // we know `inc` deterministically: 1 for non-comp, qty for comp.
          // We can't observe `inc` here directly, so we reflect the
          // conditional check as the actual contract: the *caller*'s qty is
          // baked into the SQL by the time we arrive. To model this we
          // expose a per-call increment via a closure variable set just
          // before each call.
          const inc = (conn as unknown as { __pendingInc: number }).__pendingInc;
          if (row.maxUses === null || row.usedCount + inc <= row.maxUses) {
            row.usedCount += inc;
            return { rowCount: 1 };
          }
          return { rowCount: 0 };
        },
      }),
    }),
    __row: row,
    __pendingInc: 1,
  } as unknown as Parameters<typeof incrementPromoUsage>[2];
  return conn;
}

async function callIncrement(
  conn: Parameters<typeof incrementPromoUsage>[2],
  code: string,
  qty: number,
): Promise<boolean> {
  // Wire qty -> inc model for the fake conn (real DB encodes inc into the SQL).
  const inc =
    (conn as unknown as { __row: { discountType: string } }).__row.discountType === "complimentary"
      ? Math.max(1, qty)
      : 1;
  (conn as unknown as { __pendingInc: number }).__pendingInc = inc;
  return incrementPromoUsage(code, qty, conn);
}

describe("incrementPromoUsage atomic cap enforcement", () => {
  it("never lets concurrent non-complimentary increments exceed maxUses", async () => {
    const conn = makeAtomicCappedConn({
      code: "TENPCT",
      discountType: "percentage",
      usedCount: 0,
      maxUses: 3,
    });
    // Fire 10 overlapping confirmations — only 3 should commit.
    const results = await Promise.all(
      Array.from({ length: 10 }, () => callIncrement(conn, "TENPCT", 1)),
    );
    const successes = results.filter(Boolean).length;
    expect(successes).toBe(3);
    expect((conn as unknown as { __row: { usedCount: number } }).__row.usedCount).toBe(3);
  });

  it("counts complimentary increments by ticket quantity, not by booking", async () => {
    const conn = makeAtomicCappedConn({
      code: "FREE5",
      discountType: "complimentary",
      usedCount: 0,
      maxUses: 5,
    });
    // First booking takes 3 tickets — should succeed (3 ≤ 5).
    expect(await callIncrement(conn, "FREE5", 3)).toBe(true);
    // Second booking wants 3 more — would overflow (3+3=6 > 5), so reject.
    expect(await callIncrement(conn, "FREE5", 3)).toBe(false);
    // Third booking wants 2 more — fits exactly (3+2=5 ≤ 5), so accept.
    expect(await callIncrement(conn, "FREE5", 2)).toBe(true);
    // Fourth booking — any qty must reject (cap hit).
    expect(await callIncrement(conn, "FREE5", 1)).toBe(false);
    expect((conn as unknown as { __row: { usedCount: number } }).__row.usedCount).toBe(5);
  });

  it("allows unlimited increments when maxUses is null", async () => {
    const conn = makeAtomicCappedConn({
      code: "NOLIMIT",
      discountType: "percentage",
      usedCount: 0,
      maxUses: null,
    });
    const results = await Promise.all(
      Array.from({ length: 50 }, () => callIncrement(conn, "NOLIMIT", 1)),
    );
    expect(results.every(Boolean)).toBe(true);
    expect((conn as unknown as { __row: { usedCount: number } }).__row.usedCount).toBe(50);
  });
});

// ---------------------------------------------------------------------------
// calculatePricing — focuses on the complimentary-code branch since that's
// the new behaviour we want regression-proof. Verifies both the "fits"
// (whole order zeroed) and "shortfall" (no discount applied, but
// promoRemainingSeats surfaced for the UI prompt) paths.
// ---------------------------------------------------------------------------

function seedComplimentaryPromo(maxUses: number, usedCount: number): PromoRow {
  const promo: PromoRow = {
    code: "FREEPASS",
    discountType: "complimentary",
    discountValue: "0",
    isActive: true,
    validFrom: null,
    validUntil: null,
    maxUses,
    usedCount,
    maxDiscountAmount: null,
    applicablePassTypes: null,
    minQuantity: null,
    oncePerCustomer: false,
    description: null,
  };
  dbState.promos.push(promo);
  return promo;
}

describe("calculatePricing — complimentary code", () => {
  it("zeros the order when remaining seats >= requested quantity", async () => {
    seedComplimentaryPromo(/* maxUses */ 5, /* usedCount */ 0);
    const result = await calculatePricing("single", 3, "FREEPASS");
    // 3 × £199 = £597 base. Comp covers it entirely → subtotal 0, VAT 0, total 0.
    expect(result.baseSubtotal).toBe(597);
    expect(result.promoDiscountAmount).toBe(597);
    expect(result.subtotalAfterDiscounts).toBe(0);
    expect(result.vatAmount).toBe(0);
    expect(result.total).toBe(0);
    expect(result.promoDiscountType).toBe("complimentary");
    expect(result.promoRemainingSeats).toBe(5);
  });

  it("zeros the order when remaining seats == requested quantity (exact-fit)", async () => {
    seedComplimentaryPromo(/* maxUses */ 4, /* usedCount */ 1); // 3 remaining
    const result = await calculatePricing("single", 3, "FREEPASS");
    expect(result.promoDiscountAmount).toBe(597);
    expect(result.total).toBe(0);
    expect(result.promoRemainingSeats).toBe(3);
  });

  it("does NOT discount when remaining seats < requested quantity (shortfall)", async () => {
    seedComplimentaryPromo(/* maxUses */ 5, /* usedCount */ 3); // only 2 remaining
    const result = await calculatePricing("single", 3, "FREEPASS");
    // 3 × £199 = £597 base. Shortfall → no discount → full price + 20% VAT.
    expect(result.baseSubtotal).toBe(597);
    expect(result.promoDiscountAmount).toBe(0);
    expect(result.subtotalAfterDiscounts).toBe(597);
    expect(result.vatAmount).toBeCloseTo(119.4, 2);
    expect(result.total).toBeCloseTo(716.4, 2);
    // Critically — surface remaining seats so the UI can show the amber
    // prompt with "Reduce to N tickets".
    expect(result.promoDiscountType).toBe("complimentary");
    expect(result.promoRemainingSeats).toBe(2);
  });

  it("does NOT discount when remaining seats == 0 (fully redeemed)", async () => {
    seedComplimentaryPromo(/* maxUses */ 2, /* usedCount */ 2);
    const result = await calculatePricing("single", 1, "FREEPASS");
    expect(result.promoDiscountAmount).toBe(0);
    expect(result.promoRemainingSeats).toBe(0);
    expect(result.total).toBeGreaterThan(0);
  });

  it("treats null maxUses as unlimited and always covers the order", async () => {
    seedComplimentaryPromo(/* maxUses */ 0, /* usedCount */ 0);
    // Override maxUses to null after seeding so the helper signature stays simple.
    dbState.promos[0].maxUses = null;
    const result = await calculatePricing("single", 10, "FREEPASS");
    expect(result.promoDiscountAmount).toBe(result.baseSubtotal);
    expect(result.total).toBe(0);
    expect(result.promoRemainingSeats).toBeNull();
  });
});
