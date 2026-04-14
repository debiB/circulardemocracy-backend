import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_KEY!
);

async function fixCampaignAssignments() {
  // Messages that were incorrectly changed from 476 to 472
  const messageIds = [
    'fuaaaabn', 'fqaaaabm', 'fmaaaabl', 'fiaaaabk', 'feaaaabj', 
    'eqaaaabe', 'emaaaabd', 'eiaaaabc', 'd2aaaaa3', 'dyaaaaa1', 
    'diaaaaa7', 'cqaaaaau', 'ceaaaaar', 'caaaaaaq', 'b2aaaaap', 
    'byaaaaao', 'bmaaaaal', 'biaaaaak', 'beaaaaaj', 'baaaaaai', 
    '2aaaaah', 'yaaaaag', 'uaaaaaf', 'qaaaaae', 'maaaaad', 
    'iaaaaac', 'eaaaaab'
  ];

  console.log('Reverting campaign assignments from 472 back to 476...');
  
  const { data, error } = await supabase
    .from('messages')
    .update({ campaign_id: 476 })
    .eq('campaign_id', 472)
    .in('external_id', messageIds);

  if (error) {
    console.error('Error reverting assignments:', error);
    process.exit(1);
  }

  console.log(`Successfully reverted ${messageIds.length} messages back to campaign 476`);
}

fixCampaignAssignments();
