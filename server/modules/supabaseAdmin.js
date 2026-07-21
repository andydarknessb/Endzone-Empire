const { createClient } = require('@supabase/supabase-js');

// Server-side Supabase Storage client, used only for team avatar uploads.
// This is the app's *first* server-runtime Supabase client and the first use
// of a service-role key: the app's own JWT auth (see modules/auth.js) is not
// Supabase Auth, so Storage RLS can't identify our users — writes must be
// mediated here, authorized by the same ownership checks the rest of the API
// uses, rather than done directly from the browser with an anon key.
//
// Never expose SUPABASE_SERVICE_ROLE_KEY to the client bundle — it belongs
// only in this module, loaded server-side. See .env.example.
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceRoleKey) {
  console.warn(
    'supabaseAdmin: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set — avatar uploads disabled'
  );
}

const supabaseAdmin =
  supabaseUrl && supabaseServiceRoleKey
    ? createClient(supabaseUrl, supabaseServiceRoleKey, { auth: { persistSession: false } })
    : null;

const AVATAR_BUCKET = 'team-avatars';

module.exports = { supabaseAdmin, AVATAR_BUCKET };
