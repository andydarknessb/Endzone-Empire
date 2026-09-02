import fs from 'fs';
import path from 'path';

// The Draft Sim's CPU brain holds kickers and defenses off the board until the
// last three rounds (cpuBrain.js kickersAndDefensesOpen: currentRound > rounds - 3).
// The server's autopick need phase does the same, from startingNeed.js's
// KICKER_DEFENSE_WINDOW_ROUNDS (#746, ADR 0026). The two are one rule spelled in
// two trees, so this pins the window equal: editing either alone is a failure
// here rather than a real draft and a sim that quietly disagree about when a
// kicker is fair game.
//
// The client cannot import the server module (startingNeed -> lineup.service ->
// pg, which will not load in jsdom), so this reads the SERVER file's source and
// extracts the initializer, the chatLimits.parity.test.js idiom. It reads the
// window out of cpuBrain's source the same way rather than importing a named
// constant, so the whole client-side change for #746 stays the parity test plus
// two docblock lines.
function readSource(...segments) {
  return fs.readFileSync(path.join(__dirname, ...segments), 'utf8');
}

function extract(source, label, regex) {
  const match = source.match(regex);
  if (!match) throw new Error(`kickerDefenseWindow.parity: could not find ${label}`);
  return Number(match[1]);
}

test('the sim and the server hold K/DEF to the same last-N-rounds window', () => {
  const serverWindow = extract(
    readSource('..', '..', '..', 'server', 'services', 'startingNeed.js'),
    'KICKER_DEFENSE_WINDOW_ROUNDS in startingNeed.js',
    /KICKER_DEFENSE_WINDOW_ROUNDS\s*=\s*(\d+)/
  );
  const simWindow = extract(
    readSource('cpuBrain.js'),
    'the rounds window in kickersAndDefensesOpen',
    /kickersAndDefensesOpen[\s\S]*?state\.rounds\s*-\s*(\d+)/
  );
  expect(simWindow).toBe(serverWindow);
});
