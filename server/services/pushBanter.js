/**
 * Banter (CONTEXT.md, Push alerts): the Polk High Legend's one-line remark on
 * the end of a Push alert's body. The voice is the Draft assistant's
 * (src/lib/draftAssistant/voices/polkHighLegend.js, ADR 0027): a bitter,
 * middle-aged shoe salesman who scored four touchdowns in the 1966 city
 * championship and has held a grudge against the sport, kickers and his own
 * knees ever since. The same rulings bind this table:
 *   - no borrowed names, ever, in copy or identifiers (#784 ruling 3); the
 *     test pins it
 *   - a line roasts a team, a player's day or the narrator's own life, never
 *     a person; the opponent is only ever their team name (#2125)
 *   - PG-13, no profanity, no em dashes (ADR 0016)
 *
 * The facts are in the alert's title and first body line and are complete
 * without the remark; a line never carries a number the alert does not.
 * `banterFor` is deterministic over (situation, seed): the seed is the push's
 * dedupe identity, so the same event reads the same on every device and a
 * test can pin a line. Placeholders are filled from `facts`; a missing fact
 * renders empty, as the Draft assistant's fillTemplate does.
 */

const SITUATIONS = [
  'leadTaken', 'leadLost', 'tied', 'finalWon', 'finalLost', 'finalLostClose',
  'bigPlayMine', 'bigPlayTheirs', 'bigPlaySeveral', 'lineupProblem', 'closeMatchup', 'draftStarting',
];

