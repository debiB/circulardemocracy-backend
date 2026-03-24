/**
 * BGE-M3 Message Classification Validation Test
 * 
 * This script validates the BGE-M3 message classification system by:
 * - Sending real messages through the API
 * - Using actual BGE-M3 model for embeddings (no mocking)
 * - Storing messages in the real database
 * - Verifying classification accuracy and confidence scores
 * - Analyzing uncategorized message rates
 */

import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";
import * as path from "path";

// Load environment variables
dotenv.config({ path: path.join(process.cwd(), ".env") });

interface TestMessage {
  id: string;
  topic: string;
  language: string;
  expectedCampaign?: string;
  sender_name: string;
  sender_email: string;
  subject: string;
  message: string;
}

interface TestResult {
  testMessage: TestMessage;
  response: any;
  dbRecord?: any;
  success: boolean;
  actualCampaign?: string;
  confidence?: number;
  embeddingDimensions?: number;
  error?: string;
}

interface ValidationMetrics {
  totalTests: number;
  successfulClassifications: number;
  uncategorizedCount: number;
  averageConfidence: number;
  confidenceDistribution: {
    high: number; // > 0.7
    medium: number; // 0.5 - 0.7
    low: number; // < 0.5
  };
  embeddingValidation: {
    correct1024Dimensions: number;
    incorrectDimensions: number;
  };
  accuracyByTopic: Map<string, { correct: number; total: number }>;
}

