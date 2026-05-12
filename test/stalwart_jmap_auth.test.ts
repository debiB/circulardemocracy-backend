import { describe, expect, it } from "vitest";
import {
  buildStalwartImpersonationLogin,
  encodeBasicAuth,
} from "../src/stalwart_jmap_auth";

describe("encodeBasicAuth", () => {
  it("builds a Basic header", () => {
    expect(encodeBasicAuth("alice", "p")).toBe(
      `Basic ${Buffer.from("alice:p").toString("base64")}`,
    );
  });
});

describe("buildStalwartImpersonationLogin", () => {
  it("joins service and target with %", () => {
    expect(
      buildStalwartImpersonationLogin(
        "admin@example.com",
        "user@example.com",
      ),
    ).toBe("admin@example.com%user@example.com");
  });
});
