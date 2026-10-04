// Fixture for the Trophy Case layout guard (#1986): the `/api/league/4200/trophies`
// payload for a realistic Week 17 season. The shared `layoutGuardFixtures` league
// has no trophies, so the card self-hid there and the audit never rendered it.
//
// Per week 1..17: Top Scorer and Captain Hindsight; Perfect Lineup every third
// week, Called Shot every fifth. Season-level: Best Draft and a Longest Win
// Streak (both week 0, as trophy.service writes them). A 2025 champion makes the
// season select appear. Awards rotate over the same six Teams the layout-guard
// league holds, with long names so a row that cannot shrink would overflow.
//
// Kept apart from `layoutGuardFixtures.ts` on purpose: other specs extend that
// file, and the trophies route is this spec's own.
import type { Page } from '@playwright/test';
import { json } from './jsonRoute';
import { LEAGUE_ID } from './layoutGuardFixtures';

const TEAMS = [
  { id: 101, name: 'Chattahoochee Valley Riverhogs' },
  { id: 102, name: 'Sasquatch of the Cascade Range' },
  { id: 103, name: 'Windy City Gridiron Goblins' },
  { id: 104, name: 'Emerald Coast Storm Chasers' },
  { id: 105, name: 'Kilimanjaro Ridge Wildebeests' },
  { id: 106, name: 'Patagonia Frostbite Penguins' },
];

type Trophy = {
  id: number;
  type: string;
  label: string;
  week: number;
  season: number;
  team_id: number;
  team_name: string;
  data: Record<string, unknown>;
  awarded_at: string;
};

export function buildWeek17Trophies(): Trophy[] {
  const out: Trophy[] = [];
  let id = 1;
  const add = (type: string, label: string, week: number, season: number, teamIdx: number) => {
    const team = TEAMS[teamIdx % TEAMS.length];
    out.push({
      id: id++,
      type,
      label,
      week,
      season,
      team_id: team.id,
      team_name: team.name,
      data: {},
      awarded_at: `${season}-10-01T00:00:00.000Z`,
    });
  };
  add('champion', '2025 League Champion', 0, 2025, 2);
  for (let week = 1; week <= 17; week += 1) {
    add('top_scorer', 'Top Scorer', week, 2026, week);
    add('captain_hindsight', 'Captain Hindsight', week, 2026, week + 2);
    if (week % 3 === 0) add('perfect_lineup', 'Perfect Lineup', week, 2026, week + 1);
    if (week % 5 === 0) add('called_shot', 'Called Shot', week, 2026, week + 3);
  }
  add('draft_grade', 'Best Draft (A)', 0, 2026, 4);
  add('win_streak', 'Longest Win Streak (7)', 0, 2026, 0);
  return out;
}

/**
 * Routes the trophies read to the Week 17 season. Call AFTER `setupLayoutGuard`:
 * Playwright tries the most recently registered matching route first, so this
 * one wins over the guard's `/api/**` catch-all.
 */
export async function routeWeek17Trophies(page: Page) {
  const trophies = buildWeek17Trophies();
  await page.route(`**/api/league/${LEAGUE_ID}/trophies`, (route) => json(route, 200, trophies));
}
