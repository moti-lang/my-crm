import { describe, expect, it } from "vitest";
import { withConnectTimeout } from "../db-url";

describe("withConnectTimeout", () => {
  it("מוסיף connect_timeout ו-pool_timeout כשאינם קיימים", () => {
    const u = new URL(withConnectTimeout("postgresql://u:p@host.neon.tech/db?sslmode=require"));
    expect(u.searchParams.get("connect_timeout")).toBe("20");
    expect(u.searchParams.get("pool_timeout")).toBe("20");
    expect(u.searchParams.get("sslmode")).toBe("require");
  });
  it("לא דורס ערך שהוגדר ידנית", () => {
    const u = new URL(withConnectTimeout("postgres://u:p@h/db?connect_timeout=5"));
    expect(u.searchParams.get("connect_timeout")).toBe("5");
  });
  it("מחזיר כתובת לא תקינה כמות שהיא", () => {
    expect(withConnectTimeout("not a url")).toBe("not a url");
  });
});
