#!/usr/bin/env ts-node
import { createClient } from '@supabase/supabase-js';
import minimist from 'minimist';
import { generateEmbedding, formatEmailContentForEmbedding } from '../src/embedding_service';

// Parse arguments
const argv: {
  _: string[];
  name?: string;
  slug?: string;
  description?: string;
  url?: string;
  status: string;
} = minimist(process.argv.slice(2), {
  string: ['name', 'slug', 'description', 'url', 'status'],
  default: {
    status: 'active'
  }
}) as any;

async function addCampaign() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error('Error: SUPABASE_URL and SUPABASE_KEY environment variables must be set');
    process.exit(1);
  }

  const { name, slug, description, url, status } = argv;

  if (!name || !slug) {
    console.error(`
Usage: npm run add-campaign -- --name="Campaign Name" --slug="campaign-slug" [options]

Required:
  --name          Campaign name
  --slug          URL-friendly slug (lowercase, hyphens only)

Optional:
  --description   Campaign description
  --url           Campaign URL (for fetching content to generate embedding)
  --status        Campaign status (default: active)

Example:
  npm run add-campaign -- --name="GMO-free Demeter 2026" --slug="gmofree-demeter-2026" --description="Campaign for GMO-free agriculture" --url="https://gmofree_demeter_2026.proca.app/en"
`);
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    console.log(`\nAdding campaign: ${name}`);
    console.log(`Slug: ${slug}`);
    console.log(`Status: ${status}\n`);

    // Generate embedding if URL is provided
    let referenceVector: number[] | null = null;
    if (url) {
      console.log(`Fetching content from: ${url}`);
      try {
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(`Failed to fetch URL: ${response.statusText}`);
        }

        const html = await response.text();

        // Extract text content from HTML (simple approach)
        // Remove script and style tags
        let text = html
          .replace(/<script[^>]*>.*?<\/script>/gis, '')
          .replace(/<style[^>]*>.*?<\/style>/gis, '')
          // Remove HTML tags
          .replace(/<[^>]+>/g, ' ')
          // Decode common HTML entities
          .replace(/&nbsp;/g, ' ')
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"')
          // Normalize whitespace
          .replace(/\s+/g, ' ')
          .trim();

        // Limit text length for embedding
        text = text.substring(0, 8000);

        console.log(`Extracted ${text.length} characters from URL`);
        console.log('Generating reference vector embedding...');

        // Format as campaign description for embedding
        const formattedText = formatEmailContentForEmbedding(name, text);
        referenceVector = await generateEmbedding(null, formattedText);

        console.log(`✅ Generated ${referenceVector.length}-dimensional reference vector\n`);
      } catch (error) {
        console.error('Warning: Failed to generate reference vector from URL:', error instanceof Error ? error.message : error);
        console.log('Campaign will be created without reference vector.\n');
      }
    }

    // Prepare campaign data
    const campaignData: any = {
      name,
      slug,
      status,
      created_by: 'cli'
    };

    if (description) {
      campaignData.description = description;
    }

    if (referenceVector) {
      campaignData.reference_vector = `[${referenceVector.join(',')}]`;
      campaignData.vector_updated_at = new Date().toISOString();
    }

    // Insert campaign
    const { data, error } = await supabase
      .from('campaigns')
      .insert(campaignData)
      .select();

    if (error) {
      if (error.code === '23505') {
        console.error(`Error: Campaign with slug "${slug}" already exists`);
      } else {
        console.error('Error creating campaign:', error.message);
      }
      process.exit(1);
    }

    console.log('✅ Campaign created successfully!');
    console.log(JSON.stringify(data[0], null, 2));

    if (referenceVector) {
      console.log('\n✅ Reference vector has been set!');
      console.log('Messages will now be automatically classified to this campaign based on similarity.');
    } else {
      console.log('\nNext steps:');
      console.log('1. Provide a --url to generate a reference vector');
      console.log('2. Or messages matching this campaign will need manual classification');
    }

  } catch (error) {
    console.error('Failed to add campaign:', error);
    process.exit(1);
  }
}

addCampaign();
