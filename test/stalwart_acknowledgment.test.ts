import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  type MockedFunction,
} from "vitest";
import app from "../src/stalwart";

global.fetch = vi.fn();
const mockFetch = fetch as MockedFunction<typeof fetch>;

describe("Stalwart MTA Hook - Acknowledgment Emails", () => {
  const env = {
    AI: {
      run: vi.fn(),
    },
    SUPABASE_URL: "https://test.supabase.co",
    SUPABASE_KEY: "test-key",
    API_KEY: "test-api-key",
  };

  const createMockResponse = (data: any, status = 200) => {
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: status === 200 ? "OK" : "Error",
      headers: new Headers({ "Content-Type": "application/json" }),
      json: async () => data,
      text: async () => JSON.stringify(data),
      clone: function () {
        return this;
      },
    } as unknown as Response;
  };

  beforeEach(() => {
    mockFetch.mockClear();
    env.AI.run.mockClear();
  });

  it("should trigger acknowledgment email for low-confidence message", async () => {
    const stalwartPayload = {
      messageId: "stalwart-msg-low-conf",
      sender: "sender@example.com",
      recipients: ["politician@example.com"],
      headers: {
        from: '"Sender Name" <sender@example.com>',
        subject: "Unclear message",
      },
      body: {
        text: "This is a short unclear message.",
      },
      size: 300,
      timestamp: Math.floor(Date.now() / 1000),
    };

    // Mock AI embedding
    env.AI.run.mockResolvedValueOnce({ data: [new Array(1024).fill(0.1)] });

    // Mock classifyMessage - low confidence
    mockFetch.mockResolvedValueOnce(createMockResponse({ data: [{ id: 10, name: "Uncategorized", similarity: 0.15 }], error: null }));

    // Mock checkExternalIdExists
    mockFetch.mockResolvedValueOnce(createMockResponse({ data: [], error: null }));

    // Mock findPoliticianByEmail with JMAP credentials
    mockFetch.mockResolvedValueOnce(
      createMockResponse({
        data: [
          {
            id: 1,
            name: "Test Politician",
            email: "politician@example.com",
            stalwart_username: "politician",
            stalwart_app_password: "test-password",
            stalwart_jmap_endpoint: "https://mail.example.com/.well-known/jmap",
          },
        ],
        error: null,
      })
    );

    // Mock AI embedding again
    env.AI.run.mockResolvedValueOnce({ data: [new Array(1024).fill(0.1)] });

    // Mock getDuplicateRank
    mockFetch.mockResolvedValueOnce(createMockResponse({ data: [{ count: 0 }], error: null }));

    // Mock insertMessage - returns message ID
    mockFetch.mockResolvedValueOnce(createMockResponse({ data: [{ id: 101 }], error: null }));

    const executionCtx = {
      waitUntil: vi.fn(),
      passThroughOnException: vi.fn(),
      props: {},
    } as any;

    const req = new Request("http://localhost/mta-hook", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-KEY": "test-api-key",
      },
      body: JSON.stringify(stalwartPayload),
    });

    const res = await app.fetch(req, env, executionCtx);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.action).toBe("accept");
    expect(data.confidence).toBeLessThan(0.3);
    expect(data.modifications.folder).toContain("unchecked");

    // Verify waitUntil was called for async acknowledgment
    expect(executionCtx.waitUntil).toHaveBeenCalled();
  });

  it("should NOT trigger acknowledgment for high-confidence message", async () => {
    const stalwartPayload = {
      messageId: "stalwart-msg-high-conf",
      sender: "sender@example.com",
      recipients: ["politician@example.com"],
      headers: {
        from: '"Sender Name" <sender@example.com>',
        subject: "Clear message about campaign",
      },
      body: {
        text: "This is a clear message about the specific campaign with good details.",
      },
      size: 500,
      timestamp: Math.floor(Date.now() / 1000),
    };

    env.AI.run.mockResolvedValueOnce({ data: [new Array(1024).fill(0.8)] });

    // Mock classifyMessage - high confidence
    mockFetch.mockResolvedValueOnce(createMockResponse({ data: [{ id: 5, name: "Test Campaign", similarity: 0.85 }], error: null }));
    mockFetch.mockResolvedValueOnce(createMockResponse({ data: [], error: null }));
    mockFetch.mockResolvedValueOnce(
      createMockResponse({
        data: [
          {
            id: 1,
            name: "Test Politician",
            email: "politician@example.com",
          },
        ],
        error: null,
      })
    );
    env.AI.run.mockResolvedValueOnce({ data: [new Array(1024).fill(0.8)] });
    mockFetch.mockResolvedValueOnce(createMockResponse({ data: [{ count: 0 }], error: null }));
    mockFetch.mockResolvedValueOnce(createMockResponse({ data: [{ id: 102 }], error: null }));

    const executionCtx = {
      waitUntil: vi.fn(),
      passThroughOnException: vi.fn(),
      props: {},
    } as any;

    const req = new Request("http://localhost/mta-hook", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-KEY": "test-api-key",
      },
      body: JSON.stringify(stalwartPayload),
    });

    const res = await app.fetch(req, env, executionCtx);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.action).toBe("accept");
    expect(data.confidence).toBeGreaterThanOrEqual(0.3);

    // Verify waitUntil was NOT called (no acknowledgment needed)
    expect(executionCtx.waitUntil).not.toHaveBeenCalled();
  });

  it("should NOT trigger acknowledgment for auto-reply messages", async () => {
    const stalwartPayload = {
      messageId: "stalwart-msg-auto-reply",
      sender: "sender@example.com",
      recipients: ["politician@example.com"],
      headers: {
        from: '"Sender Name" <sender@example.com>',
        subject: "Auto-reply message",
        "auto-submitted": "auto-replied",
      },
      body: {
        text: "This is an auto-reply message.",
      },
      size: 300,
      timestamp: Math.floor(Date.now() / 1000),
    };

    env.AI.run.mockResolvedValueOnce({ data: [new Array(1024).fill(0.1)] });
    mockFetch.mockResolvedValueOnce(createMockResponse({ data: [{ id: 10, name: "Uncategorized", similarity: 0.15 }], error: null }));
    mockFetch.mockResolvedValueOnce(createMockResponse({ data: [], error: null }));
    mockFetch.mockResolvedValueOnce(
      createMockResponse({
        data: [
          {
            id: 1,
            name: "Test Politician",
            email: "politician@example.com",
          },
        ],
        error: null,
      })
    );
    env.AI.run.mockResolvedValueOnce({ data: [new Array(1024).fill(0.1)] });
    mockFetch.mockResolvedValueOnce(createMockResponse({ data: [{ count: 0 }], error: null }));
    mockFetch.mockResolvedValueOnce(createMockResponse({ data: [{ id: 103 }], error: null }));

    const executionCtx = {
      waitUntil: vi.fn(),
      passThroughOnException: vi.fn(),
      props: {},
    } as any;

    const req = new Request("http://localhost/mta-hook", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-KEY": "test-api-key",
      },
      body: JSON.stringify(stalwartPayload),
    });

    const res = await app.fetch(req, env, executionCtx);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.action).toBe("accept");

    // Verify waitUntil was NOT called (loop prevention)
    expect(executionCtx.waitUntil).not.toHaveBeenCalled();
  });

  it("should handle multiple recipients with different confidence levels", async () => {
    const stalwartPayload = {
      messageId: "stalwart-msg-multi",
      sender: "sender@example.com",
      recipients: ["politician1@example.com", "politician2@example.com"],
      headers: {
        from: '"Sender Name" <sender@example.com>',
        subject: "Message to multiple politicians",
      },
      body: {
        text: "This is a message to multiple politicians.",
      },
      size: 400,
      timestamp: Math.floor(Date.now() / 1000),
    };

    env.AI.run.mockResolvedValueOnce({ data: [new Array(1024).fill(0.2)] });
    mockFetch.mockResolvedValueOnce(createMockResponse({ data: [{ id: 10, name: "Test Campaign", similarity: 0.25 }], error: null }));

    // First recipient - low confidence
    mockFetch.mockResolvedValueOnce(createMockResponse({ data: [], error: null }));
    mockFetch.mockResolvedValueOnce(
      createMockResponse({
        data: [
          {
            id: 1,
            name: "Politician One",
            email: "politician1@example.com",
            stalwart_username: "politician1",
            stalwart_app_password: "pass1",
          },
        ],
        error: null,
      })
    );
    env.AI.run.mockResolvedValueOnce({ data: [new Array(1024).fill(0.2)] });
    mockFetch.mockResolvedValueOnce(createMockResponse({ data: [{ count: 0 }], error: null }));
    mockFetch.mockResolvedValueOnce(createMockResponse({ data: [{ id: 201 }], error: null }));

    // Second recipient - low confidence
    mockFetch.mockResolvedValueOnce(createMockResponse({ data: [], error: null }));
    mockFetch.mockResolvedValueOnce(
      createMockResponse({
        data: [
          {
            id: 2,
            name: "Politician Two",
            email: "politician2@example.com",
            stalwart_username: "politician2",
            stalwart_app_password: "pass2",
          },
        ],
        error: null,
      })
    );
    env.AI.run.mockResolvedValueOnce({ data: [new Array(1024).fill(0.2)] });
    mockFetch.mockResolvedValueOnce(createMockResponse({ data: [{ count: 0 }], error: null }));
    mockFetch.mockResolvedValueOnce(createMockResponse({ data: [{ id: 202 }], error: null }));

    const executionCtx = {
      waitUntil: vi.fn(),
      passThroughOnException: vi.fn(),
      props: {},
    } as any;

    const req = new Request("http://localhost/mta-hook", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-KEY": "test-api-key",
      },
      body: JSON.stringify(stalwartPayload),
    });

    const res = await app.fetch(req, env, executionCtx);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.action).toBe("accept");

    // Verify waitUntil was called twice (once for each recipient)
    expect(executionCtx.waitUntil).toHaveBeenCalledTimes(2);
  });
});
