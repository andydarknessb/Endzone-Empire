import { createClient } from '@supabase/supabase-js';

// Deliberate, narrow exception to this app's usual API/Socket.IO data path —
// anon-role only (no Supabase Auth here; this app uses its own JWT), scoped
// by the public-read RLS policy on live_game_states specifically. Not a
// template for skipping the Express API elsewhere.
const supabaseUrl = process.env.REACT_APP_SUPABASE_URL;
const supabaseAnonKey = process.env.REACT_APP_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn(
    'supabaseClient: REACT_APP_SUPABASE_URL / REACT_APP_SUPABASE_ANON_KEY not set; live game realtime disabled'
  );
}

const supabase = supabaseUrl && supabaseAnonKey ? createClient(supabaseUrl, supabaseAnonKey) : null;

export default supabase;
