import { describe, expect, it } from "vitest";
import { resolveOutboundEmailIdentity } from "../src/email_impersonation";

describe("resolveOutboundEmailIdentity", () => {
  const politician = {
    id: 1,
    name: "Alex Minister",
    email: "alex@parliament.example",
  };

  it("uses technical_email for From and politician email for Reply-To when reply_to is unset", () => {
    const r = resolveOutboundEmailIdentity(politician, {
      technical_email: "noreply@campaign.example",
      reply_to_email: null,
    });
    expect(r).toEqual({
      fromEmail: "noreply@campaign.example",
      fromDisplayName: "Alex Minister",
      replyToEmail: "alex@parliament.example",
    });
  });

  it("uses campaign reply_to when set", () => {
    const r = resolveOutboundEmailIdentity(politician, {
      technical_email: null,
      reply_to_email: "  inbox@office.example  ",
    });
    expect(r).toEqual({
      fromEmail: "alex@parliament.example",
      fromDisplayName: "Alex Minister",
      replyToEmail: "inbox@office.example",
    });
  });

  it("returns null when From cannot be resolved", () => {
    expect(
      resolveOutboundEmailIdentity(
        { ...politician, email: "" },
        { technical_email: null, reply_to_email: "x@y.com" },
      ),
    ).toBeNull();
  });

  it("returns null when Reply-To cannot be resolved", () => {
    expect(
      resolveOutboundEmailIdentity(
        { ...politician, email: "" },
        { technical_email: "send@x.com", reply_to_email: null },
      ),
    ).toBeNull();
  });

  it("falls back display name to local part of From when name empty", () => {
    const r = resolveOutboundEmailIdentity(
      { id: 1, name: "  ", email: "only@from.example" },
      { technical_email: null, reply_to_email: null },
    );
    expect(r?.fromDisplayName).toBe("only");
  });
});
