/**
 * One-off script: finds the first publisher's user_id and creates
 * a content_sources row for https://opedd.com/feed.
 *
 * Usage: npx ts-node scripts/seed-content-source.ts
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseUrl || !serviceKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceKey);

async function main() {
  // 1. Find the publisher (and user_id)
  const { data: publisher, error: pubErr } = await supabase
    .from('publishers')
    .select('id, user_id, name')
    .limit(1)
    .single();

  if (pubErr || !publisher) {
    console.error('No publisher found:', pubErr?.message);
    process.exit(1);
  }

  console.log('Publisher found:');
  console.log('  id:      ', publisher.id);
  console.log('  user_id: ', publisher.user_id);
  console.log('  name:    ', publisher.name);

  // 2. Check if a content_source already exists for this URL + user
  const feedUrl = 'https://opedd.com/feed';

  const { data: existing } = await supabase
    .from('content_sources')
    .select('id')
    .eq('user_id', publisher.user_id)
    .eq('url', feedUrl)
    .maybeSingle();

  if (existing) {
    console.log('\nContent source already exists:', existing.id);
    console.log('No insert needed.');
    process.exit(0);
  }

  // 3. Insert the content source
  const crypto = await import('crypto');
  const verificationToken = 'OPEDD-' + crypto.randomBytes(16).toString('hex');

  const { data: source, error: insertErr } = await supabase
    .from('content_sources')
    .insert({
      user_id: publisher.user_id,
      source_type: 'substack',
      url: feedUrl,
      name: 'Opedd',
      verification_status: 'pending',
      verification_token: verificationToken,
    })
    .select()
    .single();

  if (insertErr) {
    console.error('\nFailed to insert content source:', insertErr.message);
    process.exit(1);
  }

  console.log('\nContent source created:');
  console.log('  id:                  ', source.id);
  console.log('  url:                 ', source.url);
  console.log('  source_type:         ', source.source_type);
  console.log('  verification_status: ', source.verification_status);
  console.log('  verification_token:  ', source.verification_token);

  // 4. Confirm row count
  const { count, error: countErr } = await supabase
    .from('content_sources')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', publisher.user_id);

  if (!countErr) {
    console.log('\nTotal content_sources rows for this user:', count);
  }
}

main();
