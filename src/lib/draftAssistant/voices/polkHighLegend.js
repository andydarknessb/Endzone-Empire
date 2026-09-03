/**
 * "Polk High Legend": the Draft assistant's first voice (issue #784 Summary,
 * ADR 0027, glossary term "Draft assistant" in CONTEXT.md). A bitter,
 * middle-aged shoe salesman who scored four touchdowns for Polk High in the
 * 1966 city championship and has held a grudge against the sport, kickers,
 * and his own knees ever since.
 *
 * Ruling 3 (original content, no third-party characters): the archetype
 * stays, no borrowed names, ever, in copy or code identifiers. He is never
 * given a first or last name in this table for that reason.
 * Ruling 4 (PG ceiling): every line roasts a pick or a draft decision, never
 * a person's nationality, gender, sexuality or ethnicity. House style: no
 * em dashes (ADR 0016) -- commas, periods and colons carry the rhythm here.
 * Ruling 14 (no rookie or age lines): the "bad knees" bit stands in for the
 * injury-status joke this repo's data can actually support.
 *
 * Placeholders (filled by lineFor.js's fillTemplate, aliases over the facts
 * shape documented in src/lib/draftAssistant/index.js):
 *   {player}      -> facts.player.name
 *   {position}    -> facts.player.position
 *   {team}        -> facts.player.nfl_team
 *   {pickNumber}  -> facts.pickNumber
 *   {round}       -> facts.round
 *   {draftRounds} -> facts.draftRounds
 *   {adp}         -> facts.adp
 *
 * Every trigger keeps at least six lines (ruling 7 minimum); most keep more
 * so the "no repeat until exhausted" rule has real room to breathe.
 */
import { TRIGGERS } from '../triggers';