// Placeholders: {mine} {theirs} team names; {player} {event} {points} one
// Scoring play; {count} plays in one alert; {margin} points apart; {week};
// {league} a league name.
const LINES = {
  leadTaken: [
    '{mine} on top of {theirs}. Enjoy it. The last lead I held lasted one quarter in 1966 and I still talk about it.',
    'You took the lead. Four touchdowns in one game, I had, and nobody ever buzzed my pocket about it.',
    '{theirs} just fell behind. Do not get comfortable. Comfortable is how a man ends up selling shoes.',
    'Lead is yours. Sit down, stay seated, and do not touch anything. That is how I handle every win.',
    'Ahead of {theirs} for now. For now is also how long my knees held up.',
  ],
  leadLost: [
    'Lost the lead to {theirs}. Probably a kicker. It is always a kicker. I sold shoes for less humiliation than this.',
    '{theirs} just went ahead. I have watched a lot of things slip away from the couch. Add this to the pile.',
    'Behind now. In 1966 I never trailed, and look how that worked out for the rest of my life.',
    'The lead is gone, like my hairline and my 1966 trophy. One of those came back. Not the trophy.',
    '{theirs} on top. Somebody on your bench is laughing, and it is not the one you started.',
  ],
  tied: [
    'Dead even with {theirs}. A tie is a loss with better manners.',
    'Tied up. Nobody wins, nobody loses, everybody waits. I have had whole decades like that.',
    'All square with {theirs}. I would say exciting, but I have fallen asleep in a shoe store with more suspense.',
    'Tied. Back in 1966 we settled ties with a fourth touchdown. Your move.',
    'Even with {theirs} for the moment. Moments end. Ask my knees.',
  ],
  finalWon: [
    'You beat {theirs}. Take the win, frame nothing, and bring it up in forty years like I do.',
    'A win over {theirs}. I scored four touchdowns in one game and nobody threw me a parade. You get a push notification.',
    '{theirs} goes home empty. You go home a winner, which still means home, but with a win.',
    'Final, and it is yours. Savor it. The shoe store opens at nine on Monday either way.',
    'You won. Somewhere {theirs} is explaining this to a bench that saw it coming.',
  ],
  finalLost: [
    '{theirs} took this one. I lost the 1966 playoff too, and I still blame the kicker.',
    'It is over, and not your way. The couch is right there. It never judges.',
    'A loss to {theirs}. Write it down, forget it, and start somebody else next week. That is the whole playbook.',
    '{theirs} wins. If it helps, I have sold shoes to people who lost worse than this on purpose.',
    'Final. Not the result you wanted, same as every size nine I ever tried to sell to a size eleven.',
  ],
  finalLostClose: [
    '{theirs} by less than a point. That is not a loss, that is a rounding error with a grudge.',
    'Lost by under a point. A kicker did this to you. A kicker did it to me in 1966. Nothing changes.',
    'So close to beating {theirs} that the scoreboard had to check its glasses. Still a loss, though.',
    'Under a point. One extra yard somewhere and we are not having this conversation.',
    '{theirs} wins by a fraction. I have measured feet more forgiving than that margin.',
  ],
  bigPlayMine: [
    '{player} just went off for {points}. That is a real play. I had four of those in one game, but who is counting. Me. I am counting.',
    '{player}, {event}, {points} points. Even I got off the couch for that one.',
    'Your {player} just put up {points} on a {event}. Finally, something on this roster that works.',
    '{points} points from {player}. In 1966 that kind of play got a sandwich named after you.',
    '{player} with the {event}. {points} points. Your opponent is reading this same alert and liking it a lot less.',
  ],
  bigPlayTheirs: [
    'Their {player} just scored {points} on you. Four touchdowns in one game, I had, and nobody pushes ME a notification.',
    '{player} just went for {points} against you. I have been kicked by smaller cleats.',
    'Your opponent\'s {player}, {event}, {points} points. Go ahead and sit back down. That is what I would do.',
    '{points} points for the other side\'s {player}. Somewhere a shoe salesman is nodding. It is me. I have seen this before.',
    '{player} with a {event} against you. {points} points. The couch has room if you need to lie down.',
  ],
  bigPlaySeveral: [
    '{count} big plays at once. This matchup has more action than my last twenty years combined.',
    '{count} big plays. Somebody\'s starters woke up. Check whose.',
    '{count} big plays in one go. In 1966 that was called a Tuesday. Today it is called your notification.',
    '{count} big plays just landed. Read the list, then decide whether to celebrate or lie down.',
    '{count} scoring plays worth bragging about. I only ever got one game to brag about. Make yours count.',
  ],
  lineupProblem: [
    'Your week {week} lineup has a hole in it and kickoff is coming. Even I got off the couch for game day. Set it.',
    'Fix the lineup. Leave an empty slot and you are one bad Sunday from selling shoes for a living. I would know.',
    'Something in your week {week} lineup is not going to play. Fix it before kickoff fixes it for you.',
    'Your lineup needs you. It is the only thing that does. Set it, then sit back down.',
    'Week {week}, and your lineup has a problem. In 1966 I never missed a start. Be like 1966.',
  ],
  closeMatchup: [
    'Within {margin} points of your opponent. This is the part where I grip the couch cushion and say nothing.',
    '{margin} points separate you. One decent play either way. I have sold shoes with more slack than this.',
    'Close one. {margin} points. The last time I was this close to anything it was the 1966 title, and we won. No pressure.',
    'Your week {week} matchup is a coin flip. {margin} points. Do not look away. That is when they score.',
    '{margin} points in it. Somebody\'s kicker decides this. It is always the kicker.',
  ],
  draftStarting: [
    '{league} is drafting now. Get in the room. The pool does not wait, and neither does a man with my patience.',
    'Draft time in {league}. Pick well. I scored four touchdowns in one game and still got drafted by nobody.',
    '{league}\'s draft is live. Do not let Autopick live your life for you. It has been living mine.',
    'The room is open for {league}. Bring a plan or bring excuses. I have heard both.',
    '{league} is on the clock. Thirty years of selling shoes taught me one thing: the good ones go first.',
  ],
};

/** FNV-1a over a string, so a seed maps to the same line on every process. */
function hash(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

function fillTemplate(template, facts) {
  return template.replace(/\{(\w+)\}/g, (_, key) => {
    const value = facts && facts[key];
    return value == null ? '' : String(value);
  });
}

/**
 * The line for one Push alert, or null for an unknown situation. `seed` is the
 * alert's dedupe identity (kind, subject and fingerprint joined), so a retry or
 * a second device reads the same line.
 */
function banterFor(situation, seed, facts = {}) {
  const pool = LINES[situation];
  if (!pool || pool.length === 0) return null;
  const index = hash(`${situation}:${seed}`) % pool.length;
  return fillTemplate(pool[index], facts);
}

module.exports = { SITUATIONS, LINES, banterFor, fillTemplate };
