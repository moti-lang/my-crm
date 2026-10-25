import { beforeAll, describe, expect, it } from "vitest";

describe("session token", () => {
  let auth: typeof import("../auth");
  beforeAll(async () => {
    process.env.AUTH_SECRET = "test-secret";
    process.env.APP_PASSWORD = "1234";
    auth = await import("../auth");
  });

  it("טוקן חדש תקף לשנה ולא דורש חידוש", async () => {
    const t = await auth.createSessionToken();
    expect(await auth.verifySessionToken(t)).toBe(true);
    expect(auth.sessionNeedsRenewal(t)).toBe(false);
  });

  it("אחרי חודש של שימוש הטוקן מתחדש, ולא פג תוקף", async () => {
    const t = await auth.createSessionToken();
    const inFortyDays = Date.now() + 40 * 24 * 60 * 60 * 1000;
    expect(auth.sessionNeedsRenewal(t, inFortyDays)).toBe(true);
    expect(await auth.verifySessionToken(t)).toBe(true);
  });

  it("טוקן מזויף או ריק נדחה ולא מחודש", async () => {
    expect(await auth.verifySessionToken("9999999999999.abc")).toBe(false);
    expect(auth.sessionNeedsRenewal(undefined)).toBe(false);
    expect(auth.sessionNeedsRenewal("abc.def")).toBe(false);
  });
});