export const LINES = {
  [TRIGGERS.PICK_STEAL]: [
    '{player} at pick {pickNumber}? That is the kind of theft I would have gotten flagged for in \'66.',
    'Somebody napped through the whole board. {player} falls to you and you take it. Good.',
    'You stole {player} like a discount pair of cleats off the clearance rack.',
    'That is a steal, plain and simple. My 1966 team would have drafted that fast too.',
    '{player} at that spot is a gift. Say thank you and move along.',
    'The board handed you {player} for nothing. Enjoy it, it will not happen twice tonight.',
    'I have sold a lot of shoes in my life, and that is still the best deal I have seen all week.',
    'Pick {pickNumber}, {player} still on the board. Somebody in this league needs new glasses.',
  ],
  [TRIGGERS.PICK_REACH]: [
    'You paid full price for {player} at pick {pickNumber}. The clearance rack was right there.',
    'That is a reach. I have shorter arms than that and I still would not have stretched for it.',
    '{player} this early? Bold. Foolish, but bold.',
    'You could have waited two rounds on {player} and bought yourself a sandwich with the savings.',
    'Reaching for {player} at pick {pickNumber} is how a man ends up selling insoles at forty five.',
    'I did not stretch that far for a touchdown in the 1966 championship, and I scored four.',
    'That pick cost you more than it should have. Welcome to the club, I overpay for everything too.',
    '{player} was not walking out the door on you. You just paid retail for nothing.',
  ],
  [TRIGGERS.PICK_EARLY_KDEF]: [
    'A {position} this early? Kickers were barely athletes in 1966, and they have not improved.',
    'You burned a real pick on {player} the {position} with rounds still left on the clock. Bold strategy.',
    '{position} can wait. It always waits. You just told the room you do not know that yet.',
    'I sold shoes to men who made better decisions than drafting {player} the {position} right now.',
    'Plenty of {position}s left on that board later. You did not need to move this early.',
    'That is a rookie mistake, and you are not even a rookie. {position}, this early, really?',
    'Somewhere a veteran manager is laughing at that {position} pick. It might be me.',
    'You had time. You did not need {player} yet. Now you are out a real pick.',
  ],
  [TRIGGERS.PICK_RB]: [
    'A running back at pick {pickNumber}. Fine. Safe. The kind of pick that does not get you talked about.',
    '{player}, running back. Solid. Boring, like every good decision I never made.',
    'Running backs get hurt, they get old, and you still keep taking them. Respect.',
    '{player} at running back. Nothing wrong with it. Nothing exciting about it either.',
    'That is a running back pick a shoe salesman could have made blindfolded.',
    'You went with {player} at running back. Sturdy choice. Sturdy like a bad knee brace.',
    'Running back, pick {pickNumber}. The board will not remember it, and neither will I by next week.',
    '{player} joins your backfield. Somewhere a fullback is grateful nobody drafts them anymore.',
  ],
  [TRIGGERS.PICK_GENERIC]: [
    '{player} at pick {pickNumber}. Round {round}, and the room barely reacted. Take the hint.',
    'Fine pick. Not a steal, not a reach, just a pick. Most of my life has been just a pick too.',
    '{player}, it is. I have sold worse shoes to better men than the ones drafting around you.',
    'Pick {pickNumber}, {player}. Nobody is writing this one down for the highlight reel.',
    'You took {player}. Middle of the round, middle of the road. Story of a lot of drafts.',
    'In 1966 I scored four touchdowns and never once had to think this hard about a decision.',
    '{player} at {position}, pick {pickNumber}. Adequate. I have built a career on adequate.',
    'That pick will not make anybody\'s grade sheet, good or bad. Move along.',
  ],
  [TRIGGERS.QUEUE_PICKED_BY_OTHER]: [
    '{player} was on your Queue. Somebody else just walked out with your shoe size.',
    'You were saving {player} for later. Later just got taken by another team.',
    'That is what happens when you sit on a Queue instead of pulling the trigger. {player}, gone.',
    'Another team just picked {player} right out from under your Queue. Ouch.',
    'I would tell you to move faster next time, but you would not listen. Nobody does.',
    '{player} is off the board, and it was not you who took him. Adjust the Queue.',
    'You had {player} lined up and someone else beat you to the register.',
    'That is one fewer name on your Queue and zero more players on your roster. Bad trade.',
  ],
  [TRIGGERS.TURN_START]: [
    'Your turn. Do not make me wait like the men who used to browse and never buy.',
    'Clock is yours. I have watched worse decisions get made faster than this.',
    'On the clock. Back in 1966 the clock never ran this long on fourth down.',
    'It is your pick. Try not to think about it too hard, that is when the bad ones happen.',
    'Your turn again already. Time flies when you are watching other people\'s mistakes.',
    'The room is waiting on you. So am I, and I have got nowhere better to be.',
    'Pick\'s yours. Make it a good one, or at least make it fast.',
    'Your turn. Round {round}, and the shoe store never had lines this slow.',
  ],
  [TRIGGERS.CLOCK_URGENT]: [
    'Ten seconds. That is not a lot of time, and you are not using it well.',
    'Clock is running out, and so is my patience. Pick something.',
    'Ten seconds left. I made a better decision than this in less time in 1966, under contact.',
    'The clock does not care that you are still thinking. Pick.',
    'You are about to let the clock make this pick for you. That never goes well.',
    'Ten seconds on the board. Move, before Autopick moves for you.',
    'Tick tock. I sold a man a pair of shoes faster than you are making this decision.',
    'Clock is nearly out. Whatever you are thinking about, it is not worth this delay.',
  ],
  [TRIGGERS.POOL_PLAYER_SELECTED]: [
    '{player} is off the board. Somebody wanted him more than you did, apparently.',
    'There goes {player}. The pool gets a little thinner and the room gets a little louder.',
    '{player}, gone. If he was on your list, cross him off and keep moving.',
    'Another name off the board. {player}, taken. The board does not wait for anybody.',
    '{player} just got picked. Hope he was not the one you were waiting on.',
    'That is {player} off the pool. Somebody just made their move while you were reading this.',
    'Board is a little emptier now. {player} is somebody else\'s problem to start on Sundays.',
    '{player} is gone. That is one less argument you get to have with yourself later.',
  ],
  [TRIGGERS.PICK_AUTO]: [
    'Autopick made that one for you. Even a shoe store mannequin has better instincts sometimes.',
    'You let the clock take the pick. Autopick does not care about your Queue, it just moves.',
    'That was Autopick, not you. I have seen worse, but I have also seen better.',
    'The machine picked {player} because you did not. That is one way to draft.',
    'Autopick stepped in. It does not sell shoes, and it does not miss deadlines either.',
    'You missed your window, and Autopick filled it with {player}. Pay attention next time.',
    'That pick has Autopick\'s fingerprints all over it, not yours.',
    'The clock ran out and {player} showed up anyway. Autopick does not ask questions.',
  ],
};

export default LINES;
