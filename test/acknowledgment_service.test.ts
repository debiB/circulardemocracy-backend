import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  type MockedFunction,
} from "vitest";
import {
  shouldSendAcknowledgment,
  isAutoReply,
  sendAcknowledgmentEmail,
} from "../src/acknowledgment_service";
import { DatabaseClient } from "../src/database";

global.fetch = vi.fn();
const mockFetch = fetch as MockedFunction<typeof fetch>;

describe("Acknowledgment Service", () => {
  beforeEach(() => {
    mockFetch.mockClear();
  });

  describe("shouldSendAcknowledgment", () => {
    it("should return true for confidence < 0.3", () => {
      expect(shouldSendAcknowledgment(0.1)).toBe(true);
      expect(shouldSendAcknowledgment(0.29)).toBe(true);
      expect(shouldSendAcknowledgment(0.0)).toBe(true);
    });

    it("should return false for confidence >= 0.3", () => {
      expect(shouldSendAcknowledgment(0.3)).toBe(false);
      expect(shouldSendAcknowledgment(0.5)).toBe(false);
      expect(shouldSendAcknowledgment(0.8)).toBe(false);
      expect(shouldSendAcknowledgment(1.0)).toBe(false);
    });
  });

  describe("isAutoReply", () => {
    it("should detect Auto-Submitted header", () => {
      expect(isAutoReply({ "auto-submitted": "auto-replied" })).toBe(true);
      expect(isAutoReply({ "auto-submitted": "auto-generated" })).toBe(true);
      expect(isAutoReply({ "auto-submitted": "no" })).toBe(false);
    });

    it("should detect X-Auto-Response-Suppress header", () => {
      expect(isAutoReply({ "x-auto-response-suppress": "All" })).toBe(true);
      expect(isAutoReply({ "x-auto-response-suppress": "OOF" })).toBe(true);
    });

    it("should detect Precedence header", () => {
      expect(isAutoReply({ precedence: "bulk" })).toBe(true);
      expect(isAutoReply({ precedence: "junk" })).toBe(true);
      expect(isAutoReply({ precedence: "list" })).toBe(true);
      expect(isAutoReply({ precedence: "normal" })).toBe(false);
    });

    it("should handle array header values", () => {
      expect(isAutoReply({ "auto-submitted": ["auto-replied"] })).toBe(true);
      expect(isAutoReply({ precedence: ["bulk", "normal"] })).toBe(true);
    });

    it("should return false for normal messages", () => {
      expect(
        isAutoReply({
          from: "user@example.com",
          subject: "Normal message",
        })
      ).toBe(false);
    });
  });

  describe("sendAcknowledgmentEmail", () => {
    const createMockResponse = (data: any, status = 200) => {
      return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => data,
        text: async () => JSON.stringify(data),
      } as unknown as Response;
    };

    it("should not send acknowledgment for high confidence messages", async () => {
      const db = new DatabaseClient({
        url: "https://test.supabase.co",
        key: "test-key",
      });

      vi.spyOn(db, "getMessageById").mockResolvedValueOnce({
        id: 1,
        classification_confidence: 0.8,
        stalwart_message_id: "msg-123",
        stalwart_account_id: "politician@example.com",
      });

      const result = await sendAcknowledgmentEmail(db, 1);

      expect(result.success).toBe(false);
      expect(result.error).toContain("does not require acknowledgment");
    });

    it("should not send acknowledgment for non-email messages", async () => {
      const db = new DatabaseClient({
        url: "https://test.supabase.co",
        key: "test-key",
      });

      // Mock getMessageById to return message without Stalwart references
      vi.spyOn(db, "getMessageById").mockResolvedValueOnce({
        id: 1,
        classification_confidence: 0.2,
        stalwart_message_id: null,
        stalwart_account_id: null,
      });

      const result = await sendAcknowledgmentEmail(db, 1);

      expect(result.success).toBe(false);
      expect(result.error).toContain("not from email channel");
    });

    it("should send acknowledgment for low confidence email messages", async () => {
      const db = new DatabaseClient({
        url: "https://test.supabase.co",
        key: "test-key",
      });

      // Mock database methods
      vi.spyOn(db, "getMessageById").mockResolvedValueOnce({
        id: 1,
        classification_confidence: 0.2,
        stalwart_message_id: "msg-123",
        stalwart_account_id: "politician@example.com",
        politician_id: 10,
        campaign_id: 5,
      });

      vi.spyOn(db, "getPoliticianById").mockResolvedValueOnce({
        id: 10,
        name: "Test Politician",
        email: "politician@example.com",
        additional_emails: [],
        active: true,
        stalwart_username: "politician",
        stalwart_app_password: "test-password",
        stalwart_jmap_endpoint: "https://mail.example.com/.well-known/jmap",
      });

      vi.spyOn(db, "getCampaignById").mockResolvedValueOnce({
        id: 5,
        name: "Test Campaign",
        slug: "test-campaign",
        status: "active",
      });

      // Mock JMAP Email/get to retrieve original sender
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          methodResponses: [
            [
              "Email/get",
              {
                list: [
                  {
                    from: [{ email: "sender@example.com" }],
                  },
                ],
              },
              "0",
            ],
          ],
        })
      );

      // Mock JMAP Email/set and EmailSubmission/set
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          methodResponses: [
            [
              "Email/set",
              {
                created: {
                  draft: {
                    id: "draft-123",
                  },
                },
              },
              "0",
            ],
            [
              "EmailSubmission/set",
              {
                created: {
                  submission: {
                    id: "submission-123",
                  },
                },
              },
              "1",
            ],
          ],
        })
      );

      const result = await sendAcknowledgmentEmail(db, 1);

      expect(result.success).toBe(true);
      expect(result.messageId).toBe("draft-123");
    });

    it("should handle missing politician credentials", async () => {
      const db = new DatabaseClient({
        url: "https://test.supabase.co",
        key: "test-key",
      });

      vi.spyOn(db, "getMessageById").mockResolvedValueOnce({
        id: 1,
        classification_confidence: 0.2,
        stalwart_message_id: "msg-123",
        stalwart_account_id: "politician@example.com",
        politician_id: 10,
        campaign_id: 5,
      });

      vi.spyOn(db, "getPoliticianById").mockResolvedValueOnce({
        id: 10,
        name: "Test Politician",
        email: "politician@example.com",
        additional_emails: [],
        active: true,
        stalwart_username: undefined,
        stalwart_app_password: undefined,
      });

      const result = await sendAcknowledgmentEmail(db, 1);

      expect(result.success).toBe(false);
      expect(result.error).toContain("missing JMAP credentials");
    });

    it("should handle message not found", async () => {
      const db = new DatabaseClient({
        url: "https://test.supabase.co",
        key: "test-key",
      });

      vi.spyOn(db, "getMessageById").mockResolvedValueOnce(null);

      const result = await sendAcknowledgmentEmail(db, 999);

      expect(result.success).toBe(false);
      expect(result.error).toBe("Message not found");
    });
  });
});
