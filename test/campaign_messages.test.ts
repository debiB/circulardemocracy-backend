import { describe, it, expect, vi, beforeEach } from "vitest";
import app from "../src/api";

// --- Create a singleton mock instance ---
const mockDbInstance = {
  request: vi.fn(),
  getCampaignMessages: vi.fn(),
};

// --- Mock the entire database module ---
vi.mock("../src/database", () => ({
  DatabaseClient: vi.fn(() => mockDbInstance),
  hashEmail: vi.fn().mockResolvedValue("hashed-email"),
}));

// Mock JWT validation to always succeed for authenticated tests
vi.mock("hono/jwk", () => ({
  jwk: () => async (c: any, next: any) => {
    // Simulate successful JWT validation
    await next();
  },
}));

describe("Campaign Messages API - Filtering", () => {
  const env = {
    SUPABASE_URL: "https://test.supabase.co",
    SUPABASE_KEY: "test-key",
  };

  const mockMessages = [
    {
      id: 1,
      external_id: "msg-001",
      channel: "email",
      channel_source: "stalwart",
      politician_id: 5,
      sender_hash: "hash1",
      campaign_id: 42,
      classification_confidence: 0.95,
      language: "en",
      received_at: "2026-03-10T10:00:00Z",
      processed_at: "2026-03-10T10:00:05Z",
      duplicate_rank: 0,
      processing_status: "processed",
      stalwart_message_id: "jmap-001",
      stalwart_account_id: "acc-001",
    },
    {
      id: 2,
      external_id: "msg-002",
      channel: "email",
      channel_source: "stalwart",
      politician_id: 5,
      sender_hash: "hash2",
      campaign_id: 42,
      classification_confidence: 0.85,
      language: "en",
      received_at: "2026-03-12T14:30:00Z",
      processed_at: "2026-03-12T14:30:05Z",
      duplicate_rank: 0,
      processing_status: "processed",
      stalwart_message_id: "jmap-002",
      stalwart_account_id: "acc-001",
    },
    {
      id: 3,
      external_id: "msg-003",
      channel: "email",
      channel_source: "stalwart",
      politician_id: 5,
      sender_hash: "hash1",
      campaign_id: 42,
      classification_confidence: 0.92,
      language: "en",
      received_at: "2026-03-15T09:15:00Z",
      processed_at: "2026-03-15T09:15:05Z",
      duplicate_rank: 1,
      processing_status: "processed",
      stalwart_message_id: "jmap-003",
      stalwart_account_id: "acc-001",
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // =============================================================================
  // INDIVIDUAL FILTERS
  // =============================================================================

  describe("Date Range Filtering", () => {
    it("should filter messages by startDate", async () => {
      mockDbInstance.request.mockResolvedValue([{ id: 42 }]);
      mockDbInstance.getCampaignMessages.mockResolvedValue({
        messages: [mockMessages[1], mockMessages[2]],
        pagination: {
          page: 1,
          pageSize: 20,
          totalCount: 3,
          totalPages: 1,
          filteredCount: 2,
        },
        filters: {
          startDate: "2026-03-12T00:00:00Z",
        },
      });

      const req = new Request(
        "http://localhost/api/v1/campaigns/42/messages?startDate=2026-03-12T00:00:00Z",
        {
          method: "GET",
          headers: {
            Authorization: "Bearer mock-jwt-token",
          },
        },
      );

      const res = await app.fetch(req, env);
      expect(res.status).toBe(200);

      const body = await res.json();
      // @ts-ignore
      expect(body.messages).toHaveLength(2);
      // @ts-ignore
      expect(body.pagination.filteredCount).toBe(2);
      // @ts-ignore
      expect(body.filters.startDate).toBe("2026-03-12T00:00:00Z");

      expect(mockDbInstance.getCampaignMessages).toHaveBeenCalledWith(42, {
        page: 1,
        pageSize: 20,
        startDate: "2026-03-12T00:00:00Z",
        endDate: undefined,
        minConfidence: undefined,
        maxConfidence: undefined,
        duplicateStatus: undefined,
        search: undefined,
      });
    });

    it("should filter messages by endDate", async () => {
      mockDbInstance.request.mockResolvedValue([{ id: 42 }]);
      mockDbInstance.getCampaignMessages.mockResolvedValue({
        messages: [mockMessages[0], mockMessages[1]],
        pagination: {
          page: 1,
          pageSize: 20,
          totalCount: 3,
          totalPages: 1,
          filteredCount: 2,
        },
        filters: {
          endDate: "2026-03-13T00:00:00Z",
        },
      });

      const req = new Request(
        "http://localhost/api/v1/campaigns/42/messages?endDate=2026-03-13T00:00:00Z",
        {
          method: "GET",
          headers: {
            Authorization: "Bearer mock-jwt-token",
          },
        },
      );

      const res = await app.fetch(req, env);
      expect(res.status).toBe(200);

      const body = await res.json();
      // @ts-ignore
      expect(body.pagination.filteredCount).toBe(2);
      // @ts-ignore
      expect(body.filters.endDate).toBe("2026-03-13T00:00:00Z");
    });

    it("should filter messages by date range (startDate and endDate)", async () => {
      mockDbInstance.request.mockResolvedValue([{ id: 42 }]);
      mockDbInstance.getCampaignMessages.mockResolvedValue({
        messages: [mockMessages[1]],
        pagination: {
          page: 1,
          pageSize: 20,
          totalCount: 3,
          totalPages: 1,
          filteredCount: 1,
        },
        filters: {
          startDate: "2026-03-11T00:00:00Z",
          endDate: "2026-03-13T00:00:00Z",
        },
      });

      const req = new Request(
        "http://localhost/api/v1/campaigns/42/messages?startDate=2026-03-11T00:00:00Z&endDate=2026-03-13T00:00:00Z",
        {
          method: "GET",
          headers: {
            Authorization: "Bearer mock-jwt-token",
          },
        },
      );

      const res = await app.fetch(req, env);
      expect(res.status).toBe(200);

      const body = await res.json();
      // @ts-ignore
      expect(body.pagination.filteredCount).toBe(1);
      // @ts-ignore
      expect(body.filters.startDate).toBe("2026-03-11T00:00:00Z");
      // @ts-ignore
      expect(body.filters.endDate).toBe("2026-03-13T00:00:00Z");
    });
  });

  describe("Confidence Range Filtering", () => {
    it("should filter messages by minConfidence", async () => {
      mockDbInstance.request.mockResolvedValue([{ id: 42 }]);
      mockDbInstance.getCampaignMessages.mockResolvedValue({
        messages: [mockMessages[0], mockMessages[2]],
        pagination: {
          page: 1,
          pageSize: 20,
          totalCount: 3,
          totalPages: 1,
          filteredCount: 2,
        },
        filters: {
          minConfidence: 0.9,
        },
      });

      const req = new Request(
        "http://localhost/api/v1/campaigns/42/messages?minConfidence=0.9",
        {
          method: "GET",
          headers: {
            Authorization: "Bearer mock-jwt-token",
          },
        },
      );

      const res = await app.fetch(req, env);
      expect(res.status).toBe(200);

      const body = await res.json();
      // @ts-ignore
      expect(body.pagination.filteredCount).toBe(2);
      // @ts-ignore
      expect(body.filters.minConfidence).toBe(0.9);

      expect(mockDbInstance.getCampaignMessages).toHaveBeenCalledWith(42, {
        page: 1,
        pageSize: 20,
        startDate: undefined,
        endDate: undefined,
        minConfidence: 0.9,
        maxConfidence: undefined,
        duplicateStatus: undefined,
        search: undefined,
      });
    });

    it("should filter messages by maxConfidence", async () => {
      mockDbInstance.request.mockResolvedValue([{ id: 42 }]);
      mockDbInstance.getCampaignMessages.mockResolvedValue({
        messages: [mockMessages[1]],
        pagination: {
          page: 1,
          pageSize: 20,
          totalCount: 3,
          totalPages: 1,
          filteredCount: 1,
        },
        filters: {
          maxConfidence: 0.9,
        },
      });

      const req = new Request(
        "http://localhost/api/v1/campaigns/42/messages?maxConfidence=0.9",
        {
          method: "GET",
          headers: {
            Authorization: "Bearer mock-jwt-token",
          },
        },
      );

      const res = await app.fetch(req, env);
      expect(res.status).toBe(200);

      const body = await res.json();
      // @ts-ignore
      expect(body.pagination.filteredCount).toBe(1);
      // @ts-ignore
      expect(body.filters.maxConfidence).toBe(0.9);
    });

    it("should filter messages by confidence range (min and max)", async () => {
      mockDbInstance.request.mockResolvedValue([{ id: 42 }]);
      mockDbInstance.getCampaignMessages.mockResolvedValue({
        messages: [mockMessages[1], mockMessages[2]],
        pagination: {
          page: 1,
          pageSize: 20,
          totalCount: 3,
          totalPages: 1,
          filteredCount: 2,
        },
        filters: {
          minConfidence: 0.8,
          maxConfidence: 0.93,
        },
      });

      const req = new Request(
        "http://localhost/api/v1/campaigns/42/messages?minConfidence=0.8&maxConfidence=0.93",
        {
          method: "GET",
          headers: {
            Authorization: "Bearer mock-jwt-token",
          },
        },
      );

      const res = await app.fetch(req, env);
      expect(res.status).toBe(200);

      const body = await res.json();
      // @ts-ignore
      expect(body.pagination.filteredCount).toBe(2);
      // @ts-ignore
      expect(body.filters.minConfidence).toBe(0.8);
      // @ts-ignore
      expect(body.filters.maxConfidence).toBe(0.93);
    });
  });

  describe("Duplicate Status Filtering", () => {
    it("should filter for original messages only (duplicate_rank = 0)", async () => {
      mockDbInstance.request.mockResolvedValue([{ id: 42 }]);
      mockDbInstance.getCampaignMessages.mockResolvedValue({
        messages: [mockMessages[0], mockMessages[1]],
        pagination: {
          page: 1,
          pageSize: 20,
          totalCount: 3,
          totalPages: 1,
          filteredCount: 2,
        },
        filters: {
          duplicateStatus: "original",
        },
      });

      const req = new Request(
        "http://localhost/api/v1/campaigns/42/messages?duplicateStatus=original",
        {
          method: "GET",
          headers: {
            Authorization: "Bearer mock-jwt-token",
          },
        },
      );

      const res = await app.fetch(req, env);
      expect(res.status).toBe(200);

      const body = await res.json();
      // @ts-ignore
      expect(body.pagination.filteredCount).toBe(2);
      // @ts-ignore
      expect(body.filters.duplicateStatus).toBe("original");

      expect(mockDbInstance.getCampaignMessages).toHaveBeenCalledWith(42, {
        page: 1,
        pageSize: 20,
        startDate: undefined,
        endDate: undefined,
        minConfidence: undefined,
        maxConfidence: undefined,
        duplicateStatus: "original",
        search: undefined,
      });
    });

    it("should filter for duplicate messages only (duplicate_rank > 0)", async () => {
      mockDbInstance.request.mockResolvedValue([{ id: 42 }]);
      mockDbInstance.getCampaignMessages.mockResolvedValue({
        messages: [mockMessages[2]],
        pagination: {
          page: 1,
          pageSize: 20,
          totalCount: 3,
          totalPages: 1,
          filteredCount: 1,
        },
        filters: {
          duplicateStatus: "duplicate",
        },
      });

      const req = new Request(
        "http://localhost/api/v1/campaigns/42/messages?duplicateStatus=duplicate",
        {
          method: "GET",
          headers: {
            Authorization: "Bearer mock-jwt-token",
          },
        },
      );

      const res = await app.fetch(req, env);
      expect(res.status).toBe(200);

      const body = await res.json();
      // @ts-ignore
      expect(body.pagination.filteredCount).toBe(1);
      // @ts-ignore
      expect(body.filters.duplicateStatus).toBe("duplicate");
    });
  });

  describe("Search Filtering", () => {
    it("should filter messages by search term", async () => {
      mockDbInstance.request.mockResolvedValue([{ id: 42 }]);
      mockDbInstance.getCampaignMessages.mockResolvedValue({
        messages: [mockMessages[0], mockMessages[1]],
        pagination: {
          page: 1,
          pageSize: 20,
          totalCount: 3,
          totalPages: 1,
          filteredCount: 2,
        },
        filters: {
          search: "email",
        },
      });

      const req = new Request(
        "http://localhost/api/v1/campaigns/42/messages?search=email",
        {
          method: "GET",
          headers: {
            Authorization: "Bearer mock-jwt-token",
          },
        },
      );

      const res = await app.fetch(req, env);
      expect(res.status).toBe(200);

      const body = await res.json();
      // @ts-ignore
      expect(body.pagination.filteredCount).toBe(2);
      // @ts-ignore
      expect(body.filters.search).toBe("email");

      expect(mockDbInstance.getCampaignMessages).toHaveBeenCalledWith(42, {
        page: 1,
        pageSize: 20,
        startDate: undefined,
        endDate: undefined,
        minConfidence: undefined,
        maxConfidence: undefined,
        duplicateStatus: undefined,
        search: "email",
      });
    });

    it("should handle empty search results", async () => {
      mockDbInstance.request.mockResolvedValue([{ id: 42 }]);
      mockDbInstance.getCampaignMessages.mockResolvedValue({
        messages: [],
        pagination: {
          page: 1,
          pageSize: 20,
          totalCount: 3,
          totalPages: 0,
          filteredCount: 0,
        },
        filters: {
          search: "nonexistent",
        },
      });

      const req = new Request(
        "http://localhost/api/v1/campaigns/42/messages?search=nonexistent",
        {
          method: "GET",
          headers: {
            Authorization: "Bearer mock-jwt-token",
          },
        },
      );

      const res = await app.fetch(req, env);
      expect(res.status).toBe(200);

      const body = await res.json();
      // @ts-ignore
      expect(body.messages).toHaveLength(0);
      // @ts-ignore
      expect(body.pagination.filteredCount).toBe(0);
    });
  });

  // =============================================================================
  // COMBINED FILTERS
  // =============================================================================

  describe("Combined Filters", () => {
    it("should apply multiple filters together", async () => {
      mockDbInstance.request.mockResolvedValue([{ id: 42 }]);
      mockDbInstance.getCampaignMessages.mockResolvedValue({
        messages: [mockMessages[1]],
        pagination: {
          page: 1,
          pageSize: 20,
          totalCount: 3,
          totalPages: 1,
          filteredCount: 1,
        },
        filters: {
          startDate: "2026-03-11T00:00:00Z",
          endDate: "2026-03-13T00:00:00Z",
          minConfidence: 0.8,
          duplicateStatus: "original",
        },
      });

      const req = new Request(
        "http://localhost/api/v1/campaigns/42/messages?startDate=2026-03-11T00:00:00Z&endDate=2026-03-13T00:00:00Z&minConfidence=0.8&duplicateStatus=original",
        {
          method: "GET",
          headers: {
            Authorization: "Bearer mock-jwt-token",
          },
        },
      );

      const res = await app.fetch(req, env);
      expect(res.status).toBe(200);

      const body = await res.json();
      // @ts-ignore
      expect(body.pagination.filteredCount).toBe(1);
      // @ts-ignore
      expect(body.filters.startDate).toBe("2026-03-11T00:00:00Z");
      // @ts-ignore
      expect(body.filters.endDate).toBe("2026-03-13T00:00:00Z");
      // @ts-ignore
      expect(body.filters.minConfidence).toBe(0.8);
      // @ts-ignore
      expect(body.filters.duplicateStatus).toBe("original");

      expect(mockDbInstance.getCampaignMessages).toHaveBeenCalledWith(42, {
        page: 1,
        pageSize: 20,
        startDate: "2026-03-11T00:00:00Z",
        endDate: "2026-03-13T00:00:00Z",
        minConfidence: 0.8,
        maxConfidence: undefined,
        duplicateStatus: "original",
        search: undefined,
      });
    });

    it("should apply all filters including search", async () => {
      mockDbInstance.request.mockResolvedValue([{ id: 42 }]);
      mockDbInstance.getCampaignMessages.mockResolvedValue({
        messages: [],
        pagination: {
          page: 1,
          pageSize: 20,
          totalCount: 3,
          totalPages: 0,
          filteredCount: 0,
        },
        filters: {
          startDate: "2026-03-01T00:00:00Z",
          endDate: "2026-03-31T23:59:59Z",
          minConfidence: 0.9,
          maxConfidence: 1.0,
          duplicateStatus: "original",
          search: "climate",
        },
      });

      const req = new Request(
        "http://localhost/api/v1/campaigns/42/messages?startDate=2026-03-01T00:00:00Z&endDate=2026-03-31T23:59:59Z&minConfidence=0.9&maxConfidence=1.0&duplicateStatus=original&search=climate",
        {
          method: "GET",
          headers: {
            Authorization: "Bearer mock-jwt-token",
          },
        },
      );

      const res = await app.fetch(req, env);
      expect(res.status).toBe(200);

      const body = await res.json();
      // @ts-ignore
      expect(body.filters.startDate).toBe("2026-03-01T00:00:00Z");
      // @ts-ignore
      expect(body.filters.endDate).toBe("2026-03-31T23:59:59Z");
      // @ts-ignore
      expect(body.filters.minConfidence).toBe(0.9);
      // @ts-ignore
      expect(body.filters.maxConfidence).toBe(1.0);
      // @ts-ignore
      expect(body.filters.duplicateStatus).toBe("original");
      // @ts-ignore
      expect(body.filters.search).toBe("climate");
    });
  });

  // =============================================================================
  // PAGINATION
  // =============================================================================

  describe("Pagination", () => {
    it("should use default pagination (page 1, pageSize 20)", async () => {
      mockDbInstance.request.mockResolvedValue([{ id: 42 }]);
      mockDbInstance.getCampaignMessages.mockResolvedValue({
        messages: mockMessages,
        pagination: {
          page: 1,
          pageSize: 20,
          totalCount: 3,
          totalPages: 1,
          filteredCount: 3,
        },
        filters: {},
      });

      const req = new Request("http://localhost/api/v1/campaigns/42/messages", {
        method: "GET",
        headers: {
          Authorization: "Bearer mock-jwt-token",
        },
      });

      const res = await app.fetch(req, env);
      expect(res.status).toBe(200);

      const body = await res.json();
      // @ts-ignore
      expect(body.pagination.page).toBe(1);
      // @ts-ignore
      expect(body.pagination.pageSize).toBe(20);

      expect(mockDbInstance.getCampaignMessages).toHaveBeenCalledWith(42, {
        page: 1,
        pageSize: 20,
        startDate: undefined,
        endDate: undefined,
        minConfidence: undefined,
        maxConfidence: undefined,
        duplicateStatus: undefined,
        search: undefined,
      });
    });

    it("should handle custom page and pageSize", async () => {
      mockDbInstance.request.mockResolvedValue([{ id: 42 }]);
      mockDbInstance.getCampaignMessages.mockResolvedValue({
        messages: [mockMessages[1]],
        pagination: {
          page: 2,
          pageSize: 1,
          totalCount: 3,
          totalPages: 3,
          filteredCount: 3,
        },
        filters: {},
      });

      const req = new Request(
        "http://localhost/api/v1/campaigns/42/messages?page=2&pageSize=1",
        {
          method: "GET",
          headers: {
            Authorization: "Bearer mock-jwt-token",
          },
        },
      );

      const res = await app.fetch(req, env);
      expect(res.status).toBe(200);

      const body = await res.json();
      // @ts-ignore
      expect(body.pagination.page).toBe(2);
      // @ts-ignore
      expect(body.pagination.pageSize).toBe(1);
      // @ts-ignore
      expect(body.messages).toHaveLength(1);

      expect(mockDbInstance.getCampaignMessages).toHaveBeenCalledWith(42, {
        page: 2,
        pageSize: 1,
        startDate: undefined,
        endDate: undefined,
        minConfidence: undefined,
        maxConfidence: undefined,
        duplicateStatus: undefined,
        search: undefined,
      });
    });

    it("should return correct filteredCount vs totalCount", async () => {
      mockDbInstance.request.mockResolvedValue([{ id: 42 }]);
      mockDbInstance.getCampaignMessages.mockResolvedValue({
        messages: [mockMessages[0], mockMessages[1]],
        pagination: {
          page: 1,
          pageSize: 20,
          totalCount: 100,
          totalPages: 1,
          filteredCount: 2,
        },
        filters: {
          minConfidence: 0.9,
        },
      });

      const req = new Request(
        "http://localhost/api/v1/campaigns/42/messages?minConfidence=0.9",
        {
          method: "GET",
          headers: {
            Authorization: "Bearer mock-jwt-token",
          },
        },
      );

      const res = await app.fetch(req, env);
      expect(res.status).toBe(200);

      const body = await res.json();
      // @ts-ignore
      expect(body.pagination.totalCount).toBe(100);
      // @ts-ignore
      expect(body.pagination.filteredCount).toBe(2);
    });

    it("should calculate totalPages correctly based on filteredCount", async () => {
      mockDbInstance.request.mockResolvedValue([{ id: 42 }]);
      mockDbInstance.getCampaignMessages.mockResolvedValue({
        messages: mockMessages.slice(0, 2),
        pagination: {
          page: 1,
          pageSize: 2,
          totalCount: 100,
          totalPages: 3,
          filteredCount: 5,
        },
        filters: {
          duplicateStatus: "original",
        },
      });

      const req = new Request(
        "http://localhost/api/v1/campaigns/42/messages?pageSize=2&duplicateStatus=original",
        {
          method: "GET",
          headers: {
            Authorization: "Bearer mock-jwt-token",
          },
        },
      );

      const res = await app.fetch(req, env);
      expect(res.status).toBe(200);

      const body = await res.json();
      // @ts-ignore
      expect(body.pagination.totalPages).toBe(3);
      // @ts-ignore
      expect(body.pagination.filteredCount).toBe(5);
      // @ts-ignore
      expect(body.pagination.pageSize).toBe(2);
    });
  });

  // =============================================================================
  // EDGE CASES
  // =============================================================================

  describe("Edge Cases", () => {
    it("should return empty results when no messages match filters", async () => {
      mockDbInstance.request.mockResolvedValue([{ id: 42 }]);
      mockDbInstance.getCampaignMessages.mockResolvedValue({
        messages: [],
        pagination: {
          page: 1,
          pageSize: 20,
          totalCount: 3,
          totalPages: 0,
          filteredCount: 0,
        },
        filters: {
          minConfidence: 0.99,
        },
      });

      const req = new Request(
        "http://localhost/api/v1/campaigns/42/messages?minConfidence=0.99",
        {
          method: "GET",
          headers: {
            Authorization: "Bearer mock-jwt-token",
          },
        },
      );

      const res = await app.fetch(req, env);
      expect(res.status).toBe(200);

      const body = await res.json();
      // @ts-ignore
      expect(body.messages).toHaveLength(0);
      // @ts-ignore
      expect(body.pagination.filteredCount).toBe(0);
      // @ts-ignore
      expect(body.pagination.totalPages).toBe(0);
    });

    it("should return 404 when campaign does not exist", async () => {
      mockDbInstance.request.mockResolvedValue([]);

      const req = new Request(
        "http://localhost/api/v1/campaigns/99999/messages",
        {
          method: "GET",
          headers: {
            Authorization: "Bearer mock-jwt-token",
          },
        },
      );

      const res = await app.fetch(req, env);
      expect(res.status).toBe(404);

      const body = await res.json();
      // @ts-ignore
      expect(body.error).toBe("Campaign not found");

      expect(mockDbInstance.getCampaignMessages).not.toHaveBeenCalled();
    });

    it("should handle missing optional query parameters", async () => {
      mockDbInstance.request.mockResolvedValue([{ id: 42 }]);
      mockDbInstance.getCampaignMessages.mockResolvedValue({
        messages: mockMessages,
        pagination: {
          page: 1,
          pageSize: 20,
          totalCount: 3,
          totalPages: 1,
          filteredCount: 3,
        },
        filters: {},
      });

      const req = new Request("http://localhost/api/v1/campaigns/42/messages", {
        method: "GET",
        headers: {
          Authorization: "Bearer mock-jwt-token",
        },
      });

      const res = await app.fetch(req, env);
      expect(res.status).toBe(200);

      const body = await res.json();
      // @ts-ignore
      expect(body.messages).toHaveLength(3);
      // @ts-ignore
      expect(body.filters).toEqual({});
    });

    it("should handle page beyond available results", async () => {
      mockDbInstance.request.mockResolvedValue([{ id: 42 }]);
      mockDbInstance.getCampaignMessages.mockResolvedValue({
        messages: [],
        pagination: {
          page: 10,
          pageSize: 20,
          totalCount: 3,
          totalPages: 1,
          filteredCount: 3,
        },
        filters: {},
      });

      const req = new Request(
        "http://localhost/api/v1/campaigns/42/messages?page=10",
        {
          method: "GET",
          headers: {
            Authorization: "Bearer mock-jwt-token",
          },
        },
      );

      const res = await app.fetch(req, env);
      expect(res.status).toBe(200);

      const body = await res.json();
      // @ts-ignore
      expect(body.messages).toHaveLength(0);
      // @ts-ignore
      expect(body.pagination.page).toBe(10);
    });
  });

  // =============================================================================
  // ACCESS CONTROL
  // =============================================================================

  describe("Access Control", () => {
    // Note: Authentication is handled by authMiddleware which validates JWT tokens
    // In this test environment, we mock the JWT validation to always succeed
    // Real authentication testing should be done in integration tests with actual JWT tokens

    it("should accept valid authentication token", async () => {
      mockDbInstance.request.mockResolvedValue([{ id: 42 }]);
      mockDbInstance.getCampaignMessages.mockResolvedValue({
        messages: mockMessages,
        pagination: {
          page: 1,
          pageSize: 20,
          totalCount: 3,
          totalPages: 1,
          filteredCount: 3,
        },
        filters: {},
      });

      const req = new Request("http://localhost/api/v1/campaigns/42/messages", {
        method: "GET",
        headers: {
          Authorization: "Bearer mock-jwt-token",
        },
      });

      const res = await app.fetch(req, env);
      expect(res.status).toBe(200);
    });
  });

  // =============================================================================
  // VALIDATION
  // =============================================================================

  describe("Query Parameter Validation", () => {
    it("should reject invalid page parameter", async () => {
      const req = new Request(
        "http://localhost/api/v1/campaigns/42/messages?page=invalid",
        {
          method: "GET",
          headers: {
            Authorization: "Bearer mock-jwt-token",
          },
        },
      );

      const res = await app.fetch(req, env);
      expect(res.status).toBe(400);
    });

    it("should reject invalid pageSize parameter", async () => {
      const req = new Request(
        "http://localhost/api/v1/campaigns/42/messages?pageSize=abc",
        {
          method: "GET",
          headers: {
            Authorization: "Bearer mock-jwt-token",
          },
        },
      );

      const res = await app.fetch(req, env);
      expect(res.status).toBe(400);
    });

    // Note: The regex pattern /^[0-1](\.\d+)?$/ validates format but not numeric range
    // Values like "1.5" pass regex validation as they match the pattern
    // Additional numeric range validation would need to be added if strict 0-1 bounds are required

    it("should reject invalid duplicateStatus parameter", async () => {
      const req = new Request(
        "http://localhost/api/v1/campaigns/42/messages?duplicateStatus=maybe",
        {
          method: "GET",
          headers: {
            Authorization: "Bearer mock-jwt-token",
          },
        },
      );

      const res = await app.fetch(req, env);
      expect(res.status).toBe(400);
    });

    it("should reject invalid date format", async () => {
      const req = new Request(
        "http://localhost/api/v1/campaigns/42/messages?startDate=2026-03-01",
        {
          method: "GET",
          headers: {
            Authorization: "Bearer mock-jwt-token",
          },
        },
      );

      const res = await app.fetch(req, env);
      expect(res.status).toBe(400);
    });
  });
});
