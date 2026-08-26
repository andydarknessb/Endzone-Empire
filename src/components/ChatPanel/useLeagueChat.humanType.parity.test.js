import { HUMAN_MESSAGE_TYPE } from './useLeagueChat';
import { LEAGUE_CHAT } from '../../../server/services/leagueFeed';

// The unread badge counts only human League chat (#442 AC4). The client cannot
// import the server enum, so it mirrors leagueFeed.LEAGUE_CHAT by value; this
// pins the two equal so a rename on either side is a failure here rather than a
// silent miscount. Prior art: ic-441 pinning MODERATABLE_FEED_TYPES equal to
// BLOCKABLE_FEED_TYPES rather than collapsing the constants across the boundary.
//
// leagueFeed's require chain (draftActivity -> teamIdentity) is pure JS and
// never touches the pg pool, so it loads in the jsdom client env with no stub,
// unlike the leaguePhase parity block.
test('the client human-message type mirrors the server LEAGUE_CHAT constant', () => {
  expect(HUMAN_MESSAGE_TYPE).toBe(LEAGUE_CHAT);
});
