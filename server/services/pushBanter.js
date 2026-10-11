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
  'leadTaken', 'leadLost', 'tied', 'finalWon', 'finalLost', 'finalLostClose', 'finalTied',
  'bigPlayMine', 'bigPlayTheirs', 'bigPlaySeveral', 'lineupProblem', 'closeMatchup', 'draftStarting',
];

// Placeholders: {mine} {theirs} team names; {player} {event} {points} one
// Scoring play; {count} plays in one alert; {margin} points apart; {week};
// `tied` is a live tie and `finalTied` a Final one; the Final lines never
// read as a game still running.
// {league} a league name.
const LINES = {
  leadTaken: [
    '{mine} on top of {theirs}. Enjoy it. I held a lead for a whole championship once and I still talk about it.',
    'You took the lead. Four touchdowns in one game, I had, and nobody ever buzzed my pocket about it.',
    '{theirs} just fell behind. Do not get comfortable. Comfortable is how a man ends up selling shoes.',
    'Lead is yours. Sit down, stay seated, and do not touch anything. That is how I handle every win.',
    'Ahead of {theirs} for now. For now is also how long my knees held up.',
    'Ahead at the moment. I have watched a lead vanish faster than a bargain pair of loafers at the mall.',
    '{mine} just went in front. Keep the remote in your hand. The moment you set it down the game changes its mind.',
    '{mine} on top while the game is still breathing. Stay put in the chair. Moving is how leads leak out.',
    '{theirs} just slipped behind. Do not wander off to the garage to celebrate early. The game knows when you leave the room.',
    'You went in front. Quit refreshing the app every few seconds. It does not score faster when you stare at it.',
  ],
  leadLost: [
    'Lost the lead to {theirs}. Probably a kicker. It is always a kicker. I sold shoes for less humiliation than this.',
    '{theirs} just went ahead. I have watched a lot of things slip away from the couch. Add this to the pile.',
    'Behind now. I never trailed in the 1966 title game, and look how that worked out for the rest of my life.',
    'The lead is gone, like my hairline and my 1966 letterman jacket. One of those came back. Not the hairline.',
    '{theirs} on top. The couch has absorbed worse news than this. Barely.',
    '{theirs} just passed you. The lead walked out like a bad houseguest and did not even say goodbye.',
    'Behind now. My dog has better comebacks than this, and he spends most of the day asleep on the rug.',
    'The lead went to {theirs}. I have lost things in my garage before and eventually found them. Maybe this too.',
    '{theirs} is out front. Check the lineup, then check your nerves. The nerves are harder to fix.',
    'Fell behind. It happens. The dryer ate my best socks too, and I did not write a letter about it.',
  ],
  tied: [
    'Dead even with {theirs}. A tie is a loss with better manners.',
    'Tied up. Nobody wins, nobody loses, everybody waits. I have had whole decades like that.',
    'All square with {theirs}. I would say exciting, but I have fallen asleep in a shoe store with more suspense.',
    'Tied. Back in 1966 we settled ties with a fourth touchdown. Your move.',
    'Even with {theirs} for the moment. Moments end. Ask my knees.',
    'Level with {theirs}. Neither team is winning, and both are sweating at the same speed.',
    'Nobody is ahead yet. A live tie is a lukewarm cup of coffee. Keep sipping. It is still coffee.',
    'Knotted with {theirs}. Stay on the edge of the recliner. The next play picks a side for you.',
    'The scoreboard is stuck on even. It is like a garage door that will not close. You just stand there and stare at it.',
    'Tied with {theirs} for now. Nobody in this house trusts it, and that includes the dog.',
  ],
  finalWon: [
    'You beat {theirs}. Take the win, frame nothing, and bring it up in forty years like I do.',
    'A win over {theirs}. I won a championship with four touchdowns and nobody threw me a parade. You get a push notification.',
    'Nothing for {theirs} tonight. You go home a winner, which still means home, but with a win.',
    'Final, and it is yours. Savor it. The shoe store opens at nine on Monday either way.',
    'You won. {theirs} had a bench that saw it coming. Benches always do.',
    'You took the matchup from {theirs}. Put the trophy on a shelf, then forget where you put it, like I do.',
    '{mine} over {theirs}, and the book is closed. Eat something good tonight. You earned it, which is more than I can say for most of my dinners.',
    'Your team beat {theirs} and the scoreboard has stopped arguing. Write the result on the fridge in marker.',
    'Win in the books. Sit in the driveway a minute and savor it before you walk back inside.',
    'Final, and {mine} beat {theirs}. Their lineup is out of excuses, so enjoy the quiet.',
  ],
  finalLost: [
    '{theirs} took this one. I have lost to worse. I have also sold shoes to worse, so take that for what it is.',
    'It is over, and not your way. The couch is right there. It never judges.',
    'A loss to {theirs}. Write it down, forget it, and start somebody else next week. That is the whole playbook.',
    'That one goes to {theirs}. If it helps, I have sold shoes to people who lost worse than this on purpose.',
    'Final. Not the result you wanted, same as every size nine I ever tried to sell to a size eleven.',
    '{theirs} got this game. The rest of the night will be quiet, and the television will do you no favors.',
    '{theirs} takes the matchup. Pick a new starter for next week, then put this loss in the garage with the old exercise bike.',
    'Final loss. The paper plate from the cookout had more structure than this roster did this week.',
    'The matchup belongs to {theirs} now. Write down who let you down, then go make a sandwich. The sandwich helps more.',
    'Loss to {theirs}. Your starters will not reform on their own, so save the anger for the next lineup.',
  ],
  finalLostClose: [
    '{theirs} by less than a point. That is not a loss, that is a rounding error with a grudge.',
    'Lost by under a point. Probably a kicker. It is always a kicker, and I have hated every one of them since 1966.',
    'So close to beating {theirs} that the scoreboard had to check its glasses. Still a loss, though.',
    'Under a point. One extra yard somewhere and we are not having this conversation.',
    'A fraction of a point to {theirs}. I have measured feet more forgiving than that margin.',
    '{theirs} by a hair. That is the kind of loss that keeps you up at night, and the bedroom ceiling has heard all of mine.',
    'Lost by a sliver. The kind of margin that makes a grown man rewind the broadcast, then rewind it again.',
    '{theirs} edged you by a whisker. Somewhere a bowling pin is still wobbling from that finish.',
    '{theirs} by the width of a receipt. I have sold shoes with more room in them than that.',
    'Came this close to flipping it. The margin fits in a cup holder, and that is exactly where I keep my regrets.',
  ],
  finalTied: [
    'A tie with {theirs}. Nobody wins, nobody loses, everybody feels a little cheated. Welcome to my career.',
    'Final, and it is a tie. In 1966 we did not allow those. We had a fourth touchdown for that.',
    'Dead even with {theirs} at the end. Half a win, half a loss, and a full week of explaining it.',
    'A tie. Even the scoreboard shrugged. I shrug at most things too. It saves the knees.',
    'Tied with {theirs} when the whistle went. Not a loss. Not a win either. I know the feeling.',
    'Final and even with {theirs}. Nobody gets a plaque for that. Nobody gets to complain either, which is the real loss.',
    'The matchup ends in a tie. The shoe salesman in me wants a refund, and the rest of me wants a nap.',
    'Nothing to show for it but a tie. My trophy shelf only holds 1966, and this is not getting on it.',
    'A tie with {theirs}. The grill went cold while we argued about it. Nobody wins the argument either.',
    'Tied when the clock ran out. Write it in pencil. I refuse to ink a tie I did not earn.',
  ],
  bigPlayMine: [
    '{player} just went off for {points}. That is a real play. I had four of those in one game, but who is counting. Me. I am counting.',
    '{player}, {event}, {points} points. Even I got off the couch for that one.',
    'Your {player} just put up {points} on the {event}. Finally, something on this roster that works.',
    '{points} points from {player}. In 1966 that kind of play got a sandwich named after you.',
    '{player} with the {event}. {points} points. Somewhere your opponent is liking this a lot less.',
    'The {event} from {player} is worth {points} points. My knees heard about it and filed a complaint.',
    '{player} on the {event} for {points} points. The 1966 trophy in my garage just got nervous. It has been the only one for years.',
    'The {event} from {player} just added {points} points. The dog barked at the TV. The dog never barks for me.',
    '{player} comes up with the {event} for {points} points. Somewhere a paycheck just got bigger, and it is not mine.',
    '{points} points, {player}, {event}. My shoe store has had worse afternoons, and I was the one running it.',
  ],
  bigPlayTheirs: [
    'Their {player} just scored {points} on you. I have taken hits like that. Mine came with a trophy at the end. Yours comes with this.',
    '{player} just went for {points} against you. I have been kicked by smaller cleats.',
    'Your opponent\'s {player}, {event}, {points} points. Go ahead and sit back down. That is what I would do.',
    '{points} points for the other side\'s {player}. Somewhere a shoe salesman is nodding. It is me. I have seen this before.',
    '{player} with the {event} against you. {points} points. The couch has room if you need to lie down.',
    'The {event} from {player} cost you {points} points. The shoe store has a return policy. Your matchup does not.',
    '{player} with the {event} against you, {points} points. A rough afternoon for your lineup and a fine one for theirs.',
    'That {event} by {player} went for {points} points. Nobody paid me to watch plays like that, and I still watched every one.',
    '{points} points for {player} on the {event}. I would argue, but I have never won an argument with a scoreboard.',
    'Your end of the room went quiet when {player} landed the {event} for {points} points. I know that kind of quiet.',
  ],
  bigPlaySeveral: [
    '{count} big plays at once. This matchup has more action than my last twenty years combined.',
    '{count} big plays. Somebody\'s starters woke up. Check whose.',
    '{count} big plays in one go. In 1966 that was called a Tuesday. Today it is called your notification.',
    '{count} big plays just landed. Read the list, then decide whether to celebrate or lie down.',
    '{count} scoring plays worth bragging about. I only ever got one game to brag about. Make yours count.',
    '{count} big plays in one alert. I had one good afternoon in 1966, and it still did not look like this.',
    '{count} plays worth a reaction. Cheer or groan, the couch has heard both from me. Mostly groans.',
    '{count} big plays, and my knees are already asking for a sit down. Give them the chair.',
    '{count} big plays, and the neighbors are going to hear about it. They already heard about my four touchdowns. They are tired.',
    '{count} big ones at once. Back in 1966 I got one of those a game and treated it like a national holiday.',
  ],
  lineupProblem: [
    'Your week {week} lineup needs attention and kickoff is coming. Even I got off the couch for game day. Set it.',
    'Fix the lineup. Leave an empty slot and you are one bad Sunday from selling shoes for a living. I would know.',
    'Something in your week {week} lineup is not right. Fix it before kickoff fixes it for you.',
    'Your lineup needs you. Nothing has needed me since 1966. Set it, then sit back down.',
    'Week {week}, and your lineup has a problem. In 1966 I never missed a start. Be like 1966.',
    'Your week {week} lineup is not ready, and kickoff does not wait for anyone. I know. I asked it to once.',
    'Sort out your week {week} lineup before the games start. Do it once and do it grudgingly, the way I restock the shoe store.',
    'Week {week} kickoff is close and your lineup needs work. A bad lineup is like a bad fit in a shoe. It only gets worse once you start walking.',
    'Week {week} lineup needs a fix. In 1966 I checked my depth chart twice before every game. Check it twice, then relax.',
    'Check your week {week} lineup before kickoff, not from the garage at halftime. I have tried that. It does not work.',
  ],
  closeMatchup: [
    'Within {margin} points of your opponent. This is the part where I grip the couch cushion and say nothing.',
    '{margin} points separate you. One decent play either way. I have sold shoes with more slack than this.',
    'Close one. {margin} points. The last time I was this close to anything it was the 1966 title, and we won. No pressure.',
    'Your week {week} matchup is a coin flip. {margin} points. Do not look away. That is when they score.',
    '{margin} points in it. Somebody\'s kicker decides this. It is always the kicker.',
    'Only {margin} points between you and your opponent in week {week}. Close enough to put me on the edge of the couch.',
    'Week {week} is tight at {margin} points. Keep the phone close. The remote can wait.',
    '{margin} points apart in week {week}. I have seen less drama in my garage during an oil change.',
    'Week {week} comes down to {margin} points. I have lost by less at the bowling alley and still gone home sad.',
    '{margin} points is close enough that the dog has started watching the screen with me. The dog is worried. So am I.',
  ],
  draftStarting: [
    '{league} is drafting now. The pool does not wait, and neither does a man with my patience.',
    'Draft time in {league}. Pick well. I scored four touchdowns in one game and still got drafted by nobody.',
    'Draft night in {league}. Do not let Autopick live your life for you. It has been living mine.',
    'The room is open for {league}. Bring a plan or bring excuses. I have heard both.',
    '{league} is on the clock. Thirty years of selling shoes taught me one thing: the good ones go first.',
    'The {league} draft room just opened. Get in there and set your Queue. Everybody forgets the Queue.',
    '{league} is live right now. My knees are already in a folding chair. Put yours in one too.',
    'The draft room for {league} is open. Show up on time. Punctuality is the one thing I never managed at the shoe store.',
    '{league} is drafting right now. Everybody in the room thinks they have a plan. Most of them are wrong.',
    'The {league} room is live. A good draft is like a good pair of shoes. You feel it in the first step, not the last.',
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