// Test messages covering different political topics
const TEST_MESSAGES: TestMessage[] = [
  // Climate Change - English
  {
    id: "climate-en-1",
    topic: "climate_change",
    language: "English",
    expectedCampaign: "climate",
    sender_name: "Sarah Johnson",
    sender_email: "sarah.j.test@example.com",
    subject: "Urgent Action Needed on Climate Crisis",
    message: "Dear Representative, I am deeply concerned about the accelerating climate crisis. We need immediate action to reduce carbon emissions, transition to renewable energy, and protect our environment for future generations. The recent extreme weather events in our district demonstrate the urgency of this issue. Please support comprehensive climate legislation and reject fossil fuel subsidies.",
  },
  {
    id: "climate-en-2",
    topic: "climate_change",
    language: "English",
    expectedCampaign: "climate",
    sender_name: "Michael Chen",
    sender_email: "m.chen.test@example.com",
    subject: "Support Clean Energy Transition",
    message: "I'm writing to urge you to support clean energy initiatives. Solar and wind power are the future, and we must invest in green infrastructure now. Climate change is real and threatens our coastal communities. Please vote yes on renewable energy bills and carbon pricing mechanisms.",
  },

  // Climate Change - French
  {
    id: "climate-fr-1",
    topic: "climate_change",
    language: "French",
    expectedCampaign: "climate",
    sender_name: "Marie Dubois",
    sender_email: "marie.d.test@example.com",
    subject: "Action climatique urgente nécessaire",
    message: "Madame la Députée, je vous écris pour exprimer ma profonde inquiétude concernant le changement climatique. Nous devons agir maintenant pour réduire les émissions de gaz à effet de serre et investir dans les énergies renouvelables. L'avenir de nos enfants en dépend. Veuillez soutenir les politiques environnementales ambitieuses.",
  },

  // Climate Change - Spanish
  {
    id: "climate-es-1",
    topic: "climate_change",
    language: "Spanish",
    expectedCampaign: "climate",
    sender_name: "Carlos Rodriguez",
    sender_email: "carlos.r.test@example.com",
    subject: "Acción climática ahora",
    message: "Estimado Representante, le escribo para pedirle que apoye políticas fuertes contra el cambio climático. Necesitamos energía limpia, protección de nuestros bosques y océanos, y reducción de emisiones de carbono. El futuro de nuestro planeta está en juego.",
  },

  // Healthcare Reform
  {
    id: "healthcare-en-1",
    topic: "healthcare",
    language: "English",
    expectedCampaign: "healthcare",
    sender_name: "Jennifer Williams",
    sender_email: "j.williams.test@example.com",
    subject: "Healthcare is a Human Right",
    message: "Dear Senator, I am writing to advocate for universal healthcare coverage. Too many families in our community cannot afford basic medical care. We need Medicare for All, lower prescription drug prices, and protection for pre-existing conditions. Healthcare should be a right, not a privilege for the wealthy.",
  },
  {
    id: "healthcare-en-2",
    topic: "healthcare",
    language: "English",
    expectedCampaign: "healthcare",
    sender_name: "Robert Martinez",
    sender_email: "r.martinez.test@example.com",
    subject: "Lower Prescription Drug Costs",
    message: "I'm a senior citizen struggling to afford my medications. Please support legislation to allow Medicare to negotiate drug prices and cap out-of-pocket costs for prescriptions. Many of us are choosing between medicine and food. This is unacceptable in a wealthy nation.",
  },

  // Education Funding
  {
    id: "education-en-1",
    topic: "education",
    language: "English",
    expectedCampaign: "education",
    sender_name: "Lisa Thompson",
    sender_email: "l.thompson.test@example.com",
    subject: "Invest in Our Schools",
    message: "Dear Representative, as a public school teacher, I see firsthand how underfunding hurts our students. We need smaller class sizes, better resources, higher teacher salaries, and universal pre-K. Please vote to increase education funding and oppose school privatization schemes.",
  },
  {
    id: "education-en-2",
    topic: "education",
    language: "English",
    expectedCampaign: "education",
    sender_name: "David Kim",
    sender_email: "d.kim.test@example.com",
    subject: "Student Debt Relief Needed",
    message: "I'm writing about the student debt crisis. Millions of young people are burdened with crushing loans that prevent them from buying homes or starting families. Please support student loan forgiveness and make public colleges tuition-free. Education is an investment in our future.",
  },

  // Mixed/Ambiguous Messages
  {
    id: "mixed-1",
    topic: "mixed",
    language: "English",
    sender_name: "Amanda Brown",
    sender_email: "a.brown.test@example.com",
    subject: "Multiple Concerns from Your Constituent",
    message: "Dear Senator, I have several concerns I'd like to share. First, we need action on climate change and renewable energy. Second, healthcare costs are too high and we need reform. Third, our schools are underfunded. Finally, infrastructure in our district is crumbling. Please address these critical issues.",
  },
  {
    id: "mixed-2",
    topic: "mixed",
    language: "English",
    sender_name: "James Wilson",
    sender_email: "j.wilson.test@example.com",
    subject: "Community Issues",
    message: "I'm concerned about our community's future. We need better jobs, improved public transportation, and safer neighborhoods. Also, please support small businesses and local farmers. Thank you for your service.",
  },

  // Edge Cases - Very Short
  {
    id: "edge-short-1",
    topic: "edge_case",
    language: "English",
    sender_name: "Tom Short",
    sender_email: "t.short.test@example.com",
    subject: "Climate",
    message: "Please vote yes on climate bill. Thank you.",
  },

  // Edge Cases - Very Long
  {
    id: "edge-long-1",
    topic: "edge_case",
    language: "English",
    sender_name: "Patricia Long",
    sender_email: "p.long.test@example.com",
    subject: "Comprehensive Policy Recommendations for Climate Action",
    message: "Dear Representative, I am writing to provide detailed recommendations on climate policy. " +
      "First, we must transition to 100% renewable energy by 2035. This requires massive investment in solar, wind, and battery storage infrastructure. " +
      "Second, we need a carbon tax starting at $50 per ton and increasing annually. Revenue should fund clean energy rebates for low-income families. " +
      "Third, end all fossil fuel subsidies immediately and redirect those funds to green technology research and development. " +
      "Fourth, protect and expand our forests and wetlands which serve as critical carbon sinks. " +
      "Fifth, invest in public transportation to reduce vehicle emissions. " +
      "Sixth, implement strict emissions standards for all industries. " +
      "Seventh, support international climate agreements and provide climate finance to developing nations. " +
      "Eighth, create green jobs programs to ensure a just transition for fossil fuel workers. " +
      "Ninth, mandate climate risk disclosure for all publicly traded companies. " +
      "Tenth, invest in climate adaptation and resilience for vulnerable communities. " +
      "The science is clear - we have less than a decade to prevent catastrophic warming. " +
      "Every day of delay makes the problem worse and the solutions more expensive. " +
      "Our children and grandchildren are counting on us to act with the urgency this crisis demands. " +
      "I urge you to make climate action your top priority and to reject any compromise that fails to meet the scale of the challenge.",
  },

  // Unclear/Generic Message
  {
    id: "unclear-1",
    topic: "unclear",
    language: "English",
    sender_name: "Generic Voter",
    sender_email: "voter.test@example.com",
    subject: "Thank you",
    message: "Thank you for your service to our district. Keep up the good work representing us.",
  },
];

