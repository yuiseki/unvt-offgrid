import { describe, expect, it } from "vitest";
import { isSafari } from "./env";

describe("isSafari", () => {
  it("detects Safari on iPhone", () => {
    expect(
      isSafari(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Mobile/15E148 Safari/604.1",
      ),
    ).toBe(true);
  });

  it("detects Safari on macOS", () => {
    expect(
      isSafari(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Safari/605.1.15",
      ),
    ).toBe(true);
  });

  it("does not flag Chrome on iPhone (see TODO.md: it may still behave like Safari)", () => {
    expect(
      isSafari(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/140.0.0.0 Mobile/15E148 Safari/604.1",
      ),
    ).toBe(false);
  });

  it("does not flag Chrome on Android", () => {
    expect(
      isSafari(
        "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36",
      ),
    ).toBe(false);
  });
});
