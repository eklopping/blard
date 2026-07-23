import { describe, it, expect } from "vitest";
import { dmThreadKey, validateChatBody, CHAT_MAX_BODY } from "@skilling-mmo/shared";

describe("chat helpers", () => {
  it("dmThreadKey is order-independent", () => {
    expect(dmThreadKey("a", "b")).toBe("a:b");
    expect(dmThreadKey("b", "a")).toBe("a:b");
  });

  it("validateChatBody rejects empty and too long", () => {
    expect(validateChatBody("").ok).toBe(false);
    expect(validateChatBody("   ").ok).toBe(false);
    expect(validateChatBody("x".repeat(CHAT_MAX_BODY + 1)).ok).toBe(false);
    expect(validateChatBody(" hello ").ok).toBe(true);
    expect(validateChatBody(" hello ").body).toBe("hello");
  });
});
