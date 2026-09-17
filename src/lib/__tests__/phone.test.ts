import { describe, expect, it } from "vitest";
import { displayPhone, normalizePhone, whatsappHref } from "../phone";

describe("normalizePhone", () => {
  it("normalizes Israeli mobile numbers", () => {
    expect(normalizePhone("052-123-4567")).toBe("+972521234567");
    expect(normalizePhone("0521234567")).toBe("+972521234567");
    expect(normalizePhone("+972 52 123 4567")).toBe("+972521234567");
    expect(normalizePhone("972521234567")).toBe("+972521234567");
    expect(normalizePhone("00972521234567")).toBe("+972521234567");
  });
  it("normalizes landlines", () => {
    expect(normalizePhone("03-1234567")).toBe("+97231234567");
    expect(normalizePhone("02 623 4567")).toBe("+97226234567");
  });
  it("returns null for empty", () => {
    expect(normalizePhone("")).toBeNull();
    expect(normalizePhone(null)).toBeNull();
    expect(normalizePhone("אין")).toBeNull();
  });
});

describe("displayPhone", () => {
  it("formats mobile and landline", () => {
    expect(displayPhone("+972521234567")).toBe("052-123-4567");
    expect(displayPhone("+97231234567")).toBe("03-123-4567");
    expect(displayPhone("+15551234567")).toBe("+15551234567");
  });
  it("builds WhatsApp links", () => {
    expect(whatsappHref("+972521234567", "שלום")).toBe("https://wa.me/972521234567?text=%D7%A9%D7%9C%D7%95%D7%9D");
  });
});
