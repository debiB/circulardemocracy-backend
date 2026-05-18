import { describe, expect, it } from "vitest";
import {
  emailHostedOnDomain,
  normalizeMailDomain,
} from "../src/stalwart_jmap_env";

describe("normalizeMailDomain / emailHostedOnDomain", () => {
  it("normalizes domains", () => {
    expect(normalizeMailDomain("@Example.ORG")).toBe("example.org");
  });

  it("detects hosted email", () => {
    expect(
      emailHostedOnDomain("Rep@Example.ORG", "example.org"),
    ).toBe(true);
    expect(emailHostedOnDomain("x@other.org", "example.org")).toBe(false);
  });
});
