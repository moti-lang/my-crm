import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAutosave, type SaveState } from "../autosave";

class OfflineErr extends Error {}

function setup(overrides: Partial<Parameters<typeof createAutosave>[0]> = {}) {
  const request = vi.fn(async (patch: object) => ({ ok: true, patch }));
  const enqueue = vi.fn(async () => undefined);
  const onSaved = vi.fn();
  const states: SaveState[] = [];
  const ctl = createAutosave<{ name?: string; area?: string; observation?: string }>({
    request,
    enqueue,
    isOffline: (e) => e instanceof OfflineErr,
    onSaved,
    onState: (s) => states.push(s),
    delay: 500,
    savedTtl: 1000,
    ...overrides,
  });
  return { ctl, request, enqueue, onSaved, states };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("autosave — שמירה", () => {
  it("מאחד שינויים ושומר אחרי debounce, ואז מדווח 'נשמר' וחוזר ל-idle", async () => {
    const { ctl, request, onSaved, states } = setup();
    ctl.save({ name: "נגריה" });
    ctl.save({ name: "נגריה של עדי" });
    ctl.save({ area: "רחוב הסלע" });
    expect(request).not.toHaveBeenCalled();
    expect(ctl.getState().status).toBe("dirty");
    await vi.advanceTimersByTimeAsync(500);
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith({ name: "נגריה של עדי", area: "רחוב הסלע" });
    expect(ctl.getState().status).toBe("saved");
    expect(onSaved).toHaveBeenCalledWith({ name: "נגריה של עדי", area: "רחוב הסלע" }, expect.anything());
    await vi.advanceTimersByTimeAsync(1000);
    expect(ctl.getState().status).toBe("idle");
    expect(states.map((s) => s.status)).toEqual(["dirty", "dirty", "dirty", "saving", "saved", "idle"]);
  });

  it("שמירה מיידית ביציאה מהשדה (immediate) בלי לחכות ל-debounce", async () => {
    const { ctl, request } = setup();
    ctl.save({ observation: "ניירת" }, true);
    await vi.advanceTimersByTimeAsync(0);
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith({ observation: "ניירת" });
  });

  it("שינוי במהלך שמירה נשלח בבקשה נוספת אחרי שהראשונה מסתיימת", async () => {
    let resolveFirst!: (v: unknown) => void;
    const request = vi.fn().mockImplementationOnce(() => new Promise((r) => (resolveFirst = r))).mockResolvedValue({});
    const { ctl } = setup({ request });
    ctl.save({ name: "א" }, true);
    await vi.advanceTimersByTimeAsync(0);
    ctl.save({ name: "אב" });
    expect(request).toHaveBeenCalledTimes(1);
    resolveFirst({});
    await vi.advanceTimersByTimeAsync(500);
    expect(request).toHaveBeenCalledTimes(2);
    expect(request).toHaveBeenLastCalledWith({ name: "אב" });
  });
});

describe("autosave — כשל שמירה", () => {
  it("בכשל: מצב שגיאה עם הודעה, השינויים נשמרים לניסיון חוזר, ו-retry שולח אותם שוב", async () => {
    const request = vi.fn().mockRejectedValueOnce(new Error("חובה שם עסק או תיאור מזהה")).mockResolvedValue({});
    const { ctl, onSaved } = setup({ request });
    ctl.save({ name: "" }, true);
    await vi.advanceTimersByTimeAsync(0);
    expect(ctl.getState()).toMatchObject({ status: "error", message: "חובה שם עסק או תיאור מזהה" });
    expect(ctl.getPending()).toEqual({ name: "" });
    expect(onSaved).not.toHaveBeenCalled();
    // הערך לא נמחק: שינוי חדש מתמזג על השינוי שנכשל
    ctl.save({ name: "נגריה" });
    expect(ctl.getPending()).toEqual({ name: "נגריה" });
    await ctl.retry();
    expect(request).toHaveBeenLastCalledWith({ name: "נגריה" });
    expect(ctl.getState().status).toBe("saved");
  });

  it("אחרי כשל לא מנסה שוב לבד (אין לולאת שגיאות), אלא רק ב-retry או בשינוי חדש", async () => {
    const request = vi.fn().mockRejectedValue(new Error("500"));
    const { ctl } = setup({ request });
    ctl.save({ name: "x" }, true);
    await vi.advanceTimersByTimeAsync(5000);
    expect(request).toHaveBeenCalledTimes(1);
    expect(ctl.getState().status).toBe("error");
  });
});

describe("autosave — אופליין", () => {
  it("בניתוק רשת השינוי נכנס לתור הסנכרון ומדווח 'queued'", async () => {
    const request = vi.fn().mockRejectedValue(new OfflineErr("offline"));
    const { ctl, enqueue } = setup({ request });
    ctl.save({ area: "תלפיות" }, true);
    await vi.advanceTimersByTimeAsync(0);
    expect(enqueue).toHaveBeenCalledWith({ area: "תלפיות" });
    expect(ctl.getState().status).toBe("queued");
    expect(ctl.getPending()).toBeNull();
  });

  it("אם גם ההכנסה לתור נכשלת — שגיאה והשינויים נשמרים", async () => {
    const request = vi.fn().mockRejectedValue(new OfflineErr("offline"));
    const enqueue = vi.fn().mockRejectedValue(new Error("IndexedDB unavailable"));
    const { ctl } = setup({ request, enqueue });
    ctl.save({ area: "תלפיות" }, true);
    await vi.advanceTimersByTimeAsync(0);
    expect(ctl.getState()).toMatchObject({ status: "error", message: "IndexedDB unavailable" });
    expect(ctl.getPending()).toEqual({ area: "תלפיות" });
  });
});
