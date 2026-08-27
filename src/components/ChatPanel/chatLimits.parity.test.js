import { MAX_CHAT_CHARS as CLIENT_MAX } from './chatLimits';
import { MAX_CHAT_CHARS as SERVER_MAX } from '../../../server/modules/chatLimits';

// The composer's character counter mirrors the server's length limit (#486).
// The client cannot import the socket module at runtime, so it declares its own
// MAX_CHAT_CHARS; this pins the two equal so editing either value alone is a
// failure here rather than a counter that lies about what the server enforces.
// Prior art: useLeagueChat.humanType.parity pinning the client human-message
// type to the server LEAGUE_CHAT constant.
//
// The server side lives in server/modules/chatLimits (a pure module, no pg or
// socket.io requires) precisely so this import loads in the jsdom client env;
// draftSocket re-exports the same constant for the server's own callers.
test('the client MAX_CHAT_CHARS mirrors the server constant', () => {
  expect(CLIENT_MAX).toBe(SERVER_MAX);
});
