import { describe, it, expect, vi } from "vitest";

vi.mock("@workspace/db", () => ({
  db: {
    select: () => ({ from: () => ({ where: async () => [] }) }),
    update: () => ({ set: () => ({ where: async () => ({ rowCount: 0 }) }) }),
    transaction: async <T>(_cb: (tx: unknown) => Promise<T>): Promise<T> => {
      throw new Error("db.transaction should not be called from incrementPromoUsage");
    },
  },
  promoCodesTable: {
    code: { name: "code" },
    discountType: { name: "discountType" },
    usedCount: { name: "usedCount" },
    maxUses: { name: "maxUses" },
  },
  discountTiersTable: {},
  passConfigTable: {},
}));

vi.mock("drizzle-orm", () => ({
  eq: () => ({}),
  and: () => ({}),
  or: () => ({}),
  isNull: () => ({}),
  lte: () => ({}),
  gte: () => ({}),
  sql: ((..._a: unknown[]) => ({})) as unknown,
}));

import { incrementPromoUsage } from "./pricing";

function makeFakeConn(opts: { discountType?: string | null; updateRowCount?: number }): {
  conn: Parameters<typeof incrementPromoUsage>[2];
  selectCalls: number;
  updateCalls: number;
} {
  let selectCalls = 0;
  let updateCalls = 0;
  const conn = {
    select: () => {
      selectCalls++;
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
      updateCalls++;
      return {
        set: () => ({
          where: async () => ({ rowCount: opts.updateRowCount ?? 1 }),
        }),
      };
    },
  } as unknown as Parameters<typeof incrementPromoUsage>[2];
  return {
    conn,
    get selectCalls() {
      return selectCalls;
    },
    get updateCalls() {
      return updateCalls;
    },
  } as unknown as ReturnType<typeof makeFakeConn>;
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
