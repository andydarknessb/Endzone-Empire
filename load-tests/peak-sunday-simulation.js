import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '30s', target: 50 },
    { duration: '1m', target: 100 },
    { duration: '30s', target: 0 },
  ],
};

const SUPABASE_URL = __ENV.SUPABASE_URL || 'https://supabase.co';
const SUPABASE_ANON_KEY = __ENV.SUPABASE_ANON_KEY || 'YOUR_SUPABASE_ANON_KEY';
const LEAGUE_ID = __ENV.LEAGUE_ID || '00000000-0000-4000-8000-000000007001';

export default function () {
  const headers = {
    'Content-Type': 'application/json',
    apikey: SUPABASE_ANON_KEY,
  };

  const matchupRes = http.get(
    `${SUPABASE_URL}/rest/v1/matchups?league_id=eq.${LEAGUE_ID}&select=*`,
    { headers }
  );
  check(matchupRes, { 'matchup fetch successful': (response) => response.status === 200 });

  sleep(1);

  const poolRes = http.get(
    `${SUPABASE_URL}/rest/v1/rosters?league_id=eq.${LEAGUE_ID}&select=*`,
    { headers }
  );
  check(poolRes, { 'player pool fetch successful': (response) => response.status === 200 });

  sleep(1);
}
