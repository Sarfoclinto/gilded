import { describe, expect, it } from "vitest";
import { passwordStrength } from "./passwordStrength";

describe("passwordStrength", () => {
  it("scores empty and short as nothing or weak", () => {
    expect(passwordStrength("").score).toBe(0);
    expect(passwordStrength("abc").score).toBe(1);
  });
  it("rejects common and repeated", () => {
    expect(passwordStrength("password12345").score).toBe(1);
    expect(passwordStrength("aaaaaaaaaaaa").score).toBe(1);
  });
  it("rates length and variety", () => {
    expect(passwordStrength("plainlowerx").score).toBe(2);
    expect(passwordStrength("Sunrise Market 42!").score).toBe(4);
    expect(passwordStrength("longlowercase12").score).toBe(3);
  });
});
