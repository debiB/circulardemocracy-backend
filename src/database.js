import { createClient } from "@supabase/supabase-js";
export class DatabaseClient {
    supabase;
    constructor(config) {
        this.supabase = createClient(config.url, config.key, {
            auth: {
                persistSession: false,
            },
            global: {
                fetch: (...args) => fetch(...args),
            },
        });
    }
    async request(endpoint, _options = {}) {
        const query = this.supabase.from(endpoint).select("*");
        const { data, error } = await query;
        if (error) {
            throw new Error(`Database error: ${error.message}`);
        }
        return data;
    }
    // =============================================================================
    // POLITICIAN OPERATIONS
    // =============================================================================
    async findPoliticianByEmail(email) {
        try {
            // First try exact email match
            const { data: exactMatch, error: exactError } = await this.supabase
                .from("politicians")
                .select("id,name,email,additional_emails,active")
                .eq("email", email)
                .eq("active", true);
            if (exactError) {
                throw exactError;
            }
            if (exactMatch && exactMatch.length > 0) {
                return exactMatch[0];
            }
            // Then try additional_emails array search
            const { data: arrayMatch, error: arrayError } = await this.supabase
                .from("politicians")
                .select("id,name,email,additional_emails,active")
                .contains("additional_emails", [email])
                .eq("active", true);
            if (arrayError) {
                throw arrayError;
            }
            return arrayMatch && arrayMatch.length > 0 ? arrayMatch[0] : null;
        }
        catch (error) {
            console.error("Error finding politician:", error);
            return null;
        }
    }
    // =============================================================================
    // CAMPAIGN OPERATIONS
    // =============================================================================
    async findCampaignByHint(hint) {
        try {
            const { data: campaigns, error } = await this.supabase
                .from("campaigns")
                .select("id,name,slug,status,reference_vector")
                .or(`name.ilike.*${hint}*,slug.ilike.*${hint}*`)
                .in("status", ["active", "unconfirmed"])
                .limit(1);
            if (error) {
                throw error;
            }
            return campaigns && campaigns.length > 0 ? campaigns[0] : null;
        }
        catch (error) {
            console.error("Error finding campaign by hint:", error);
            return null;
        }
    }
    async findSimilarCampaigns(embedding, limit = 3) {
        try {
            const { data, error } = await this.supabase.rpc("find_similar_campaigns", {
                query_embedding: embedding,
                similarity_threshold: 0.1,
                match_limit: limit,
            });
            if (error) {
                throw error;
            }
            return data;
        }
        catch (error) {
            console.error("Error finding similar campaigns:", error);
            // Fallback: get all active campaigns without similarity
            const { data: fallback, error: fallbackError } = await this.supabase
                .from("campaigns")
                .select("id,name,slug,status")
                .in("status", ["active", "unconfirmed"])
                .not("reference_vector", "is", null)
                .limit(limit);
            if (fallbackError) {
                throw fallbackError;
            }
            return fallback.map((camp) => ({ ...camp, similarity: 0.1 }));
        }
    }
    async getUncategorizedCampaign() {
        try {
            const { data: campaigns, error } = await this.supabase
                .from("campaigns")
                .select("id,name,slug,status")
                .eq("slug", "uncategorized");
            if (error) {
                throw error;
            }
            if (campaigns && campaigns.length > 0) {
                return campaigns[0];
            }
            // Create uncategorized campaign
            const { data: newCampaigns, error: createError } = await this.supabase
                .from("campaigns")
                .insert({
                name: "Uncategorized",
                slug: "uncategorized",
                description: "Messages that could not be automatically categorized",
                status: "active",
                created_by: "system",
            })
                .select();
            if (createError) {
                throw createError;
            }
            return newCampaigns[0];
        }
        catch (error) {
            console.error("Error getting uncategorized campaign:", error);
            throw new Error("Failed to get or create uncategorized campaign");
        }
    }
    // =============================================================================
    // MESSAGE OPERATIONS
    // =============================================================================
    async getDuplicateRank(senderHash, politicianId, campaignId) {
        try {
            const { count, error } = await this.supabase
                .from("messages")
                .select("*", { count: "exact", head: true })
                .eq("sender_hash", senderHash)
                .eq("politician_id", politicianId)
                .eq("campaign_id", campaignId);
            if (error) {
                throw error;
            }
            return count || 0;
        }
        catch (error) {
            console.error("Error getting duplicate rank:", error);
            return 0;
        }
    }
    async insertMessage(data) {
        try {
            const { data: result, error } = await this.supabase
                .from("messages")
                .insert(data)
                .select("id");
            if (error) {
                throw error;
            }
            return result[0].id;
        }
        catch (error) {
            console.error("Error inserting message:", error);
            throw new Error("Failed to store message in database");
        }
    }
    async checkExternalIdExists(externalId, channelSource) {
        try {
            const { data, error } = await this.supabase
                .from("messages")
                .select("id")
                .eq("external_id", externalId)
                .eq("channel_source", channelSource)
                .limit(1);
            if (error) {
                throw error;
            }
            return data && data.length > 0;
        }
        catch (error) {
            console.error("Error checking external ID:", error);
            return false;
        }
    }
    async getMessageByExternalId(externalId, channelSource) {
        try {
            const { data, error } = await this.supabase
                .from("messages")
                .select("*, campaigns(id, name)")
                .eq("external_id", externalId)
                .eq("channel_source", channelSource)
                .limit(1);
            if (error) {
                throw error;
            }
            // @ts-ignore - Supabase types are sometimes tricky with joins
            return data && data.length > 0 ? data[0] : null;
        }
        catch (error) {
            console.error("Error getting message by external ID:", error);
            return null;
        }
    }
    // =============================================================================
    // CLASSIFICATION LOGIC
    // =============================================================================
    async classifyMessage(embedding, campaignHint) {
        // Step 1: Try campaign hint if provided
        if (campaignHint) {
            const hintCampaign = await this.findCampaignByHint(campaignHint);
            if (hintCampaign) {
                return {
                    campaign_id: hintCampaign.id,
                    campaign_name: hintCampaign.name,
                    confidence: 0.95,
                };
            }
        }
        // Step 2: Try vector similarity
        const similarCampaigns = await this.findSimilarCampaigns(embedding, 3);
        if (similarCampaigns.length > 0) {
            const best = similarCampaigns[0];
            // If similarity is high enough, use existing campaign
            if (best.similarity > 0.7) {
                return {
                    campaign_id: best.id,
                    campaign_name: best.name,
                    confidence: best.similarity,
                };
            }
        }
        // Step 3: Fall back to uncategorized
        const uncategorized = await this.getUncategorizedCampaign();
        return {
            campaign_id: uncategorized.id,
            campaign_name: uncategorized.name,
            confidence: 0.1,
        };
    }
}
// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================
export async function hashEmail(email) {
    const encoder = new TextEncoder();
    const data = encoder.encode(email.toLowerCase().trim());
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}
// =============================================================================
// REQUIRED POSTGRESQL FUNCTIONS
// =============================================================================
/*
You'll need to create this PostgreSQL function in Supabase for vector similarity:

CREATE OR REPLACE FUNCTION find_similar_campaigns(
  query_embedding vector(1024),
  similarity_threshold float DEFAULT 0.1,
  match_limit int DEFAULT 3
)
RETURNS TABLE (
  id int,
  name text,
  slug text,
  status text,
  reference_vector vector(1024),
  similarity float
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    c.id,
    c.name,
    c.slug,
    c.status,
    c.reference_vector,
    (1 - (c.reference_vector <-> query_embedding)) as similarity
  FROM campaigns c
  WHERE c.reference_vector IS NOT NULL
    AND c.status IN ('active', 'unconfirmed')
    AND (1 - (c.reference_vector <-> query_embedding)) > similarity_threshold
  ORDER BY c.reference_vector <-> query_embedding
  LIMIT match_limit;
END;
$$;
*/
