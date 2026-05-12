import { describe, expect, it } from "vitest";
import {
  emailHostedOnDomain,
  normalizeMailDomain,
  resolveStalwartJmapWorkerConfig,
} from "../src/stalwart_jmap_env";

describe("resolveStalwartJmapWorkerConfig", () => {
  it("returns relay config when ALL_DOMAIN is unset", () => {
    const cfg = resolveStalwartJmapWorkerConfig({
      STALWART_JMAP_ENDPOINT: "https://mail.example/.well-known/jmap",
      STALWART_JMAP_ACCOUNT_ID: "7",
    });
    expect(cfg).not.toBeNull();
    expect(cfg!.stalwartImpersonation).toBeUndefined();
    expect(cfg!.jmapAccountId).toBe("7");
  });

  it("returns impersonation config when ALL_DOMAIN is set", () => {
    const cfg = resolveStalwartJmapWorkerConfig({
      ALL_DOMAIN: "circulardemocracy.org",
      STALWART_JMAP_ENDPOINT: "https://mail.example/.well-known/jmap",
      STALWART_USERNAME: "svc@circulardemocracy.org",
      STALWART_APP_PASSWORD: "secret",
    });
    expect(cfg).not.toBeNull();
    expect(cfg!.stalwartImpersonation?.allDomainLower).toBe("circulardemocracy.org");
    expect(cfg!.stalwartImpersonation?.serviceUsername).toBe("svc@circulardemocracy.org");
    expect(cfg!.jmapAccountId).toBe("");
  });

  it("returns null for ALL_DOMAIN without service credentials", () => {
    const cfg = resolveStalwartJmapWorkerConfig({
      ALL_DOMAIN: "circulardemocracy.org",
      STALWART_JMAP_ENDPOINT: "https://mail.example/.well-known/jmap",
    });
    expect(cfg).toBeNull();
  });
});

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