class BGE_M3_ValidationTest {
  private apiUrl: string;
  private apiKey: string;
  private supabase: any;
  private politicianEmail: string = "";
  private results: TestResult[] = [];

  constructor() {
    this.apiUrl = process.env.API_URL || "http://localhost:3000";
    this.apiKey = process.env.API_KEY || "";

    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_KEY) {
      throw new Error("SUPABASE_URL and SUPABASE_KEY must be set in .env");
    }

    this.supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_KEY
    );
  }

  /**
   * Initialize test by finding a real politician email from database
   */
  async initialize(): Promise<void> {
    console.log("🔍 Initializing test - fetching politician from database...");

    const { data: politicians, error } = await this.supabase
      .from("politicians")
      .select("email, name")
      .eq("active", true)
      .limit(1);

    if (error || !politicians || politicians.length === 0) {
      throw new Error("No active politicians found in database");
    }

    this.politicianEmail = politicians[0].email;
    console.log(`✅ Using politician: ${politicians[0].name} (${this.politicianEmail})\n`);
  }

  /**
   * Send a test message through the API
   */
  async sendMessage(testMsg: TestMessage): Promise<any> {
    const payload = {
      external_id: `test-${testMsg.id}-${Date.now()}`,
      sender_name: testMsg.sender_name,
      sender_email: testMsg.sender_email,
      recipient_email: this.politicianEmail,
      subject: testMsg.subject,
      message: testMsg.message,
      text_content: testMsg.message,
      timestamp: new Date().toISOString(),
      channel_source: "bge-m3-validation-test",
    };

    // Create AbortController with 5 minute timeout for model loading
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 300000); // 5 minutes

    try {
      const response = await fetch(`${this.apiUrl}/api/v1/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      const data = await response.json();

      return {
        http_status: response.status,
        ...data,
      };
    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  }

  /**
   * Verify message in database and check embedding dimensions
   */
  async verifyInDatabase(messageId: number): Promise<any> {
    const { data, error } = await this.supabase
      .from("messages")
      .select(`
        id,
        campaign_id,
        classification_confidence,
        message_embedding,
        duplicate_rank,
        campaigns (
          id,
          name,
          slug
        )
      `)
      .eq("id", messageId)
      .single();

    if (error) {
      console.error("Database verification error:", error);
      return null;
    }

    return data;
  }

  /**
   * Run a single test case
   */
  async runTest(testMsg: TestMessage): Promise<TestResult> {
    console.log(`\n📝 Testing: ${testMsg.id} (${testMsg.topic} - ${testMsg.language})`);
    console.log(`   Subject: "${testMsg.subject}"`);

    try {
      // Send message through API
      const response = await this.sendMessage(testMsg);

      if (response.http_status !== 200 || !response.success) {
        console.log(`   ❌ API Error: HTTP ${response.http_status}`);
        console.log(`   Response:`, JSON.stringify(response, null, 2));
        return {
          testMessage: testMsg,
          response,
          success: false,
          error: response.error || response.message || `HTTP ${response.http_status}`,
        };
      }

      console.log(`   ✅ API Response: HTTP ${response.http_status}`);
      console.log(`   Campaign: ${response.campaign_name} (confidence: ${response.confidence?.toFixed(3)})`);

      // Verify in database
      const dbRecord = await this.verifyInDatabase(response.message_id);

      if (!dbRecord) {
        return {
          testMessage: testMsg,
          response,
          success: false,
          error: "Message not found in database",
        };
      }

      // Check embedding dimensions
      let embedding = dbRecord.message_embedding;

      // If embedding is a string, parse it
      if (typeof embedding === 'string') {
        try {
          embedding = JSON.parse(embedding);
        } catch (e) {
          console.log(`   ⚠️  Could not parse embedding`);
        }
      }

      const embeddingDimensions = Array.isArray(embedding) ? embedding.length : 0;
      const embeddingCorrect = embeddingDimensions === 1024;

      console.log(`   📊 Embedding: ${embeddingDimensions} dimensions ${embeddingCorrect ? "✅" : "❌"}`);

      // Extract campaign name
      const campaignName = dbRecord.campaigns?.name || "Unknown";

      return {
        testMessage: testMsg,
        response,
        dbRecord,
        success: true,
        actualCampaign: campaignName,
        confidence: dbRecord.classification_confidence,
        embeddingDimensions,
      };

    } catch (error) {
      console.error(`   ❌ Error:`, error);
      return {
        testMessage: testMsg,
        response: null,
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Run all test cases
   */
  async runAllTests(): Promise<void> {
    console.log(`\n${"=".repeat(80)}`);
    console.log("🚀 Starting BGE-M3 Classification Validation Tests");
    console.log(`${"=".repeat(80)}`);
    console.log(`Total test messages: ${TEST_MESSAGES.length}`);
    console.log(`\n⏳ Note: First request may take 2-5 minutes while BGE-M3 model downloads...`);

    for (const testMsg of TEST_MESSAGES) {
      const result = await this.runTest(testMsg);
      this.results.push(result);

      // Small delay between tests to avoid overwhelming the API
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }

  /**
   * Calculate and display metrics
   */
  calculateMetrics(): ValidationMetrics {
    const metrics: ValidationMetrics = {
      totalTests: this.results.length,
      successfulClassifications: 0,
      uncategorizedCount: 0,
      averageConfidence: 0,
      confidenceDistribution: {
        high: 0,
        medium: 0,
        low: 0,
      },
      embeddingValidation: {
        correct1024Dimensions: 0,
        incorrectDimensions: 0,
      },
      accuracyByTopic: new Map(),
    };

    let totalConfidence = 0;
    let confidenceCount = 0;

    for (const result of this.results) {
      if (!result.success) continue;

      metrics.successfulClassifications++;

      // Check if uncategorized
      if (result.actualCampaign?.toLowerCase().includes("uncategorized")) {
        metrics.uncategorizedCount++;
      }

      // Confidence distribution
      if (result.confidence !== undefined) {
        totalConfidence += result.confidence;
        confidenceCount++;

        if (result.confidence > 0.7) {
          metrics.confidenceDistribution.high++;
        } else if (result.confidence >= 0.5) {
          metrics.confidenceDistribution.medium++;
        } else {
          metrics.confidenceDistribution.low++;
        }
      }

      // Embedding validation
      if (result.embeddingDimensions === 1024) {
        metrics.embeddingValidation.correct1024Dimensions++;
      } else {
        metrics.embeddingValidation.incorrectDimensions++;
      }

      // Accuracy by topic
      const topic = result.testMessage.topic;
      if (!metrics.accuracyByTopic.has(topic)) {
        metrics.accuracyByTopic.set(topic, { correct: 0, total: 0 });
      }

      const topicStats = metrics.accuracyByTopic.get(topic)!;
      topicStats.total++;

      // Check if classification matches expected (if provided)
      if (result.testMessage.expectedCampaign) {
        const expectedMatch = result.actualCampaign?.toLowerCase().includes(
          result.testMessage.expectedCampaign.toLowerCase()
        );
        if (expectedMatch) {
          topicStats.correct++;
        }
      }
    }

    metrics.averageConfidence = confidenceCount > 0 ? totalConfidence / confidenceCount : 0;

    return metrics;
  }

  /**
   * Display detailed results
   */
  displayResults(): void {
    console.log(`\n${"=".repeat(80)}`);
    console.log("📊 TEST RESULTS");
    console.log(`${"=".repeat(80)}\n`);

    const metrics = this.calculateMetrics();

    // Overall Statistics
    console.log("📈 OVERALL STATISTICS");
    console.log("-".repeat(80));
    console.log(`Total Tests:              ${metrics.totalTests}`);
    console.log(`Successful:               ${metrics.successfulClassifications}`);
    console.log(`Failed:                   ${metrics.totalTests - metrics.successfulClassifications}`);
    console.log(`Uncategorized:            ${metrics.uncategorizedCount} (${(metrics.uncategorizedCount / metrics.successfulClassifications * 100).toFixed(1)}%)`);
    console.log(`Average Confidence:       ${metrics.averageConfidence.toFixed(3)}`);

    // Confidence Distribution
    console.log(`\n🎯 CONFIDENCE DISTRIBUTION`);
    console.log("-".repeat(80));
    console.log(`High (> 0.7):             ${metrics.confidenceDistribution.high} (${(metrics.confidenceDistribution.high / metrics.successfulClassifications * 100).toFixed(1)}%)`);
    console.log(`Medium (0.5 - 0.7):       ${metrics.confidenceDistribution.medium} (${(metrics.confidenceDistribution.medium / metrics.successfulClassifications * 100).toFixed(1)}%)`);
    console.log(`Low (< 0.5):              ${metrics.confidenceDistribution.low} (${(metrics.confidenceDistribution.low / metrics.successfulClassifications * 100).toFixed(1)}%)`);

    // Embedding Validation
    console.log(`\n🔢 EMBEDDING VALIDATION`);
    console.log("-".repeat(80));
    console.log(`Correct (1024 dims):      ${metrics.embeddingValidation.correct1024Dimensions}`);
    console.log(`Incorrect:                ${metrics.embeddingValidation.incorrectDimensions}`);

    // Accuracy by Topic
    console.log(`\n📚 ACCURACY BY TOPIC`);
    console.log("-".repeat(80));
    const topicEntries = Array.from(metrics.accuracyByTopic.entries());
    for (let i = 0; i < topicEntries.length; i++) {
      const [topic, stats] = topicEntries[i];
      const accuracy = stats.total > 0 ? (stats.correct / stats.total * 100).toFixed(1) : "N/A";
      console.log(`${topic.padEnd(20)} ${stats.correct}/${stats.total} (${accuracy}%)`);
    }

    // Detailed Results Table
    console.log(`\n📋 DETAILED RESULTS`);
    console.log("-".repeat(80));
    console.log("ID".padEnd(20) + "Topic".padEnd(20) + "Campaign".padEnd(25) + "Confidence");
    console.log("-".repeat(80));

    for (const result of this.results) {
      if (!result.success) {
        console.log(`${result.testMessage.id.padEnd(20)}${result.testMessage.topic.padEnd(20)}${"ERROR".padEnd(25)}${result.error || "Unknown"}`);
        continue;
      }

      const campaign = (result.actualCampaign || "Unknown").substring(0, 24);
      const confidence = result.confidence?.toFixed(3) || "N/A";

      console.log(
        result.testMessage.id.padEnd(20) +
        result.testMessage.topic.padEnd(20) +
        campaign.padEnd(25) +
        confidence
      );
    }

    // Misclassifications
    console.log(`\n⚠️  POTENTIAL MISCLASSIFICATIONS`);
    console.log("-".repeat(80));

    let misclassificationCount = 0;
    for (const result of this.results) {
      if (!result.success || !result.testMessage.expectedCampaign) continue;

      const expectedMatch = result.actualCampaign?.toLowerCase().includes(
        result.testMessage.expectedCampaign.toLowerCase()
      );

      if (!expectedMatch) {
        misclassificationCount++;
        console.log(`${result.testMessage.id}:`);
        console.log(`  Expected: ${result.testMessage.expectedCampaign}`);
        console.log(`  Actual:   ${result.actualCampaign} (confidence: ${result.confidence?.toFixed(3)})`);
        console.log(`  Message:  "${result.testMessage.subject}"`);
        console.log();
      }
    }

    if (misclassificationCount === 0) {
      console.log("✅ No misclassifications detected!");
    }

    // Recommendations
    console.log(`\n💡 RECOMMENDATIONS`);
    console.log("-".repeat(80));

    if (metrics.uncategorizedCount / metrics.successfulClassifications > 0.3) {
      console.log("⚠️  High uncategorized rate (>30%). Consider:");
      console.log("   - Adding more campaign reference vectors");
      console.log("   - Lowering similarity threshold");
      console.log("   - Reviewing campaign descriptions");
    }

    if (metrics.confidenceDistribution.low / metrics.successfulClassifications > 0.4) {
      console.log("⚠️  Many low-confidence classifications (>40%). Consider:");
      console.log("   - Improving campaign reference vectors");
      console.log("   - Adding more training examples");
      console.log("   - Reviewing classification threshold");
    }

    if (metrics.embeddingValidation.incorrectDimensions > 0) {
      console.log("❌ Embedding dimension errors detected!");
      console.log("   - Check BGE-M3 model configuration");
      console.log("   - Verify database schema for message_embedding field");
    }

    if (metrics.averageConfidence > 0.7) {
      console.log("✅ Good average confidence score!");
    }

    if (metrics.embeddingValidation.correct1024Dimensions === metrics.successfulClassifications) {
      console.log("✅ All embeddings have correct 1024 dimensions!");
    }

    console.log(`\n${"=".repeat(80)}`);
    console.log("✅ Validation Complete!");
    console.log(`${"=".repeat(80)}\n`);
  }

  /**
   * Query database for additional analysis
   */
  async performDatabaseAnalysis(): Promise<void> {
    console.log(`\n${"=".repeat(80)}`);
    console.log("🔍 DATABASE ANALYSIS");
    console.log(`${"=".repeat(80)}\n`);

    // Get campaign distribution
    console.log("📊 Campaign Distribution:");
    console.log("-".repeat(80));

    const { data: campaignStats, error } = await this.supabase
      .from("messages")
      .select("campaign_id, campaigns(name)")
      .eq("channel_source", "bge-m3-validation-test");

    if (!error && campaignStats) {
      const distribution = new Map<string, number>();

      for (const msg of campaignStats) {
        const campaignName = msg.campaigns?.name || "Unknown";
        distribution.set(campaignName, (distribution.get(campaignName) || 0) + 1);
      }

      const distributionEntries = Array.from(distribution.entries());
      for (let i = 0; i < distributionEntries.length; i++) {
        const [campaign, count] = distributionEntries[i];
        console.log(`${campaign.padEnd(30)} ${count} messages`);
      }
    }

    // Get confidence statistics
    console.log(`\n📈 Confidence Score Statistics:`);
    console.log("-".repeat(80));

    const { data: confidenceData, error: confError } = await this.supabase
      .from("messages")
      .select("classification_confidence")
      .eq("channel_source", "bge-m3-validation-test")
      .order("classification_confidence", { ascending: false });

    if (!confError && confidenceData && confidenceData.length > 0) {
      const confidences = confidenceData.map((d: any) => d.classification_confidence);
      const max = Math.max(...confidences);
      const min = Math.min(...confidences);
      const median = confidences[Math.floor(confidences.length / 2)];

      console.log(`Maximum:  ${max.toFixed(3)}`);
      console.log(`Minimum:  ${min.toFixed(3)}`);
      console.log(`Median:   ${median.toFixed(3)}`);
    }
  }
}

// Main execution
async function main() {
  try {
    const test = new BGE_M3_ValidationTest();

    await test.initialize();
    await test.runAllTests();
    test.displayResults();
    await test.performDatabaseAnalysis();

  } catch (error) {
    console.error("\n❌ Test execution failed:", error);
    process.exit(1);
  }
}

main();
