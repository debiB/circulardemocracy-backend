import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ensureFolderVisibleForMailbox,
  ensureHookCampaignFoldersVisible,
  ensureMailboxExists,
} from "../src/jmap_mailbox";

describe("ensureMailboxExists", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("creates mailboxes with isSubscribed true", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as {
        methodCalls: unknown[][];
      };
      const createCall = body.methodCalls.find(
        (call) => Array.isArray(call) && call[0] === "Mailbox/set",
      );

      if (createCall) {
        expect(createCall[1]).toEqual({
          accountId: "acct-1",
          create: {
            newMailbox: {
              name: "Climate-Action",
              isSubscribed: true,
            },
          },
        });
        return new Response(
          JSON.stringify({
            methodResponses: [
              [
                "Mailbox/set",
                {
                  created: { newMailbox: { id: "mb-new" } },
                },
                "createMailbox",
              ],
            ],
          }),
        );
      }

      return new Response(
        JSON.stringify({
          methodResponses: [
            ["Mailbox/query", { ids: [] }, "queryMailbox"],
            ["Mailbox/get", { list: [] }, "getMailbox"],
          ],
        }),
      );
    });

    vi.stubGlobal("fetch", fetchMock);

    const id = await ensureMailboxExists(
      "https://mail.example.com/jmap",
      "Bearer token",
      "acct-1",
      "Climate-Action",
    );

    expect(id).toBe("mb-new");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("subscribes existing mailboxes that are hidden", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as {
        methodCalls: unknown[][];
      };
      const updateCall = body.methodCalls.find(
        (call) =>
          Array.isArray(call) &&
          call[0] === "Mailbox/set" &&
          (call[1] as { update?: unknown }).update,
      );

      if (updateCall) {
        expect(updateCall[1]).toEqual({
          accountId: "acct-1",
          update: {
            "mb-existing": { isSubscribed: true },
          },
        });
        return new Response(
          JSON.stringify({
            methodResponses: [
              ["Mailbox/set", { updated: { "mb-existing": null } }, "subscribeMailbox"],
            ],
          }),
        );
      }

      return new Response(
        JSON.stringify({
          methodResponses: [
            ["Mailbox/query", { ids: ["mb-existing"] }, "queryMailbox"],
            [
              "Mailbox/get",
              {
                list: [{ id: "mb-existing", isSubscribed: false }],
              },
              "getMailbox",
            ],
          ],
        }),
      );
    });

    vi.stubGlobal("fetch", fetchMock);

    const id = await ensureMailboxExists(
      "https://mail.example.com/jmap",
      "Bearer token",
      "acct-1",
      "Climate-Action",
    );

    expect(id).toBe("mb-existing");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("subscribes folders via ALL_DOMAIN impersonation", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo, init?: RequestInit) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof Request
            ? input.url
            : input.toString();

      if (url.includes(".well-known/jmap")) {
        const auth = (init?.headers as Record<string, string>)?.Authorization;
        expect(auth).toBe(
          `Basic ${Buffer.from("politician@example.org%relay@example.org:relay-pass").toString("base64")}`,
        );
        return new Response(
          JSON.stringify({
            apiUrl: "https://mail.example.com/jmap",
            primaryAccounts: {
              "urn:ietf:params:jmap:mail": "acct-1",
            },
          }),
        );
      }

      const body = JSON.parse(String(init?.body)) as {
        methodCalls: unknown[][];
      };
      const createCall = body.methodCalls.find(
        (call) => Array.isArray(call) && call[0] === "Mailbox/set" && (call[1] as { create?: unknown }).create,
      );
      if (createCall) {
        return new Response(
          JSON.stringify({
            methodResponses: [
              [
                "Mailbox/set",
                { created: { newMailbox: { id: "mb-1" } } },
                "createMailbox",
              ],
            ],
          }),
        );
      }

      return new Response(
        JSON.stringify({
          methodResponses: [
            ["Mailbox/query", { ids: [] }, "queryMailbox"],
            ["Mailbox/get", { list: [] }, "getMailbox"],
          ],
        }),
      );
    });

    vi.stubGlobal("fetch", fetchMock);

    await ensureFolderVisibleForMailbox(
      {
        JMAP_URL: "https://mail.example.org",
        ALL_DOMAIN: "example.org",
        RELAY_SERVICE_ACCOUNT_EMAIL: "relay@example.org",
        RELAY_SERVICE_ACCOUNT_PASSWORD: "relay-pass",
      },
      "politician@example.org",
      "Climate-Action",
    );

    expect(fetchMock).toHaveBeenCalled();
  });

  it("deduplicates hook folder subscriptions", async () => {
    let mailboxCreateCalls = 0;
    const fetchMock = vi.fn(async (input: RequestInfo, init?: RequestInit) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof Request
            ? input.url
            : input.toString();

      if (url.includes(".well-known/jmap")) {
        return new Response(
          JSON.stringify({
            apiUrl: "https://mail.example.com/jmap",
            primaryAccounts: {
              "urn:ietf:params:jmap:mail": "acct-1",
            },
          }),
        );
      }

      const body = JSON.parse(String(init?.body)) as {
        methodCalls: unknown[][];
      };
      const createCall = body.methodCalls.find(
        (call) =>
          Array.isArray(call) &&
          call[0] === "Mailbox/set" &&
          (call[1] as { create?: unknown }).create,
      );
      if (createCall) {
        mailboxCreateCalls += 1;
        return new Response(
          JSON.stringify({
            methodResponses: [
              [
                "Mailbox/set",
                { created: { newMailbox: { id: "mb-1" } } },
                "createMailbox",
              ],
            ],
          }),
        );
      }

      return new Response(
        JSON.stringify({
          methodResponses: [
            ["Mailbox/query", { ids: [] }, "queryMailbox"],
            ["Mailbox/get", { list: [] }, "getMailbox"],
          ],
        }),
      );
    });

    vi.stubGlobal("fetch", fetchMock);

    await ensureHookCampaignFoldersVisible(
      {
        JMAP_URL: "https://mail.example.org",
        ALL_DOMAIN: "example.org",
        RELAY_SERVICE_ACCOUNT_EMAIL: "relay@example.org",
        RELAY_SERVICE_ACCOUNT_PASSWORD: "relay-pass",
      },
      [
        { mailboxEmail: "politician@example.org", folderName: "Climate-Action" },
        { mailboxEmail: "politician@example.org", folderName: "Climate-Action" },
      ],
    );

    expect(mailboxCreateCalls).toBe(1);
  });
});
