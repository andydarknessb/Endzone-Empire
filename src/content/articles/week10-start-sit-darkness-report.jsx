import React from 'react';
import { Box } from '@mui/material';
import {
  Lead, P, H2, H3, Quote,
  Table, THead, TBody, TR, TH, TD,
} from '../../components/public/kit/Prose';
import { Note, Chip } from '../../components/public/kit/ArticleBits';
import {
  GameCard, InjuryGroup, JumpGrid, RailList, RulingCard, SlateBoard, TierBoard, WindowChecklist,
} from './darkness-report-parts';

// Body only: the frontmatter lives in week10-start-sit-darkness-report.meta.js so listings can be
// built without loading this prose; content/articles/index.js loads it on demand.
//
// Every color below the hero is a theme token, so the board, cards and chips read in light and
// dark. The hero is a dark illustration in both themes, like the Week 3 start/sit banner.
//
// Reading key (also printed in the article): FPA rank: 1 = most points allowed (good matchup for the
// opposing position), 32 = fewest (tough). Weeks 1 to 9. Times are Eastern. Verdicts come from docs/editorial/week10-rulings.md.

function HeroBanner() {
  // Yard lines in perspective: t runs from 0 at the near edge to 1 at the far end line.
  const rows = [190, 222, 258, 296];
  return (
    <Box
      component="svg"
      viewBox="0 0 800 300"
      xmlns="http://www.w3.org/2000/svg"
      sx={{ width: '100%', borderRadius: 'var(--radius-md, 10px)', overflow: 'hidden', mb: 4, display: 'block' }}
      role="img"
      aria-labelledby="wk10ss-hero-title wk10ss-hero-desc"
    >
      <title id="wk10ss-hero-title">Week 10 Start/Sit: The Darkness Report</title>
      <desc id="wk10ss-hero-desc">
        A night stadium seen from one end: floodlight towers on both sides throw cones of light onto a
        field whose yard lines narrow to a far end line, with a goalpost in the middle. A football
        sits on the turf, and a dotted kick path rises toward the uprights. The headline Week 10 Start/Sit is set in a panel across the bottom.
      </desc>
      <defs>
        <linearGradient id="wk10ss-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#04060c" />
          <stop offset="1" stopColor="#101a2c" />
        </linearGradient>
        <linearGradient id="wk10ss-beam" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#dbe7ff" stopOpacity="0.5" />
          <stop offset="1" stopColor="#dbe7ff" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="wk10ss-turf" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#123f2e" />
          <stop offset="1" stopColor="#07190f" />
        </linearGradient>
        <linearGradient id="wk10ss-kick" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="#ffd866" stopOpacity="0" />
          <stop offset="1" stopColor="#ffd866" stopOpacity="0.95" />
        </linearGradient>
      </defs>
      <rect width="800" height="300" fill="url(#wk10ss-sky)" />
      <rect x="0" y="150" width="800" height="150" fill="url(#wk10ss-turf)" />
      <path d="M60 300 L300 150 L500 150 L740 300" fill="none" stroke="#ffffff" strokeOpacity="0.22" />
      <path d="M300 150 L500 150" stroke="#ffffff" strokeOpacity="0.4" strokeWidth="2" />
      {rows.map((y) => {
        const t = (300 - y) / 150;
        return <line key={y} x1={60 + 240 * t} y1={y} x2={740 - 240 * t} y2={y} stroke="#ffffff" strokeOpacity="0.16" />;
      })}
      <path d="M110 36 L60 300 L340 300 Z M690 36 L460 300 L740 300 Z" fill="url(#wk10ss-beam)" />
      <path d="M110 150 L110 34 M690 150 L690 34" stroke="#3b4a66" strokeWidth="4" strokeLinecap="round" />
      <circle cx="110" cy="30" r="18" fill="#7eaaff" fillOpacity="0.3" />
      <circle cx="690" cy="30" r="18" fill="#7eaaff" fillOpacity="0.3" />
      <rect x="98" y="24" width="24" height="10" rx="2" fill="#dbe7ff" />
      <rect x="678" y="24" width="24" height="10" rx="2" fill="#dbe7ff" />
      <path d="M400 150 L400 112 M372 112 L428 112 M372 112 L372 58 M428 112 L428 58" fill="none" stroke="#ffd866" strokeWidth="3" strokeLinecap="round" />
      <path d="M150 196 C 210 40, 330 20, 400 84" fill="none" stroke="url(#wk10ss-kick)" strokeWidth="3" strokeLinecap="round" strokeDasharray="2 9" />
      <g transform="translate(150 196) rotate(-28) scale(0.7)">
        <ellipse rx="34" ry="19" fill="#6b3416" stroke="#ff8c42" strokeWidth="2" />
        <path d="M-13 -19 Q-18 0 -13 19 M13 -19 Q18 0 13 19" fill="none" stroke="#ffffff" strokeWidth="2" opacity="0.8" />
        <line x1="-10" y1="0" x2="10" y2="0" stroke="#ffffff" strokeWidth="2" strokeLinecap="round" />
        {[-6, 0, 6].map((x) => (
          <line key={x} x1={x} y1="-4" x2={x} y2="4" stroke="#ffffff" strokeWidth="1.6" strokeLinecap="round" />
        ))}
      </g>
      <text x="400" y="34" textAnchor="middle" fill="#8badc9" fontFamily="system-ui, sans-serif" fontWeight="700" fontSize="12" letterSpacing="4">THE DARKNESS REPORT</text>
      <rect x="110" y="216" width="580" height="68" rx="14" fill="#030814" fillOpacity="0.84" stroke="#7eaaff" strokeOpacity="0.25" />
      <text x="400" y="246" textAnchor="middle" fill="#ffffff" fontFamily="system-ui, sans-serif" fontWeight="850" fontSize="24" letterSpacing="1">WEEK 10START/SIT</text>
      <text x="400" y="270" textAnchor="middle" fill="#8badc9" fontFamily="system-ui, sans-serif" fontWeight="600" fontSize="12" letterSpacing="2">WEEK 10| THURSDAY TO MONDAY | 14 GAMES</text>
    </Box>
  );
}


const GAMES = [
  {
    id: 'was-nyg',
    slot: 'thu',
    title: 'Commanders at Giants',
    kick: 'Thu 8:15p',
    when: 'Thursday Night · 8:15p ET',
    away: 'WAS',
    home: 'NYG',
    awayPts: 19,
    homePts: 21.5,
    line: 'NYG -2.5',
    total: 40.5,
    weather: '52F, wind 12, 74% light rain',
    rain: true,
    read: 'The Giants are 2.5-point favorites over Washington in a 40.5 total, with the Giants implied for 21.5 and Washington for 19. Jayden Daniels (QB10) is a start with 19.2 a game and 5.2 carries, and the Giants allow the 6th-most QB points. Malik Nabers (WR8) is a start on a 29% target share, and Washington allows the 8th-most WR points. Isaiah Likely (TE3) is a start on a 26% target share and 16.1 a game, and Stefon Diggs (WR20) is a flex with Terry McLaurin on IR. Cam Skattebo (RB18) is a flex only if active, with his coach expecting him to be a full go, and Devin Singletary is a sit with the lead job only if Skattebo sits. Rain is likely at MetLife. The inactives drop about 6:45p ET, and this game locks first at 8:15p ET.',
    fpa: 'WAS offense vs NYG D: QB 6, RB 26, WR 19, TE 22 · NYG offense vs WAS D: QB 5, RB 24, WR 8, TE 3',
    start: [
      ['Jayden Daniels', 'QB', '19.2 a game with 5.2 carries, full practice all week (elbow); the Giants allow the 6th-most QB points, though Washington is implied for 19.0 and rain is likely Thursday.', 'QB10', 'C10'],
      ['Malik Nabers', 'WR', '29% target share, full practice (knee); Washington allows the 8th-most WR points, though rain is likely Thursday.', 'WR8', 'C72'],
      ['Isaiah Likely', 'TE', '26% target share, 16.1 a game; Washington allows the 3rd-most TE points.', 'TE3', 'C116'],
      ['New York Giants', 'DEF', 'Washington implied for 19.0 with rain likely Thursday; 17 last week.', 'DST8', 'C140'],
    ],
    flex: [
      ['Stefon Diggs', 'WR', '22% target share with Terry McLaurin on IR; 8.1 last week, and rain is likely Thursday.', 'WR20', 'C84'],
    ],
    watch: [
      ['Cam Skattebo', 'RB', 'FLEX if active. Limited Monday, then full Tuesday and Wednesday (hamstring) after missing last week, and his coach expects him to be a full go; 16.3 carries a game, though Washington allows the 9th-fewest RB points.', 'RB18', 'C50'],
    ],
    sit: [
      ['J.J. McCarthy', 'QB', 'Washington allows the 5th-most QB points, but he has 8.5 a game and 7.3 last week; full practice (hip).', null, 'C25'],
      ['Jaxson Dart', 'QB', 'OUT. On IR; the engine still projects 16.6.', null, 'C32'],
      ['Devin Singletary', 'RB', '21 carries on 93% of the snaps for 5.9 last week; the lead job only if Skattebo sits.', null, 'C50'],
      ['Rachaad White', 'RB', '7 carries on 56% of the snaps for 6.9 last week; Washington is implied for 19.0, and the Giants allow the 7th-fewest RB points.', null, 'C60'],
      ['Terry McLaurin', 'WR', 'OUT. On IR after knee surgery; the engine still projects 9.4.', null, 'C113'],
      ['Chig Okonkwo', 'TE', '11.6 last week on 7 targets, full practice (hip), but Washington is implied for 19.0.', null, 'C131'],
    ],
    also: 'Arvell Reese (NYG LB) is on the IDP board.',
  },
  {
    id: 'ne-det',
    slot: 'intl',
    title: 'Patriots at Lions',
    kick: 'Sun 9:30a',
    when: 'Sun 9:30a ET · Munich',
    away: 'NE',
    home: 'DET',
    awayPts: 24.5,
    homePts: 27,
    line: 'DET -2.5',
    total: 51.5,
    weather: 'Munich, no forecast in our data',
    rain: false,
    read: 'The Lions are 2.5-point favorites over New England in Munich with a 51.5 total, implied for 27 for Detroit and 24.5 for New England. Drake Maye (QB4) is a start on 20.0 a game, and Jahmyr Gibbs (RB1) is a start on 26.2 a game on 22.1 carries. Jameson Williams (WR13) is a start, and Amon-Ra St. Brown (WR4) and Hunter Henry (TE12) are each a start only if active. Jared Goff (QB13) is a sit, and Rhamondre Stevenson is a sit after not practicing Wednesday (knee) and being listed as doubtful, and Corey Kiner is a sit, next up if Stevenson sits. The inactives drop about 8:00a ET Sunday, the earliest window on the Sunday slate.',
    fpa: 'NE offense vs DET D: QB 1, RB 30, WR 7, TE 1 · DET offense vs NE D: QB 16, RB 29, WR 2, TE 27',
    start: [
      ['Drake Maye', 'QB', '20.0 a game with 5.2 carries, full practice Wednesday (shoulder); Detroit allows the most QB points (22.2 a game).', 'QB4', 'C4'],
      ['Jahmyr Gibbs', 'RB', '26.2 a game on 22.1 carries, not on the practice report; Detroit implied for 27.0, though New England allows the 4th-fewest RB points.', 'RB1', 'C33'],
      ['Jameson Williams', 'WR', '26.1 and 17.0 before 5.0 on 2 targets last week; New England allows the 2nd-most WR points, and more of the passing game is his if St. Brown sits.', 'WR13', 'C77'],
      ['Sam LaPorta', 'TE', '11.6 a game on 90% of the snaps last week; Detroit implied for 27.0, though New England allows the 6th-fewest TE points.', 'TE8', 'C121'],
    ],
    flex: [
      ['DeMario Douglas', 'WR', '9 targets for 15.2 last week, 19.6 and 16.6 in two of the three before; Detroit allows the 7th-most WR points.', 'WR19', 'C83'],
    ],
    watch: [
      ['Amon-Ra St. Brown', 'WR', 'START if active. Limited Wednesday (ribs); 33% target share, 19.7 a game, and New England allows the 2nd-most WR points.', 'WR4', 'C68'],
      ['Hunter Henry', 'TE', 'START if active. Limited Wednesday (foot); Detroit allows the most TE points; TE12.', 'TE12', 'C125'],
    ],
    sit: [
      ['Jared Goff', 'QB', 'Limited Wednesday (chest); 9.0 and 5.3 the last two despite 18.4 a game; QB13.', 'QB13', 'C13'],
      ['Rhamondre Stevenson', 'RB', 'Did not practice Wednesday (knee) and listed as doubtful; TreVeyon Henderson is out (illness).', null, 'C57'],
      ['Corey Kiner', 'RB', 'Next up if Stevenson sits; 8 carries on 17% of the snaps last week, and Detroit allows the 3rd-fewest RB points.', null, 'C57'],
      ['A.J. Brown', 'WR', 'Limited Wednesday (knee, ankle); has not played since Week 7.', null, 'C98'],
      ['Romeo Doubs', 'WR', 'OUT. On IR (shoulder); the engine still projects 10.0.', null, 'C112'],
    ],
    also: null,
  },
  {
    id: 'buf-nyj',
    slot: 'one',
    title: 'Bills at Jets',
    kick: 'Sun 1:00p',
    when: 'Sun 1:00p ET',
    away: 'BUF',
    home: 'NYJ',
    awayPts: 29.5,
    homePts: 21,
    line: 'BUF -8.5',
    total: 50.5,
    weather: '49F, wind 12, mostly sunny',
    rain: false,
    read: 'Buffalo is an 8.5-point favorite over the Jets in a 50.5 total, implied for 29.5 for the Bills and 21 for the Jets. Josh Allen (QB1) is a start on 25.1 a game, and James Cook III (RB4) is a start on 21.1 carries a game, and the Jets allow the 8th-most RB points. Breece Hall (RB13) is a flex after 15 carries and 4 targets on 43% of the snaps in his first game since Week 3, and Buffalo allows the 9th-most RB points. Dalton Kincaid (TE11) is a start only if active, with 10.6 a game and a limited Wednesday (ankle). Garrett Wilson (WR21) is a flex only if active on a 28% target share, and Omar Cooper Jr. (WR18) is a flex only if active with 11 targets for 13.8 last week. Geno Smith is a sit with 7.4 last week, and Braelon Allen is a sit with 8 carries on 59% of the snaps with Hall back.',
    fpa: 'BUF offense vs NYJ D: QB 14, RB 8, WR 25, TE 12 · NYJ offense vs BUF D: QB 22, RB 9, WR 10, TE 18',
    start: [
      ['Josh Allen', 'QB', '25.1 a game on 7.6 carries; Buffalo implied for 29.5, tied with San Francisco for the highest on the slate.', 'QB1', 'C1'],
      ['James Cook III', 'RB', '31 carries last week and 21.1 carries a game; Buffalo implied for 29.5, and the Jets allow the 8th-most RB points.', 'RB4', 'C36'],
      ['Buffalo Bills', 'DEF', '21 and 22 the last two; the Jets are implied for 21.0 as 8.5-point underdogs.', 'DST6', 'C138'],
    ],
    flex: [
      ['Breece Hall', 'RB', '15 carries and 4 targets on 43% of the snaps in his first game since Week 3; Buffalo allows the 9th-most RB points.', 'RB13', 'C45'],
      ['Khalil Shakir', 'WR', 'Between 9.8 and 13.4 in each of his last four; Buffalo implied for 29.5.', 'WR24', 'C88'],
    ],
    watch: [
      ['Omar Cooper Jr.', 'WR', 'FLEX if active. Limited Wednesday (ankle); 11 targets for 13.8 last week after 22.3 and 22.5, and Buffalo allows the 10th-most WR points.', 'WR18', 'C82'],
      ['Garrett Wilson', 'WR', 'FLEX if active. Limited Wednesday in the concussion protocol after missing last week; 28% target share.', 'WR21', 'C85'],
      ['Dalton Kincaid', 'TE', 'START if active. Limited Wednesday (ankle); 10.6 a game, and Buffalo is implied for 29.5.', 'TE11', 'C124'],
    ],
    sit: [
      ['Geno Smith', 'QB', '7.4 last week, 14.5 a game; the Jets are implied for 21.0 as 8.5-point underdogs.', null, 'C16'],
      ['Braelon Allen', 'RB', '8 carries on 59% of the snaps with Hall back, down from 21 the week before.', null, 'C45'],
      ['DJ Moore', 'WR', '6.6 last week on 5 targets, 10.1 a game; the Jets allow the 8th-fewest WR points.', null, 'C105'],
      ['Mason Taylor', 'TE', '4.9 and 2.1 the last two on a 15% target share.', null, 'C130'],
    ],
    also: 'Greg Rousseau (BUF LB) and David Bailey (NYJ LB) are on the IDP board.',
  },
  {
    id: 'car-no',
    slot: 'one',
    title: 'Panthers at Saints',
    kick: 'Sun 1:00p',
    when: 'Sun 1:00p ET',
    away: 'CAR',
    home: 'NO',
    awayPts: 23,
    homePts: 25.5,
    line: 'NO -2.5',
    total: 48.5,
    weather: 'Dome',
    rain: false,
    read: 'New Orleans is a 2.5-point favorite over Carolina in a dome with a 48.5 total, implied for 25.5 for the Saints and 23 for the Panthers. Bryce Young (QB12) is a start on 20.3 last week, and New Orleans allows the 11th-most QB points in a dome. Tyler Shough (QB11) is a start on 19.7 last week on 10 carries. Chuba Hubbard (RB6) is a start on 16.8 carries and 89% of the snaps last week, and New Orleans allows the most RB points. Chris Olave (WR6) is a start on a 28% target share, and Tetairoa McMillan (WR12) is a start on a 25% target share. Audric Estime (RB21) is a flex with 15 carries for 14.7 last week and a role that is not secure, and Alvin Kamara is a sit after not practicing Wednesday (rest, back).',
    fpa: 'CAR offense vs NO D: QB 11, RB 1, WR 16, TE 8 · NO offense vs CAR D: QB 20, RB 2, WR 17, TE 17',
    start: [
      ['Tyler Shough', 'QB', '19.7 last week on 10 carries, 18.3 a game; New Orleans implied for 25.5 in a dome.', 'QB11', 'C11'],
      ['Bryce Young', 'QB', '20.3 last week, 18.3 a game; New Orleans allows the 11th-most QB points in a dome; QB12.', 'QB12', 'C12'],
      ['Chuba Hubbard', 'RB', 'Rest day Wednesday; 18.3 a game on 16.8 carries and 89% of the snaps last week, and New Orleans allows the most RB points.', 'RB6', 'C38'],
      ['Chris Olave', 'WR', '28% target share, 12 targets last week; New Orleans implied for 25.5.', 'WR6', 'C70'],
      ['Tetairoa McMillan', 'WR', '25% target share, 15.6 a game; New Orleans allows the 16th-most WR points in a dome.', 'WR12', 'C76'],
      ['Darren Waller', 'TE', '10 targets for 23.0 last week; New Orleans allows the 8th-most TE points.', 'TE9', 'C122'],
    ],
    flex: [
      ['Audric Estime', 'RB', '15 carries for 14.7 last week, and Carolina allows the 2nd-most RB points; Alvin Kamara\'s Wednesday off was a rest day and Travis Etienne Jr. may be activated, so the role is not secure.', 'RB21', 'C53'],
      ['Jalen Coker', 'WR', '20% target share on 82% of the snaps last week; New Orleans allows the 16th-most WR points in a dome.', 'WR25', 'C89'],
    ],
    watch: [],
    sit: [
      ['Alvin Kamara', 'RB', 'Did not practice Wednesday (rest, back); 6 carries on 49% of the snaps for 7.9 last week.', null, 'C53'],
      ['Travis Etienne Jr.', 'RB', 'On IR and designated to return, limited Wednesday (hamstring); the Saints decide on activating him at the end of the week.', null, 'C53'],
      ['Devaughn Vele', 'WR', '3.7 last week on 4 targets after 16.4; 18% target share.', null, 'C107'],
    ],
    also: null,
  },
  {
    id: 'hou-cle',
    slot: 'one',
    title: 'Texans at Browns',
    kick: 'Sun 1:00p',
    when: 'Sun 1:00p ET',
    away: 'HOU',
    home: 'CLE',
    awayPts: 23,
    homePts: 18.5,
    line: 'HOU -4.5',
    total: 41.5,
    weather: '46F, wind 10, 23% rain showers',
    rain: false,
    read: 'Houston is a 4.5-point favorite over Cleveland in a 41.5 total, implied for 23 for the Texans and 18.5 for the Browns. C.J. Stroud (QB7) is a start on 20.5 a game, and Nico Collins (WR11) is a start on 15.3 a game. Quinshon Judkins (RB24) is a flex with 14.5 carries a game, and Houston allows the 14th-most RB points. Deshaun Watson, named the starter Wednesday after his concussion, is a sit, and KC Concepcion (WR22) is a flex on 18.8 last week. Harold Fannin Jr. (TE7) is a start only if active after a limited Wednesday (groin), and Woody Marks (RB23) is a flex only if active.',
    fpa: 'HOU offense vs CLE D: QB 25, RB 15, WR 20, TE 11 · CLE offense vs HOU D: QB 13, RB 14, WR 3, TE 26',
    start: [
      ['C.J. Stroud', 'QB', '35.4 last week, 20.5 a game; Houston implied for 23.0, though Cleveland allows the 8th-fewest QB points.', 'QB7', 'C7'],
      ['Nico Collins', 'WR', '15.3 a game, 15.5 last week; C.J. Stroud scored 35.4 last week.', 'WR11', 'C75'],
      ['Houston Texans', 'DEF', 'Cleveland implied for 18.5; 13 last week.', 'DST4', 'C136'],
    ],
    flex: [
      ['Quinshon Judkins', 'RB', '15 carries last week, 14.5 carries a game; Houston allows the 14th-most RB points; RB24.', 'RB24', 'C56'],
      ['KC Concepcion', 'WR', '18.8 last week on 93% of the snaps; Denzel Boston did not practice Wednesday (toe), and Houston allows the 3rd-most WR points.', 'WR22', 'C86'],
    ],
    watch: [
      ['Woody Marks', 'RB', 'FLEX if active. Limited Wednesday (knee); 18 carries on 66% of the snaps last week, and David Montgomery did not practice (groin).', 'RB23', 'C55'],
      ['Harold Fannin Jr.', 'TE', 'START if active. Limited Wednesday (groin); 18% target share and 23.4 two weeks ago, though Houston allows the 7th-fewest TE points.', 'TE7', 'C120'],
    ],
    sit: [
      ['Deshaun Watson', 'QB', 'Named the starter Wednesday after his concussion; 14.7 a game and Cleveland is implied for 18.5.', null, 'C22'],
      ['David Montgomery', 'RB', 'Did not practice Wednesday (groin); has not played since Week 5.', null, 'C62'],
      ['Denzel Boston', 'WR', 'Did not practice Wednesday (toe); 15.8 last week.', null, 'C99'],
      ['Tank Dell', 'WR', 'Limited Wednesday (hand); 20.5 last week on 47% of the snaps.', null, 'C103'],
    ],
    also: null,
  },
  {
    id: 'jax-ten',
    slot: 'one',
    title: 'Jaguars at Titans',
    kick: 'Sun 1:00p',
    when: 'Sun 1:00p ET',
    away: 'JAX',
    home: 'TEN',
    awayPts: 28.5,
    homePts: 18,
    line: 'JAX -10.5',
    total: 46.5,
    weather: '51F, wind 5, sunny',
    rain: false,
    read: 'Jacksonville is a 10.5-point favorite over Tennessee in a 46.5 total, implied for 28.5 for the Jaguars and 18 for the Titans. Trevor Lawrence (QB5) is a start on 18.4 a game, and Tennessee allows the 8th-most QB points. Cam Ward is a sit against a Jacksonville defense that allows the 6th-fewest QB points. Tony Pollard (RB11) is a start on 36.5 and 28.7 in the two games before the bye, though Jacksonville allows the 2nd-fewest RB points. Bhayshul Tuten (RB14) is a flex only if active after not practicing Wednesday (ankle, foot), and Chris Rodriguez Jr. is a sit with the lead job only if Tuten sits. Parker Washington (WR10) is a start on a 24% target share, and Jakobi Meyers is a sit after not practicing Wednesday (ankle).',
    fpa: 'JAX offense vs TEN D: QB 8, RB 13, WR 1, TE 19 · TEN offense vs JAX D: QB 27, RB 31, WR 14, TE 29',
    start: [
      ['Trevor Lawrence', 'QB', '18.4 a game; Jacksonville implied for 28.5 as a 10.5-point road favorite, and Tennessee allows the 8th-most QB points.', 'QB5', 'C5'],
      ['Tony Pollard', 'RB', '36.5 and 28.7 in the two games before the bye on 25 and 21 carries; Tyjae Spears did not practice Wednesday (knee), though Jacksonville allows the 2nd-fewest RB points.', 'RB11', 'C43'],
      ['Parker Washington', 'WR', '24% target share, and Jakobi Meyers did not practice Wednesday (ankle); Tennessee allows the most WR points and Jacksonville is implied for 28.5.', 'WR10', 'C74'],
      ['Jacksonville Jaguars', 'DEF', 'Tennessee implied for 18.0; 24 and 15 the last two.', 'DST2', 'C134'],
    ],
    flex: [
      ['Wan\'Dale Robinson', 'WR', '15.7 on 94% of the snaps before the bye; Carnell Tate did not practice Wednesday (shoulder), and Jacksonville allows the 14th-most WR points.', 'WR26', 'C90'],
    ],
    watch: [
      ['Bhayshul Tuten', 'RB', 'FLEX if active. Did not practice Wednesday (ankle, foot); 12 carries on 36% of the snaps last week, but Tennessee allows the 13th-most RB points and Jacksonville is implied for 28.5.', 'RB14', 'C46'],
    ],
    sit: [
      ['Cam Ward', 'QB', '26.3 before the bye after 5.0, 6.8 and 5.7; Tennessee is implied for 18.0, and Jacksonville allows the 6th-fewest QB points.', null, 'C24'],
      ['Chris Rodriguez Jr.', 'RB', 'Limited Wednesday (hand); 10 carries on 45% of the snaps last week, and the lead job only if Tuten sits.', null, 'C46'],
      ['Jakobi Meyers', 'WR', 'Did not practice Wednesday (ankle); 4.6 targets a game.', null, 'C100'],
      ['Carnell Tate', 'WR', 'Did not practice Wednesday (shoulder); last played Week 7.', null, 'C101'],
    ],
    also: 'Foyesade Oluokun (JAX LB) is on the IDP board, and Tyjae Spears, Tony Pollard\'s handcuff, has no ruling.',
  },
  {
    id: 'kc-atl',
    slot: 'one',
    title: 'Chiefs at Falcons',
    kick: 'Sun 1:00p',
    when: 'Sun 1:00p ET',
    away: 'KC',
    home: 'ATL',
    awayPts: 24.75,
    homePts: 21.75,
    line: 'KC -3',
    total: 46.5,
    weather: '54F, wind 0, mostly sunny',
    rain: false,
    read: 'Kansas City is a 3-point favorite over Atlanta in a 46.5 total, implied for 24.75 for the Chiefs and 21.75 for the Falcons. Patrick Mahomes (QB8) is a start on 17.7 a game with full practice Wednesday (right elbow, knee). Kenneth Walker III (RB2) is a start on 24.6 a game, and Atlanta allows the 7th-most RB points. Travis Kelce (TE6) is a start on a 19% target share on the season, and Rashee Rice (WR17) is a flex with 18.3 and 9.9 the last two. Bijan Robinson (RB5) is a start on 26.7 last week on 19 carries and 7 targets, though Kansas City allows the 8th-fewest RB points. Drake London (WR16) is a flex on a 28% target share, and Kyle Pitts Sr. (TE13) is a sit, with Kansas City allowing the 6th-most TE points.',
    fpa: 'KC offense vs ATL D: QB 18, RB 7, WR 13, TE 21 · ATL offense vs KC D: QB 28, RB 25, WR 31, TE 6',
    start: [
      ['Patrick Mahomes', 'QB', 'Full practice Wednesday (right elbow, knee); 17.7 a game and 25.4 two weeks ago, with Kansas City implied for 24.75.', 'QB8', 'C8'],
      ['Kenneth Walker III', 'RB', '36.3 last week, 24.6 a game on 19.9 carries; Atlanta allows the 7th-most RB points.', 'RB2', 'C34'],
      ['Bijan Robinson', 'RB', '26.7 last week on 19 carries and 7 targets, 20.0 a game; Brian Robinson Jr. is on IR, though Kansas City allows the 8th-fewest RB points.', 'RB5', 'C37'],
      ['Travis Kelce', 'TE', 'Full practice Wednesday (ankle); 17.3 last week; 19% target share on the season.', 'TE6', 'C119'],
    ],
    flex: [
      ['Drake London', 'WR', '28% target share on 97% of the snaps last week; Kansas City allows the 2nd-fewest WR points.', 'WR16', 'C80'],
      ['Rashee Rice', 'WR', 'Full practice Wednesday (knee); 18.3 and 9.9 the last two on 8 and 7 targets, and Atlanta allows the 13th-most WR points.', 'WR17', 'C81'],
    ],
    watch: [],
    sit: [
      ['Michael Penix Jr.', 'QB', '13.8 a game, 13.5 last week; Kansas City allows the 5th-fewest QB points.', null, 'C18'],
      ['Xavier Worthy', 'WR', 'Full practice Wednesday (hamstring); 8.5 a game on 5.9 targets.', null, 'C108'],
      ['Kyle Pitts Sr.', 'TE', '2.6 and 5.3 the last two; Kansas City allows the 6th-most TE points; TE13.', 'TE13', 'C126'],
    ],
    also: 'George Karlaftis (KC DE) is on the IDP board.',
  },
  {
    id: 'mia-ind',
    slot: 'one',
    title: 'Dolphins at Colts',
    kick: 'Sun 1:00p',
    when: 'Sun 1:00p ET',
    away: 'MIA',
    home: 'IND',
    awayPts: 17.5,
    homePts: 21,
    line: 'IND -3.5',
    total: 38.5,
    weather: '47F, wind 2, mostly sunny',
    rain: false,
    read: 'Indianapolis is a 3.5-point favorite over Miami in a 38.5 total, with the Colts implied for 21 and the Dolphins for 17.5. Jonathan Taylor (RB8) is a start after being limited Wednesday for rest, and Miami allows the 10th-most RB points. Tyler Warren (TE5) is a start on a 23% target share and 7.6 targets a game, and Miami allows the 4th-most TE points. Ollie Gordon II (RB19) is a flex on 16 carries on 72% of the snaps last week. De\'Von Achane is out on IR (knee) and Malik Willis is out on IR (groin), so Kyle McCord is in line for his first start and is a sit. Caleb Douglas (WR30) is a flex on 8 targets for 13.0 last week, and Malik Washington is a sit after 4.1 last week on 3 targets.',
    fpa: 'MIA offense vs IND D: QB 9, RB 6, WR 23, TE 14 · IND offense vs MIA D: QB 10, RB 10, WR 29, TE 4',
    start: [
      ['Jonathan Taylor', 'RB', 'Limited Wednesday for rest; 17.9 carries a game, and Miami allows the 10th-most RB points, though he scored 6.7 and 9.4 the last two.', 'RB8', 'C40'],
      ['Tyler Warren', 'TE', '23% target share, 7.6 targets a game; Miami allows the 4th-most TE points.', 'TE5', 'C118'],
    ],
    flex: [
      ['Ollie Gordon II', 'RB', '16 carries on 72% of the snaps last week, 15.3 carries a game; Indianapolis allows the 6th-most RB points, though Miami is implied for 17.5.', 'RB19', 'C51'],
      ['Caleb Douglas', 'WR', '8 targets for 13.0 last week, 22% target share on the season; Kyle McCord is in line for his first start; WR30.', 'WR30', 'C94'],
    ],
    watch: [],
    sit: [
      ['Daniel Jones', 'QB', '9.1 a game, 10.3 last week; Indianapolis implied for 21.0.', null, 'C23'],
      ['Kyle McCord', 'QB', 'In line for his first start with Malik Willis on IR; no NFL snaps in our data, and Miami is implied for 17.5.', null, 'C28'],
      ['Malik Willis', 'QB', 'OUT. On IR (groin); the engine still projects 14.7.', null, 'C31'],
      ['De\'Von Achane', 'RB', 'OUT. On IR (knee); the engine still projects 14.8.', null, 'C64'],
      ['Malik Washington', 'WR', '4.1 last week on 3 targets; Kyle McCord is in line for his first start.', null, 'C106'],
    ],
    also: null,
  },
  {
    id: 'min-gb',
    slot: 'one',
    title: 'Vikings at Packers',
    kick: 'Sun 1:00p',
    when: 'Sun 1:00p ET',
    away: 'MIN',
    home: 'GB',
    awayPts: 19.75,
    homePts: 22.75,
    line: 'GB -3',
    total: 42.5,
    weather: '44F, wind 2, mostly sunny',
    rain: false,
    read: 'Green Bay is a 3-point favorite over Minnesota in a 42.5 total, with the Packers implied for 22.75 and the Vikings for 19.75. Kirk Cousins is a sit, listed with Minnesota in our data and first on its depth chart, though no report I could find names Minnesota\'s starter. Kyler Murray is a sit after not practicing Wednesday (hamstring), and Carson Wentz is a sit after starting last week for -2.8 and being limited Wednesday (ankle). Jordan Love (QB9) is a start with 36.2 last week and 20.7 a game, though Minnesota allows the fewest QB points. Justin Jefferson (WR14) is a start on a 29% target share, and Green Bay allows the 6th-most WR points. Matthew Golden (WR7) is a start with 32.4 last week and 10.2 targets a game, and Minnesota allows the 3rd-fewest WR points. Josh Jacobs is out with a fractured ring finger and surgery planned, and Kaleb Johnson (RB22) is a flex with 14 carries for 12.8 last week.',
    fpa: 'MIN offense vs GB D: QB 26, RB 5, WR 6, TE 30 · GB offense vs MIN D: QB 32, RB 27, WR 30, TE 32',
    start: [
      ['Jordan Love', 'QB', '36.2 last week, 20.7 a game; Green Bay implied for 22.75, though Minnesota allows the fewest QB points.', 'QB9', 'C9'],
      ['Matthew Golden', 'WR', '32.4 last week, 10.2 targets a game; Minnesota allows the 3rd-fewest WR points.', 'WR7', 'C71'],
      ['Christian Watson', 'WR', '30.1 last week, 19.7 a game on a 23% target share.', 'WR9', 'C73'],
      ['Justin Jefferson', 'WR', '29% target share, 11 targets last week; Green Bay allows the 6th-most WR points, though Minnesota\'s quarterback is unsettled.', 'WR14', 'C78'],
      ['Tucker Kraft', 'TE', '14.8 and 17.3 before 1.9 last week on 82% of the snaps; Minnesota allows the fewest TE points.', 'TE10', 'C123'],
      ['Green Bay Packers', 'DEF', 'Minnesota implied for 19.75 with an unsettled quarterback; 15 and 12 the last two.', 'DST5', 'C137'],
      ['Minnesota Vikings', 'DEF', '13.0 a game, the best on the slate; Green Bay is without Josh Jacobs.', 'DST7', 'C139'],
    ],
    flex: [
      ['Kaleb Johnson', 'RB', '14 carries for 12.8 last week after Josh Jacobs left, and reported as the likely lead back, though Pierre Strong Jr. played more snaps (45% to 39%); Minnesota allows the 6th-fewest RB points.', 'RB22', 'C54'],
    ],
    watch: [],
    sit: [
      ['Kirk Cousins', 'QB', 'Listed with Minnesota in our data and first on its depth chart after 19.1 a game for Las Vegas; no report I could find names Minnesota\'s starter, and Green Bay allows the 7th-fewest QB points.', null, 'C15'],
      ['Kyler Murray', 'QB', 'Did not practice Wednesday (hamstring), listed as doubtful and week-to-week.', null, 'C15'],
      ['Carson Wentz', 'QB', 'Started last week for -2.8 and was limited Wednesday (ankle).', null, 'C15'],
      ['Pierre Strong Jr.', 'RB', '8 carries and 2 targets on 45% of the snaps last week, more snaps than Johnson.', null, 'C54'],
      ['MarShawn Lloyd', 'RB', 'Second on the depth chart and not on Wednesday\'s injury report (knee), but he has not played since Week 8 and had 3 carries then.', null, 'C54'],
      ['Aaron Jones Sr.', 'RB', '3.6, 6.0 and 3.1 the last three, with 5 carries last week.', null, 'C58'],
      ['Jordan Mason', 'RB', '6 carries on 48% of the snaps last week; a split backfield.', null, 'C58'],
      ['Josh Jacobs', 'RB', 'OUT. Listed out with a fractured ring finger and surgery planned; the engine still projects 12.6.', null, 'C63'],
      ['T.J. Hockenson', 'TE', 'Did not practice Wednesday (wrist, chest); Green Bay allows the 3rd-fewest TE points; TE14.', 'TE14', 'C127'],
    ],
    also: 'Evan Williams (GB S) is on the IDP board.',
  },
  {
    id: 'lar-ari',
    slot: 'late',
    title: 'Rams at Cardinals',
    kick: 'Sun 4:05p',
    when: 'Sun 4:05p ET',
    away: 'LAR',
    home: 'ARI',
    awayPts: 24.5,
    homePts: 15,
    line: 'LAR -9.5',
    total: 39.5,
    weather: '76F, wind 5, sunny',
    rain: false,
    read: 'Los Angeles is a 9.5-point favorite over Arizona in a 39.5 total, with the Rams implied for 24.5 and Arizona for 15. Kyren Williams (RB9) is a start on 17.8 a game and 5.1 targets. Matthew Stafford (QB14) is a sit with 8.3 and 11.2 the last two, and Arizona allows the 2nd-most QB points. Puka Nacua is out with knee sprains and turf toe, expected to miss at least a month, and Davante Adams is out on IR (hamstring), not expected back before late November. Michael Wilson is out on IR with a neck injury reported as season-ending, and Trey McBride (TE2) is a start on a 28% target share and 10.4 targets a game. Tyler Allgeier (RB20) is a flex on 17 carries on 96% of the snaps last week, and the Rams allow the 5th-fewest RB points. The Los Angeles Rams (DST3) defense is a start, with Arizona implied for 15.0, the lowest on the slate.',
    fpa: 'LAR offense vs ARI D: QB 2, RB 16, WR 15, TE 9 · ARI offense vs LAR D: QB 23, RB 28, WR 27, TE 25',
    start: [
      ['Kyren Williams', 'RB', '17.8 a game with 5.1 targets; Los Angeles implied for 24.5 as a 9.5-point favorite with Puka Nacua out.', 'RB9', 'C41'],
      ['Trey McBride', 'TE', '28% target share, 10.4 targets a game; Arizona\'s top target with Michael Wilson on IR.', 'TE2', 'C115'],
      ['Los Angeles Rams', 'DEF', 'Arizona implied for 15.0, the lowest on the slate, with Carson Beck first on the depth chart; 14 and 13 the last two.', 'DST3', 'C135'],
    ],
    flex: [
      ['Tyler Allgeier', 'RB', '17 carries on 96% of the snaps last week with Jeremiyah Love and James Conner on IR; Arizona is implied for 15.0, and the Rams allow the 5th-fewest RB points.', 'RB20', 'C52'],
    ],
    watch: [],
    sit: [
      ['Matthew Stafford', 'QB', '8.3 and 11.2 the last two, and Puka Nacua is out with Davante Adams on IR; Arizona allows the 2nd-most QB points; QB14.', 'QB14', 'C14'],
      ['Carson Beck', 'QB', 'First on Arizona\'s depth chart with Gardner Minshew II out for the season (elbow surgery) and Jacoby Brissett traded; no NFL snaps in our data, and Arizona is implied for 15.0, the lowest on the slate.', null, 'C27'],
      ['Blake Corum', 'RB', '11 carries on 36% of the snaps last week; the No. 2 behind Kyren Williams.', null, 'C61'],
      ['Puka Nacua', 'WR', 'OUT. Out with knee sprains and turf toe, expected to miss at least a month; the engine still projects 25.0.', null, 'C109'],
      ['Davante Adams', 'WR', 'OUT. On IR (hamstring), not expected back before late November; the engine still projects 16.3.', null, 'C110'],
      ['Michael Wilson', 'WR', 'OUT. On IR with a neck injury reported as season-ending; the engine still projects 13.0.', null, 'C111'],
    ],
    also: null,
  },
  {
    id: 'sea-lv',
    slot: 'late',
    title: 'Seahawks at Raiders',
    kick: 'Sun 4:05p',
    when: 'Sun 4:05p ET',
    away: 'SEA',
    home: 'LV',
    awayPts: 23.5,
    homePts: 17,
    line: 'SEA -6.5',
    total: 40.5,
    weather: 'Dome',
    rain: false,
    read: 'Seattle is a 6.5-point favorite over Las Vegas in a 40.5 total, with Seattle implied for 23.5 and Las Vegas for 17. Sam Darnold is out again (quadriceps, ribs), and Fernando Mendoza is a sit, first on the Las Vegas depth chart with one appearance this season. Jaxon Smith-Njigba (WR1) is a start only if active, listed as not practicing Wednesday with no injury given, on a 36% target share and 25.9 a game. Brock Bowers (TE1) is a start on a 29% target share, with 28.2 and 22.3 the last two. Zach Charbonnet (RB16) is a flex on 16 carries on 57% of the snaps last week, and Las Vegas allows the 3rd-most RB points. Ashton Jeanty (RB17) is a flex on 7 targets last week and 6 carries on 64% of the snaps. The Seattle Seahawks (DST1) defense is a start at 11.7 a game and 17 last week.',
    fpa: 'SEA offense vs LV D: QB 3, RB 3, WR 12, TE 5 · LV offense vs SEA D: QB 31, RB 19, WR 32, TE 23',
    start: [
      ['Brock Bowers', 'TE', '29% target share, 28.2 and 22.3 the last two; 20.9 a game.', 'TE1', 'C114'],
      ['Seattle Seahawks', 'DEF', 'Las Vegas implied for 17.0 with Fernando Mendoza first on the depth chart; 11.7 a game, 17 last week.', 'DST1', 'C133'],
    ],
    flex: [
      ['Zach Charbonnet', 'RB', '16 carries on 57% of the snaps last week; Las Vegas allows the 3rd-most RB points and Seattle is implied for 23.5.', 'RB16', 'C48'],
      ['Ashton Jeanty', 'RB', '6.1 targets a game and 7 last week, but 6 carries on 64% of the snaps and Las Vegas is implied for 17.0.', 'RB17', 'C49'],
    ],
    watch: [
      ['Jaxon Smith-Njigba', 'WR', 'START if active. Listed as not practicing Wednesday with no injury given; 36% target share, 25.9 a game, and Las Vegas allows the 12th-most WR points.', 'WR1', 'C65'],
    ],
    sit: [
      ['Drew Lock', 'QB', 'Starts again with Darnold out, limited Wednesday (right elbow, oblique); 12.6 last week, and Las Vegas allows the 3rd-most QB points, so a 2QB start.', null, 'C21'],
      ['Fernando Mendoza', 'QB', 'First on the Las Vegas depth chart; one appearance this season, and Seattle allows the 2nd-fewest QB points.', null, 'C26'],
      ['Sam Darnold', 'QB', 'OUT. Ruled out again (quadriceps, ribs); the engine still projects 15.3.', null, 'C30'],
      ['Jadarian Price', 'RB', '9 carries on 36% of the snaps last week; the No. 2 behind Charbonnet.', null, 'C48'],
      ['Tre Tucker', 'WR', 'Seattle allows the fewest WR points, and Las Vegas is implied for 17.0.', null, 'C104'],
    ],
    also: 'Nakobe Dean (LV LB) is on the IDP board.',
  },
  {
    id: 'sf-dal',
    slot: 'late',
    title: '49ers at Cowboys',
    kick: 'Sun 4:25p',
    when: 'Sun 4:25p ET',
    away: 'SF',
    home: 'DAL',
    awayPts: 29.5,
    homePts: 26,
    line: 'SF -3.5',
    total: 55.5,
    weather: 'Retractable roof; 58F and a 69% chance of showers outside',
    rain: false,
    read: 'San Francisco is a 3.5-point favorite over Dallas in a 55.5 total, with San Francisco implied for 29.5 and Dallas for 26. Brock Purdy (QB3) is a start with 25.3 last week on 7 carries, and Dallas allows the 4th-most QB points. Christian McCaffrey (RB3) is a start only if active, listed as not practicing Wednesday with no injury given. Kaelon Black is a sit that takes the work only if McCaffrey sits. CeeDee Lamb (WR3) is a start with 33.5 last week on 16 targets and a 34% target share. George Kittle (TE4) is a start on a 23% target share, and Javonte Williams (RB7) is a start with 22.4 last week. Mike Evans is a sit after not practicing Wednesday (Achilles, ribs), and George Pickens (WR23) is a flex only if active.',
    fpa: 'SF offense vs DAL D: QB 4, RB 4, WR 9, TE 16 · DAL offense vs SF D: QB 24, RB 18, WR 28, TE 13',
    start: [
      ['Brock Purdy', 'QB', '25.3 last week on 7 carries, 21.4 a game; San Francisco implied for 29.5 in a 55.5 total, and Dallas allows the 4th-most QB points.', 'QB3', 'C3'],
      ['Dak Prescott', 'QB', '23.3, 19.8 and 19.5 the last three; Dallas implied for 26.0 in a 55.5 total, though San Francisco allows the 9th-fewest QB points.', 'QB6', 'C6'],
      ['Javonte Williams', 'RB', '22.4 last week, 17.1 carries a game; Dallas implied for 26.0 in a 55.5 total.', 'RB7', 'C39'],
      ['CeeDee Lamb', 'WR', '33.5 last week on 16 targets, 34% target share; a 55.5 total, the highest on the slate.', 'WR3', 'C67'],
      ['George Kittle', 'TE', '14.4 a game on a 23% target share; San Francisco implied for 29.5 in a 55.5 total.', 'TE4', 'C117'],
    ],
    flex: [
      ['Jordan Watkins', 'WR', '18.6 last week on 77% of the snaps; Mike Evans did not practice again, and San Francisco is implied for 29.5.', 'WR29', 'C93'],
    ],
    watch: [
      ['Christian McCaffrey', 'RB', 'START if active. Listed as not practicing Wednesday with no injury given; 22.7 on 18 carries last week, 20.8 a game, and San Francisco is implied for 29.5.', 'RB3', 'C35'],
      ['George Pickens', 'WR', 'FLEX if active. Limited Wednesday (hamstring) after missing last week, and his snaps may be capped; 7.8 targets a game in a 55.5 total.', 'WR23', 'C87'],
    ],
    sit: [
      ['Kaelon Black', 'RB', 'Takes the work only if McCaffrey sits; 7.0 on 11 carries last week.', null, 'C35'],
      ['Ryan Flournoy', 'WR', '7.3 on 3 targets last week despite 97% of the snaps, and George Pickens is due back; 17.0, 11.0 and 13.1 in the three games before.', null, 'C95'],
      ['Deebo Samuel Sr.', 'WR', 'Limited Wednesday (hamstring); last played Week 5.', null, 'C96'],
      ['Mike Evans', 'WR', 'Did not practice Wednesday (Achilles, ribs); has not played since Week 6.', null, 'C97'],
      ['Jake Ferguson', 'TE', 'OUT. Out with a knee injury and expected to miss multiple weeks; the engine still projects 7.5.', null, 'C132'],
    ],
    also: 'Fred Warner (SF LB) is on the IDP board.',
  },
  {
    id: 'pit-cin',
    slot: 'prime',
    title: 'Steelers at Bengals',
    kick: 'Sun 8:20p',
    when: 'Sunday Night · 8:20p ET',
    away: 'PIT',
    home: 'CIN',
    awayPts: 23,
    homePts: 26.5,
    line: 'CIN -3.5',
    total: 49.5,
    weather: '42F, wind 1, partly cloudy',
    rain: false,
    read: 'Cincinnati is a 3.5-point favorite over Pittsburgh in a 49.5 total, with Cincinnati implied for 26.5 and Pittsburgh for 23. Joe Burrow (QB2) is a start with 28.9, 39.5 and 29.5 the last three, though Pittsburgh allows the 4th-fewest QB points. Ja\'Marr Chase (WR2) is a start with 31.1 and 31.5 the last two on 16 and 12 targets. Tee Higgins (WR5) is a start on a 23% target share, with 26.8, 37.5 and 20.2 the last three. Chase Brown (RB12) is a start at 12.8 a game with 5.6 targets, though Pittsburgh allows the 11th-fewest RB points. Jaylen Warren (RB10) is a start on 17.6 a game with 14.9 carries and 4.5 targets, and Rico Dowdle is a sit as the next back behind him. DK Metcalf (WR27) is a flex on a 23% target share and 8.0 targets a game, and Mike Gesicki is a sit after 3.1 last week on 47% of the snaps.',
    fpa: 'PIT offense vs CIN D: QB 17, RB 17, WR 18, TE 7 · CIN offense vs PIT D: QB 29, RB 22, WR 24, TE 20',
    start: [
      ['Joe Burrow', 'QB', '28.9, 39.5 and 29.5 the last three, 24.9 a game; Cincinnati implied for 26.5, though Pittsburgh allows the 4th-fewest QB points.', 'QB2', 'C2'],
      ['Jaylen Warren', 'RB', '17.6 a game on 14.9 carries and 4.5 targets, 21.3 before the bye; Pittsburgh implied for 23.0.', 'RB10', 'C42'],
      ['Chase Brown', 'RB', '12.8 a game with 5.6 targets; Cincinnati implied for 26.5, though Pittsburgh allows the 11th-fewest RB points.', 'RB12', 'C44'],
      ['Ja\'Marr Chase', 'WR', '31.1 and 31.5 the last two on 16 and 12 targets; Cincinnati implied for 26.5.', 'WR2', 'C66'],
      ['Tee Higgins', 'WR', '26.8, 37.5 and 20.2 the last three on a 23% target share.', 'WR5', 'C69'],
    ],
    flex: [
      ['DK Metcalf', 'WR', '23% target share, 8.0 targets a game; 1.4 before the bye.', 'WR27', 'C91'],
      ['Germie Bernard', 'WR', '14.4, 25.7, 5.7 and 8.0 his last four on 85% or more of the snaps; 6.0 targets a game.', 'WR28', 'C92'],
    ],
    watch: [],
    sit: [
      ['Aaron Rodgers', 'QB', '14.8 a game and 4.9 before the bye; a 2QB start with Pittsburgh implied for 23.0.', null, 'C17'],
      ['Rico Dowdle', 'RB', '15 carries on 47% of the snaps before the bye; the No. 2 behind Jaylen Warren.', null, 'C42'],
      ['Mike Gesicki', 'TE', '3.1 last week on 47% of the snaps after 17.6 the week before.', null, 'C128'],
      ['Pat Freiermuth', 'TE', '9.9 a game on 53% of the snaps before the bye; Darnell Washington splits the position.', null, 'C129'],
    ],
    also: null,
  },
  {
    id: 'lac-bal',
    slot: 'prime',
    title: 'Chargers at Ravens',
    kick: 'Mon 8:15p',
    when: 'Monday Night · 8:15p ET',
    away: 'LAC',
    home: 'BAL',
    awayPts: 17,
    homePts: 21.5,
    line: 'BAL -4.5',
    total: 38.5,
    weather: '44F, wind 3, mostly clear',
    rain: false,
    read: 'Baltimore is a 4.5-point favorite over the Chargers in a 38.5 total, with Baltimore implied for 21.5 and the Chargers for 17. Lamar Jackson is out on IR with a right thumb injury that needs surgery. Jacoby Brissett is a sit, expected to start Monday after the trade from Arizona, which makes him a 2QB start. Derrick Henry (RB15) is a flex on 17 carries last week and 19.4 carries a game, and the Chargers allow the 12th-most RB points. Zay Flowers (WR15) is a flex on a 30% target share, and the Chargers allow the 5th-most WR points. Justin Herbert is a sit with a left middle finger injury, imaging negative, and he is expected to play Monday. Monday is the last window, so a scratch there has no later game to pivot to.',
    fpa: 'LAC offense vs BAL D: QB 15, RB 23, WR 11, TE 15 · BAL offense vs LAC D: QB 21, RB 12, WR 5, TE 31',
    start: [],
    flex: [
      ['Derrick Henry', 'RB', '17 carries last week, 19.4 carries a game, with Jacoby Brissett now at quarterback; 5.0, 5.9, 14.0 and 5.6 the last four, and the Chargers allow the 12th-most RB points.', 'RB15', 'C47'],
      ['Zay Flowers', 'WR', '30% target share, and Jacoby Brissett replaces Joe Fagnano, who started last week; 0.0 and 5.3 the last two, and the Chargers allow the 5th-most WR points.', 'WR15', 'C79'],
    ],
    watch: [],
    sit: [
      ['Justin Herbert', 'QB', 'Left middle finger, imaging negative and expected to play Monday; 10.3 a game and the Chargers are implied for 17.0.', null, 'C19'],
      ['Jacoby Brissett', 'QB', 'Expected to start Monday after the trade from Arizona; 13.9 a game there, and Baltimore is implied for 21.5, so a 2QB start.', null, 'C20'],
      ['Lamar Jackson', 'QB', 'OUT. On IR with a right thumb injury that needs surgery; the engine still projects 13.1.', null, 'C29'],
      ['Omarion Hampton', 'RB', '13 carries on 40% of the snaps for 6.0 last week; the Chargers are implied for 17.0.', null, 'C59'],
      ['Ladd McConkey', 'WR', 'Day-to-day with back spasms and did not play last week; the Chargers are implied for 17.0.', null, 'C102'],
    ],
    also: null,
  },
];

const QB_ROWS = [
  [1, 'Josh Allen', 'BUF', '25.1 a game on 7.6 carries; Buffalo implied for 29.5, tied with San Francisco for the highest on the slate', 'start'],
  [2, 'Joe Burrow', 'CIN', '28.9, 39.5 and 29.5 the last three, 24.9 a game; Cincinnati implied for 26.5, though Pittsburgh allows the 4th-fewest QB points', 'start'],
  [3, 'Brock Purdy', 'SF', '25.3 last week on 7 carries, 21.4 a game; San Francisco implied for 29.5 in a 55.5 total, and Dallas allows the 4th-most QB points', 'start'],
  [4, 'Drake Maye', 'NE', '20.0 a game with 5.2 carries, full practice Wednesday (shoulder); Detroit allows the most QB points (22.2 a game)', 'start'],
  [5, 'Trevor Lawrence', 'JAX', '18.4 a game; Jacksonville implied for 28.5 as a 10.5-point road favorite, and Tennessee allows the 8th-most QB points', 'start'],
  [6, 'Dak Prescott', 'DAL', '23.3, 19.8 and 19.5 the last three; Dallas implied for 26.0 in a 55.5 total, though San Francisco allows the 9th-fewest QB points', 'start'],
  [7, 'C.J. Stroud', 'HOU', '35.4 last week, 20.5 a game; Houston implied for 23.0, though Cleveland allows the 8th-fewest QB points', 'start'],
  [8, 'Patrick Mahomes', 'KC', 'Full practice Wednesday (right elbow, knee); 17.7 a game and 25.4 two weeks ago, with Kansas City implied for 24.75', 'start'],
  [9, 'Jordan Love', 'GB', '36.2 last week, 20.7 a game; Green Bay implied for 22.75, though Minnesota allows the fewest QB points', 'start'],
  [10, 'Jayden Daniels', 'WAS', '19.2 a game with 5.2 carries, full practice all week (elbow); the Giants allow the 6th-most QB points, though Washington is implied for 19.0 and rain is likely Thursday', 'start'],
  [11, 'Tyler Shough', 'NO', '19.7 last week on 10 carries, 18.3 a game; New Orleans implied for 25.5 in a dome', 'start'],
  [12, 'Bryce Young', 'CAR', '20.3 last week, 18.3 a game; New Orleans allows the 11th-most QB points in a dome; QB12', 'start'],
  [13, 'Jared Goff', 'DET', 'Limited Wednesday (chest); 9.0 and 5.3 the last two despite 18.4 a game; QB13', 'sit'],
  [14, 'Matthew Stafford', 'LAR', '8.3 and 11.2 the last two, and Puka Nacua is out with Davante Adams on IR; Arizona allows the 2nd-most QB points; QB14', 'sit'],
];

const RB_ROWS = [
  [1, 'Jahmyr Gibbs', 'DET', '26.2 a game on 22.1 carries, not on the practice report; Detroit implied for 27.0, though New England allows the 4th-fewest RB points', 'start'],
  [2, 'Kenneth Walker III', 'KC', '36.3 last week, 24.6 a game on 19.9 carries; Atlanta allows the 7th-most RB points', 'start'],
  [3, 'Christian McCaffrey', 'SF', 'If active. Listed as not practicing Wednesday with no injury given; 22.7 on 18 carries last week, 20.8 a game, and San Francisco is implied for 29.5', 'start'],
  [4, 'James Cook III', 'BUF', '31 carries last week and 21.1 carries a game; Buffalo implied for 29.5, and the Jets allow the 8th-most RB points', 'start'],
  [5, 'Bijan Robinson', 'ATL', '26.7 last week on 19 carries and 7 targets, 20.0 a game; Brian Robinson Jr. is on IR, though Kansas City allows the 8th-fewest RB points', 'start'],
  [6, 'Chuba Hubbard', 'CAR', 'Rest day Wednesday; 18.3 a game on 16.8 carries and 89% of the snaps last week, and New Orleans allows the most RB points', 'start'],
  [7, 'Javonte Williams', 'DAL', '22.4 last week, 17.1 carries a game; Dallas implied for 26.0 in a 55.5 total', 'start'],
  [8, 'Jonathan Taylor', 'IND', 'Limited Wednesday for rest; 17.9 carries a game, and Miami allows the 10th-most RB points, though he scored 6.7 and 9.4 the last two', 'start'],
  [9, 'Kyren Williams', 'LAR', '17.8 a game with 5.1 targets; Los Angeles implied for 24.5 as a 9.5-point favorite with Puka Nacua out', 'start'],
  [10, 'Jaylen Warren', 'PIT', '17.6 a game on 14.9 carries and 4.5 targets, 21.3 before the bye; Pittsburgh implied for 23.0', 'start'],
  [11, 'Tony Pollard', 'TEN', '36.5 and 28.7 in the two games before the bye on 25 and 21 carries; Tyjae Spears did not practice Wednesday (knee), though Jacksonville allows the 2nd-fewest RB points', 'start'],
  [12, 'Chase Brown', 'CIN', '12.8 a game with 5.6 targets; Cincinnati implied for 26.5, though Pittsburgh allows the 11th-fewest RB points', 'start'],
  [13, 'Breece Hall', 'NYJ', '15 carries and 4 targets on 43% of the snaps in his first game since Week 3; Buffalo allows the 9th-most RB points', 'flex'],
  [14, 'Bhayshul Tuten', 'JAX', 'If active. Did not practice Wednesday (ankle, foot); 12 carries on 36% of the snaps last week, but Tennessee allows the 13th-most RB points and Jacksonville is implied for 28.5', 'flex'],
  [15, 'Derrick Henry', 'BAL', '17 carries last week, 19.4 carries a game, with Jacoby Brissett now at quarterback; 5.0, 5.9, 14.0 and 5.6 the last four, and the Chargers allow the 12th-most RB points', 'flex'],
  [16, 'Zach Charbonnet', 'SEA', '16 carries on 57% of the snaps last week; Las Vegas allows the 3rd-most RB points and Seattle is implied for 23.5', 'flex'],
  [17, 'Ashton Jeanty', 'LV', '6.1 targets a game and 7 last week, but 6 carries on 64% of the snaps and Las Vegas is implied for 17.0', 'flex'],
  [18, 'Cam Skattebo', 'NYG', 'If active. Limited Monday, then full Tuesday and Wednesday (hamstring) after missing last week, and his coach expects him to be a full go; 16.3 carries a game, though Washington allows the 9th-fewest RB points', 'flex'],
  [19, 'Ollie Gordon II', 'MIA', '16 carries on 72% of the snaps last week, 15.3 carries a game; Indianapolis allows the 6th-most RB points, though Miami is implied for 17.5', 'flex'],
  [20, 'Tyler Allgeier', 'ARI', '17 carries on 96% of the snaps last week with Jeremiyah Love and James Conner on IR; Arizona is implied for 15.0, and the Rams allow the 5th-fewest RB points', 'flex'],
  [21, 'Audric Estime', 'NO', '15 carries for 14.7 last week, and Carolina allows the 2nd-most RB points; Alvin Kamara\'s Wednesday off was a rest day and Travis Etienne Jr. may be activated, so the role is not secure', 'flex'],
  [22, 'Kaleb Johnson', 'GB', '14 carries for 12.8 last week after Josh Jacobs left, and reported as the likely lead back, though Pierre Strong Jr. played more snaps (45% to 39%); Minnesota allows the 6th-fewest RB points', 'flex'],
  [23, 'Woody Marks', 'HOU', 'If active. Limited Wednesday (knee); 18 carries on 66% of the snaps last week, and David Montgomery did not practice (groin)', 'flex'],
  [24, 'Quinshon Judkins', 'CLE', '15 carries last week, 14.5 carries a game; Houston allows the 14th-most RB points; RB24', 'flex'],
];

const WR_ROWS = [
  [1, 'Jaxon Smith-Njigba', 'SEA', 'If active. Listed as not practicing Wednesday with no injury given; 36% target share, 25.9 a game, and Las Vegas allows the 12th-most WR points', 'start'],
  [2, 'Ja\'Marr Chase', 'CIN', '31.1 and 31.5 the last two on 16 and 12 targets; Cincinnati implied for 26.5', 'start'],
  [3, 'CeeDee Lamb', 'DAL', '33.5 last week on 16 targets, 34% target share; a 55.5 total, the highest on the slate', 'start'],
  [4, 'Amon-Ra St. Brown', 'DET', 'If active. Limited Wednesday (ribs); 33% target share, 19.7 a game, and New England allows the 2nd-most WR points', 'start'],
  [5, 'Tee Higgins', 'CIN', '26.8, 37.5 and 20.2 the last three on a 23% target share', 'start'],
  [6, 'Chris Olave', 'NO', '28% target share, 12 targets last week; New Orleans implied for 25.5', 'start'],
  [7, 'Matthew Golden', 'GB', '32.4 last week, 10.2 targets a game; Minnesota allows the 3rd-fewest WR points', 'start'],
  [8, 'Malik Nabers', 'NYG', '29% target share, full practice (knee); Washington allows the 8th-most WR points, though rain is likely Thursday', 'start'],
  [9, 'Christian Watson', 'GB', '30.1 last week, 19.7 a game on a 23% target share', 'start'],
  [10, 'Parker Washington', 'JAX', '24% target share, and Jakobi Meyers did not practice Wednesday (ankle); Tennessee allows the most WR points and Jacksonville is implied for 28.5', 'start'],
  [11, 'Nico Collins', 'HOU', '15.3 a game, 15.5 last week; C.J. Stroud scored 35.4 last week', 'start'],
  [12, 'Tetairoa McMillan', 'CAR', '25% target share, 15.6 a game; New Orleans allows the 16th-most WR points in a dome', 'start'],
  [13, 'Jameson Williams', 'DET', '26.1 and 17.0 before 5.0 on 2 targets last week; New England allows the 2nd-most WR points, and more of the passing game is his if St. Brown sits', 'start'],
  [14, 'Justin Jefferson', 'MIN', '29% target share, 11 targets last week; Green Bay allows the 6th-most WR points, though Minnesota\'s quarterback is unsettled', 'start'],
  [15, 'Zay Flowers', 'BAL', '30% target share, and Jacoby Brissett replaces Joe Fagnano, who started last week; 0.0 and 5.3 the last two, and the Chargers allow the 5th-most WR points', 'flex'],
  [16, 'Drake London', 'ATL', '28% target share on 97% of the snaps last week; Kansas City allows the 2nd-fewest WR points', 'flex'],
  [17, 'Rashee Rice', 'KC', 'Full practice Wednesday (knee); 18.3 and 9.9 the last two on 8 and 7 targets, and Atlanta allows the 13th-most WR points', 'flex'],
  [18, 'Omar Cooper Jr.', 'NYJ', 'If active. Limited Wednesday (ankle); 11 targets for 13.8 last week after 22.3 and 22.5, and Buffalo allows the 10th-most WR points', 'flex'],
  [19, 'DeMario Douglas', 'NE', '9 targets for 15.2 last week, 19.6 and 16.6 in two of the three before; Detroit allows the 7th-most WR points', 'flex'],
  [20, 'Stefon Diggs', 'WAS', '22% target share with Terry McLaurin on IR; 8.1 last week, and rain is likely Thursday', 'flex'],
  [21, 'Garrett Wilson', 'NYJ', 'If active. Limited Wednesday in the concussion protocol after missing last week; 28% target share', 'flex'],
  [22, 'KC Concepcion', 'CLE', '18.8 last week on 93% of the snaps; Denzel Boston did not practice Wednesday (toe), and Houston allows the 3rd-most WR points', 'flex'],
  [23, 'George Pickens', 'DAL', 'If active. Limited Wednesday (hamstring) after missing last week, and his snaps may be capped; 7.8 targets a game in a 55.5 total', 'flex'],
  [24, 'Khalil Shakir', 'BUF', 'Between 9.8 and 13.4 in each of his last four; Buffalo implied for 29.5', 'flex'],
  [25, 'Jalen Coker', 'CAR', '20% target share on 82% of the snaps last week; New Orleans allows the 16th-most WR points in a dome', 'flex'],
  [26, 'Wan\'Dale Robinson', 'TEN', '15.7 on 94% of the snaps before the bye; Carnell Tate did not practice Wednesday (shoulder), and Jacksonville allows the 14th-most WR points', 'flex'],
  [27, 'DK Metcalf', 'PIT', '23% target share, 8.0 targets a game; 1.4 before the bye', 'flex'],
  [28, 'Germie Bernard', 'PIT', '14.4, 25.7, 5.7 and 8.0 his last four on 85% or more of the snaps; 6.0 targets a game', 'flex'],
  [29, 'Jordan Watkins', 'SF', '18.6 last week on 77% of the snaps; Mike Evans did not practice again, and San Francisco is implied for 29.5', 'flex'],
  [30, 'Caleb Douglas', 'MIA', '8 targets for 13.0 last week, 22% target share on the season; Kyle McCord is in line for his first start; WR30', 'flex'],
];

const TE_ROWS = [
  [1, 'Brock Bowers', 'LV', '29% target share, 28.2 and 22.3 the last two; 20.9 a game', 'start'],
  [2, 'Trey McBride', 'ARI', '28% target share, 10.4 targets a game; Arizona\'s top target with Michael Wilson on IR', 'start'],
  [3, 'Isaiah Likely', 'NYG', '26% target share, 16.1 a game; Washington allows the 3rd-most TE points', 'start'],
  [4, 'George Kittle', 'SF', '14.4 a game on a 23% target share; San Francisco implied for 29.5 in a 55.5 total', 'start'],
  [5, 'Tyler Warren', 'IND', '23% target share, 7.6 targets a game; Miami allows the 4th-most TE points', 'start'],
  [6, 'Travis Kelce', 'KC', 'Full practice Wednesday (ankle); 17.3 last week; 19% target share on the season', 'start'],
  [7, 'Harold Fannin Jr.', 'CLE', 'If active. Limited Wednesday (groin); 18% target share and 23.4 two weeks ago, though Houston allows the 7th-fewest TE points', 'start'],
  [8, 'Sam LaPorta', 'DET', '11.6 a game on 90% of the snaps last week; Detroit implied for 27.0, though New England allows the 6th-fewest TE points', 'start'],
  [9, 'Darren Waller', 'CAR', '10 targets for 23.0 last week; New Orleans allows the 8th-most TE points', 'start'],
  [10, 'Tucker Kraft', 'GB', '14.8 and 17.3 before 1.9 last week on 82% of the snaps; Minnesota allows the fewest TE points', 'start'],
  [11, 'Dalton Kincaid', 'BUF', 'If active. Limited Wednesday (ankle); 10.6 a game, and Buffalo is implied for 29.5', 'start'],
  [12, 'Hunter Henry', 'NE', 'If active. Limited Wednesday (foot); Detroit allows the most TE points; TE12', 'start'],
  [13, 'Kyle Pitts Sr.', 'ATL', '2.6 and 5.3 the last two; Kansas City allows the 6th-most TE points; TE13', 'sit'],
  [14, 'T.J. Hockenson', 'MIN', 'Did not practice Wednesday (wrist, chest); Green Bay allows the 3rd-fewest TE points; TE14', 'sit'],
];

const DST_ROWS = [
  [1, 'Seattle Seahawks', 'SEA', 'Las Vegas implied for 17.0 with Fernando Mendoza first on the depth chart; 11.7 a game, 17 last week', 'start'],
  [2, 'Jacksonville Jaguars', 'JAX', 'Tennessee implied for 18.0; 24 and 15 the last two', 'start'],
  [3, 'Los Angeles Rams', 'LAR', 'Arizona implied for 15.0, the lowest on the slate, with Carson Beck first on the depth chart; 14 and 13 the last two', 'start'],
  [4, 'Houston Texans', 'HOU', 'Cleveland implied for 18.5; 13 last week', 'start'],
  [5, 'Green Bay Packers', 'GB', 'Minnesota implied for 19.75 with an unsettled quarterback; 15 and 12 the last two', 'start'],
  [6, 'Buffalo Bills', 'BUF', '21 and 22 the last two; the Jets are implied for 21.0 as 8.5-point underdogs', 'start'],
  [7, 'Minnesota Vikings', 'MIN', '13.0 a game, the best on the slate; Green Bay is without Josh Jacobs', 'start'],
  [8, 'New York Giants', 'NYG', 'Washington implied for 19.0 with rain likely Thursday; 17 last week', 'start'],
];

const RULINGS = [
  [
    'C1',
    [
      ['Josh Allen', 'QB', 'BUF', 'START', '25.1 a game on 7.6 carries; Buffalo implied for 29.5, tied with San Francisco for the highest on the slate.'],
    ],
  ],
  [
    'C2',
    [
      ['Joe Burrow', 'QB', 'CIN', 'START', '28.9, 39.5 and 29.5 the last three, 24.9 a game; Cincinnati implied for 26.5, though Pittsburgh allows the 4th-fewest QB points.'],
    ],
  ],
  [
    'C3',
    [
      ['Brock Purdy', 'QB', 'SF', 'START', '25.3 last week on 7 carries, 21.4 a game; San Francisco implied for 29.5 in a 55.5 total, and Dallas allows the 4th-most QB points.'],
    ],
  ],
  [
    'C4',
    [
      ['Drake Maye', 'QB', 'NE', 'START', '20.0 a game with 5.2 carries, full practice Wednesday (shoulder); Detroit allows the most QB points (22.2 a game).'],
    ],
  ],
  [
    'C5',
    [
      ['Trevor Lawrence', 'QB', 'JAX', 'START', '18.4 a game; Jacksonville implied for 28.5 as a 10.5-point road favorite, and Tennessee allows the 8th-most QB points.'],
    ],
  ],
  [
    'C6',
    [
      ['Dak Prescott', 'QB', 'DAL', 'START', '23.3, 19.8 and 19.5 the last three; Dallas implied for 26.0 in a 55.5 total, though San Francisco allows the 9th-fewest QB points.'],
    ],
  ],
  [
    'C7',
    [
      ['C.J. Stroud', 'QB', 'HOU', 'START', '35.4 last week, 20.5 a game; Houston implied for 23.0, though Cleveland allows the 8th-fewest QB points.'],
    ],
  ],
  [
    'C8',
    [
      ['Patrick Mahomes', 'QB', 'KC', 'START', 'Full practice Wednesday (right elbow, knee); 17.7 a game and 25.4 two weeks ago, with Kansas City implied for 24.75.'],
    ],
  ],
  [
    'C9',
    [
      ['Jordan Love', 'QB', 'GB', 'START', '36.2 last week, 20.7 a game; Green Bay implied for 22.75, though Minnesota allows the fewest QB points.'],
    ],
  ],
  [
    'C10',
    [
      ['Jayden Daniels', 'QB', 'WAS', 'START', '19.2 a game with 5.2 carries, full practice all week (elbow); the Giants allow the 6th-most QB points, though Washington is implied for 19.0 and rain is likely Thursday.'],
    ],
  ],
  [
    'C11',
    [
      ['Tyler Shough', 'QB', 'NO', 'START', '19.7 last week on 10 carries, 18.3 a game; New Orleans implied for 25.5 in a dome.'],
    ],
  ],
  [
    'C12',
    [
      ['Bryce Young', 'QB', 'CAR', 'START', '20.3 last week, 18.3 a game; New Orleans allows the 11th-most QB points in a dome; QB12.'],
    ],
  ],
  [
    'C13',
    [
      ['Jared Goff', 'QB', 'DET', 'SIT', 'Limited Wednesday (chest); 9.0 and 5.3 the last two despite 18.4 a game; QB13.'],
    ],
  ],
  [
    'C14',
    [
      ['Matthew Stafford', 'QB', 'LAR', 'SIT', '8.3 and 11.2 the last two, and Puka Nacua is out with Davante Adams on IR; Arizona allows the 2nd-most QB points; QB14.'],
    ],
  ],
  [
    'C15',
    [
      ['Kirk Cousins', 'QB', 'MIN', 'SIT', 'Listed with Minnesota in our data and first on its depth chart after 19.1 a game for Las Vegas; no report I could find names Minnesota\'s starter, and Green Bay allows the 7th-fewest QB points.'],
      ['Kyler Murray', 'QB', 'MIN', 'SIT', 'Did not practice Wednesday (hamstring), listed as doubtful and week-to-week.'],
      ['Carson Wentz', 'QB', 'MIN', 'SIT', 'Started last week for -2.8 and was limited Wednesday (ankle).'],
    ],
  ],
  [
    'C16',
    [
      ['Geno Smith', 'QB', 'NYJ', 'SIT', '7.4 last week, 14.5 a game; the Jets are implied for 21.0 as 8.5-point underdogs.'],
    ],
  ],
  [
    'C17',
    [
      ['Aaron Rodgers', 'QB', 'PIT', 'SIT', '14.8 a game and 4.9 before the bye; a 2QB start with Pittsburgh implied for 23.0.'],
    ],
  ],
  [
    'C18',
    [
      ['Michael Penix Jr.', 'QB', 'ATL', 'SIT', '13.8 a game, 13.5 last week; Kansas City allows the 5th-fewest QB points.'],
    ],
  ],
  [
    'C19',
    [
      ['Justin Herbert', 'QB', 'LAC', 'SIT', 'Left middle finger, imaging negative and expected to play Monday; 10.3 a game and the Chargers are implied for 17.0.'],
    ],
  ],
  [
    'C20',
    [
      ['Jacoby Brissett', 'QB', 'BAL', 'SIT', 'Expected to start Monday after the trade from Arizona; 13.9 a game there, and Baltimore is implied for 21.5, so a 2QB start.'],
    ],
  ],
  [
    'C21',
    [
      ['Drew Lock', 'QB', 'SEA', 'SIT', 'Starts again with Darnold out, limited Wednesday (right elbow, oblique); 12.6 last week, and Las Vegas allows the 3rd-most QB points, so a 2QB start.'],
    ],
  ],
  [
    'C22',
    [
      ['Deshaun Watson', 'QB', 'CLE', 'SIT', 'Named the starter Wednesday after his concussion; 14.7 a game and Cleveland is implied for 18.5.'],
    ],
  ],
  [
    'C23',
    [
      ['Daniel Jones', 'QB', 'IND', 'SIT', '9.1 a game, 10.3 last week; Indianapolis implied for 21.0.'],
    ],
  ],
  [
    'C24',
    [
      ['Cam Ward', 'QB', 'TEN', 'SIT', '26.3 before the bye after 5.0, 6.8 and 5.7; Tennessee is implied for 18.0, and Jacksonville allows the 6th-fewest QB points.'],
    ],
  ],
  [
    'C25',
    [
      ['J.J. McCarthy', 'QB', 'NYG', 'SIT', 'Washington allows the 5th-most QB points, but he has 8.5 a game and 7.3 last week; full practice (hip).'],
    ],
  ],
  [
    'C26',
    [
      ['Fernando Mendoza', 'QB', 'LV', 'SIT', 'First on the Las Vegas depth chart; one appearance this season, and Seattle allows the 2nd-fewest QB points.'],
    ],
  ],
  [
    'C27',
    [
      ['Carson Beck', 'QB', 'ARI', 'SIT', 'First on Arizona\'s depth chart with Gardner Minshew II out for the season (elbow surgery) and Jacoby Brissett traded; no NFL snaps in our data, and Arizona is implied for 15.0, the lowest on the slate.'],
    ],
  ],
  [
    'C28',
    [
      ['Kyle McCord', 'QB', 'MIA', 'SIT', 'In line for his first start with Malik Willis on IR; no NFL snaps in our data, and Miami is implied for 17.5.'],
    ],
  ],
  [
    'C29',
    [
      ['Lamar Jackson', 'QB', 'BAL', 'OUT', 'On IR with a right thumb injury that needs surgery; the engine still projects 13.1.'],
    ],
  ],
  [
    'C30',
    [
      ['Sam Darnold', 'QB', 'SEA', 'OUT', 'Ruled out again (quadriceps, ribs); the engine still projects 15.3.'],
    ],
  ],
  [
    'C31',
    [
      ['Malik Willis', 'QB', 'MIA', 'OUT', 'On IR (groin); the engine still projects 14.7.'],
    ],
  ],
  [
    'C32',
    [
      ['Jaxson Dart', 'QB', 'NYG', 'OUT', 'On IR; the engine still projects 16.6.'],
    ],
  ],
  [
    'C33',
    [
      ['Jahmyr Gibbs', 'RB', 'DET', 'START', '26.2 a game on 22.1 carries, not on the practice report; Detroit implied for 27.0, though New England allows the 4th-fewest RB points.'],
    ],
  ],
  [
    'C34',
    [
      ['Kenneth Walker III', 'RB', 'KC', 'START', '36.3 last week, 24.6 a game on 19.9 carries; Atlanta allows the 7th-most RB points.'],
    ],
  ],
  [
    'C35',
    [
      ['Christian McCaffrey', 'RB', 'SF', 'START if active', 'Listed as not practicing Wednesday with no injury given; 22.7 on 18 carries last week, 20.8 a game, and San Francisco is implied for 29.5.'],
      ['Kaelon Black', 'RB', 'SF', 'SIT', 'Takes the work only if McCaffrey sits; 7.0 on 11 carries last week.'],
    ],
  ],
  [
    'C36',
    [
      ['James Cook III', 'RB', 'BUF', 'START', '31 carries last week and 21.1 carries a game; Buffalo implied for 29.5, and the Jets allow the 8th-most RB points.'],
    ],
  ],
  [
    'C37',
    [
      ['Bijan Robinson', 'RB', 'ATL', 'START', '26.7 last week on 19 carries and 7 targets, 20.0 a game; Brian Robinson Jr. is on IR, though Kansas City allows the 8th-fewest RB points.'],
    ],
  ],
  [
    'C38',
    [
      ['Chuba Hubbard', 'RB', 'CAR', 'START', 'Rest day Wednesday; 18.3 a game on 16.8 carries and 89% of the snaps last week, and New Orleans allows the most RB points.'],
    ],
  ],
  [
    'C39',
    [
      ['Javonte Williams', 'RB', 'DAL', 'START', '22.4 last week, 17.1 carries a game; Dallas implied for 26.0 in a 55.5 total.'],
    ],
  ],
  [
    'C40',
    [
      ['Jonathan Taylor', 'RB', 'IND', 'START', 'Limited Wednesday for rest; 17.9 carries a game, and Miami allows the 10th-most RB points, though he scored 6.7 and 9.4 the last two.'],
    ],
  ],
  [
    'C41',
    [
      ['Kyren Williams', 'RB', 'LAR', 'START', '17.8 a game with 5.1 targets; Los Angeles implied for 24.5 as a 9.5-point favorite with Puka Nacua out.'],
    ],
  ],
  [
    'C42',
    [
      ['Jaylen Warren', 'RB', 'PIT', 'START', '17.6 a game on 14.9 carries and 4.5 targets, 21.3 before the bye; Pittsburgh implied for 23.0.'],
      ['Rico Dowdle', 'RB', 'PIT', 'SIT', '15 carries on 47% of the snaps before the bye; the No. 2 behind Jaylen Warren.'],
    ],
  ],
  [
    'C43',
    [
      ['Tony Pollard', 'RB', 'TEN', 'START', '36.5 and 28.7 in the two games before the bye on 25 and 21 carries; Tyjae Spears did not practice Wednesday (knee), though Jacksonville allows the 2nd-fewest RB points.'],
    ],
  ],
  [
    'C44',
    [
      ['Chase Brown', 'RB', 'CIN', 'START', '12.8 a game with 5.6 targets; Cincinnati implied for 26.5, though Pittsburgh allows the 11th-fewest RB points.'],
    ],
  ],
  [
    'C45',
    [
      ['Breece Hall', 'RB', 'NYJ', 'FLEX', '15 carries and 4 targets on 43% of the snaps in his first game since Week 3; Buffalo allows the 9th-most RB points.'],
      ['Braelon Allen', 'RB', 'NYJ', 'SIT', '8 carries on 59% of the snaps with Hall back, down from 21 the week before.'],
    ],
  ],
  [
    'C46',
    [
      ['Bhayshul Tuten', 'RB', 'JAX', 'FLEX if active', 'Did not practice Wednesday (ankle, foot); 12 carries on 36% of the snaps last week, but Tennessee allows the 13th-most RB points and Jacksonville is implied for 28.5.'],
      ['Chris Rodriguez Jr.', 'RB', 'JAX', 'SIT', 'Limited Wednesday (hand); 10 carries on 45% of the snaps last week, and the lead job only if Tuten sits.'],
    ],
  ],
  [
    'C47',
    [
      ['Derrick Henry', 'RB', 'BAL', 'FLEX', '17 carries last week, 19.4 carries a game, with Jacoby Brissett now at quarterback; 5.0, 5.9, 14.0 and 5.6 the last four, and the Chargers allow the 12th-most RB points.'],
    ],
  ],
  [
    'C48',
    [
      ['Zach Charbonnet', 'RB', 'SEA', 'FLEX', '16 carries on 57% of the snaps last week; Las Vegas allows the 3rd-most RB points and Seattle is implied for 23.5.'],
      ['Jadarian Price', 'RB', 'SEA', 'SIT', '9 carries on 36% of the snaps last week; the No. 2 behind Charbonnet.'],
    ],
  ],
  [
    'C49',
    [
      ['Ashton Jeanty', 'RB', 'LV', 'FLEX', '6.1 targets a game and 7 last week, but 6 carries on 64% of the snaps and Las Vegas is implied for 17.0.'],
    ],
  ],
  [
    'C50',
    [
      ['Cam Skattebo', 'RB', 'NYG', 'FLEX if active', 'Limited Monday, then full Tuesday and Wednesday (hamstring) after missing last week, and his coach expects him to be a full go; 16.3 carries a game, though Washington allows the 9th-fewest RB points.'],
      ['Devin Singletary', 'RB', 'NYG', 'SIT', '21 carries on 93% of the snaps for 5.9 last week; the lead job only if Skattebo sits.'],
    ],
  ],
  [
    'C51',
    [
      ['Ollie Gordon II', 'RB', 'MIA', 'FLEX', '16 carries on 72% of the snaps last week, 15.3 carries a game; Indianapolis allows the 6th-most RB points, though Miami is implied for 17.5.'],
    ],
  ],
  [
    'C52',
    [
      ['Tyler Allgeier', 'RB', 'ARI', 'FLEX', '17 carries on 96% of the snaps last week with Jeremiyah Love and James Conner on IR; Arizona is implied for 15.0, and the Rams allow the 5th-fewest RB points.'],
    ],
  ],
  [
    'C53',
    [
      ['Audric Estime', 'RB', 'NO', 'FLEX', '15 carries for 14.7 last week, and Carolina allows the 2nd-most RB points; Alvin Kamara\'s Wednesday off was a rest day and Travis Etienne Jr. may be activated, so the role is not secure.'],
      ['Alvin Kamara', 'RB', 'NO', 'SIT', 'Did not practice Wednesday (rest, back); 6 carries on 49% of the snaps for 7.9 last week.'],
      ['Travis Etienne Jr.', 'RB', 'NO', 'SIT', 'On IR and designated to return, limited Wednesday (hamstring); the Saints decide on activating him at the end of the week.'],
    ],
  ],
  [
    'C54',
    [
      ['Kaleb Johnson', 'RB', 'GB', 'FLEX', '14 carries for 12.8 last week after Josh Jacobs left, and reported as the likely lead back, though Pierre Strong Jr. played more snaps (45% to 39%); Minnesota allows the 6th-fewest RB points.'],
      ['Pierre Strong Jr.', 'RB', 'GB', 'SIT', '8 carries and 2 targets on 45% of the snaps last week, more snaps than Johnson.'],
      ['MarShawn Lloyd', 'RB', 'GB', 'SIT', 'Second on the depth chart and not on Wednesday\'s injury report (knee), but he has not played since Week 8 and had 3 carries then.'],
    ],
  ],
  [
    'C55',
    [
      ['Woody Marks', 'RB', 'HOU', 'FLEX if active', 'Limited Wednesday (knee); 18 carries on 66% of the snaps last week, and David Montgomery did not practice (groin).'],
    ],
  ],
  [
    'C56',
    [
      ['Quinshon Judkins', 'RB', 'CLE', 'FLEX', '15 carries last week, 14.5 carries a game; Houston allows the 14th-most RB points; RB24.'],
    ],
  ],
  [
    'C57',
    [
      ['Rhamondre Stevenson', 'RB', 'NE', 'SIT', 'Did not practice Wednesday (knee) and listed as doubtful; TreVeyon Henderson is out (illness).'],
      ['Corey Kiner', 'RB', 'NE', 'SIT', 'Next up if Stevenson sits; 8 carries on 17% of the snaps last week, and Detroit allows the 3rd-fewest RB points.'],
    ],
  ],
  [
    'C58',
    [
      ['Aaron Jones Sr.', 'RB', 'MIN', 'SIT', '3.6, 6.0 and 3.1 the last three, with 5 carries last week.'],
      ['Jordan Mason', 'RB', 'MIN', 'SIT', '6 carries on 48% of the snaps last week; a split backfield.'],
    ],
  ],
  [
    'C59',
    [
      ['Omarion Hampton', 'RB', 'LAC', 'SIT', '13 carries on 40% of the snaps for 6.0 last week; the Chargers are implied for 17.0.'],
    ],
  ],
  [
    'C60',
    [
      ['Rachaad White', 'RB', 'WAS', 'SIT', '7 carries on 56% of the snaps for 6.9 last week; Washington is implied for 19.0, and the Giants allow the 7th-fewest RB points.'],
    ],
  ],
  [
    'C61',
    [
      ['Blake Corum', 'RB', 'LAR', 'SIT', '11 carries on 36% of the snaps last week; the No. 2 behind Kyren Williams.'],
    ],
  ],
  [
    'C62',
    [
      ['David Montgomery', 'RB', 'HOU', 'SIT', 'Did not practice Wednesday (groin); has not played since Week 5.'],
    ],
  ],
  [
    'C63',
    [
      ['Josh Jacobs', 'RB', 'GB', 'OUT', 'Listed out with a fractured ring finger and surgery planned; the engine still projects 12.6.'],
    ],
  ],
  [
    'C64',
    [
      ['De\'Von Achane', 'RB', 'MIA', 'OUT', 'On IR (knee); the engine still projects 14.8.'],
    ],
  ],
  [
    'C65',
    [
      ['Jaxon Smith-Njigba', 'WR', 'SEA', 'START if active', 'Listed as not practicing Wednesday with no injury given; 36% target share, 25.9 a game, and Las Vegas allows the 12th-most WR points.'],
    ],
  ],
  [
    'C66',
    [
      ['Ja\'Marr Chase', 'WR', 'CIN', 'START', '31.1 and 31.5 the last two on 16 and 12 targets; Cincinnati implied for 26.5.'],
    ],
  ],
  [
    'C67',
    [
      ['CeeDee Lamb', 'WR', 'DAL', 'START', '33.5 last week on 16 targets, 34% target share; a 55.5 total, the highest on the slate.'],
    ],
  ],
  [
    'C68',
    [
      ['Amon-Ra St. Brown', 'WR', 'DET', 'START if active', 'Limited Wednesday (ribs); 33% target share, 19.7 a game, and New England allows the 2nd-most WR points.'],
    ],
  ],
  [
    'C69',
    [
      ['Tee Higgins', 'WR', 'CIN', 'START', '26.8, 37.5 and 20.2 the last three on a 23% target share.'],
    ],
  ],
  [
    'C70',
    [
      ['Chris Olave', 'WR', 'NO', 'START', '28% target share, 12 targets last week; New Orleans implied for 25.5.'],
    ],
  ],
  [
    'C71',
    [
      ['Matthew Golden', 'WR', 'GB', 'START', '32.4 last week, 10.2 targets a game; Minnesota allows the 3rd-fewest WR points.'],
    ],
  ],
  [
    'C72',
    [
      ['Malik Nabers', 'WR', 'NYG', 'START', '29% target share, full practice (knee); Washington allows the 8th-most WR points, though rain is likely Thursday.'],
    ],
  ],
  [
    'C73',
    [
      ['Christian Watson', 'WR', 'GB', 'START', '30.1 last week, 19.7 a game on a 23% target share.'],
    ],
  ],
  [
    'C74',
    [
      ['Parker Washington', 'WR', 'JAX', 'START', '24% target share, and Jakobi Meyers did not practice Wednesday (ankle); Tennessee allows the most WR points and Jacksonville is implied for 28.5.'],
    ],
  ],
  [
    'C75',
    [
      ['Nico Collins', 'WR', 'HOU', 'START', '15.3 a game, 15.5 last week; C.J. Stroud scored 35.4 last week.'],
    ],
  ],
  [
    'C76',
    [
      ['Tetairoa McMillan', 'WR', 'CAR', 'START', '25% target share, 15.6 a game; New Orleans allows the 16th-most WR points in a dome.'],
    ],
  ],
  [
    'C77',
    [
      ['Jameson Williams', 'WR', 'DET', 'START', '26.1 and 17.0 before 5.0 on 2 targets last week; New England allows the 2nd-most WR points, and more of the passing game is his if St. Brown sits.'],
    ],
  ],
  [
    'C78',
    [
      ['Justin Jefferson', 'WR', 'MIN', 'START', '29% target share, 11 targets last week; Green Bay allows the 6th-most WR points, though Minnesota\'s quarterback is unsettled.'],
    ],
  ],
  [
    'C79',
    [
      ['Zay Flowers', 'WR', 'BAL', 'FLEX', '30% target share, and Jacoby Brissett replaces Joe Fagnano, who started last week; 0.0 and 5.3 the last two, and the Chargers allow the 5th-most WR points.'],
    ],
  ],
  [
    'C80',
    [
      ['Drake London', 'WR', 'ATL', 'FLEX', '28% target share on 97% of the snaps last week; Kansas City allows the 2nd-fewest WR points.'],
    ],
  ],
  [
    'C81',
    [
      ['Rashee Rice', 'WR', 'KC', 'FLEX', 'Full practice Wednesday (knee); 18.3 and 9.9 the last two on 8 and 7 targets, and Atlanta allows the 13th-most WR points.'],
    ],
  ],
  [
    'C82',
    [
      ['Omar Cooper Jr.', 'WR', 'NYJ', 'FLEX if active', 'Limited Wednesday (ankle); 11 targets for 13.8 last week after 22.3 and 22.5, and Buffalo allows the 10th-most WR points.'],
    ],
  ],
  [
    'C83',
    [
      ['DeMario Douglas', 'WR', 'NE', 'FLEX', '9 targets for 15.2 last week, 19.6 and 16.6 in two of the three before; Detroit allows the 7th-most WR points.'],
    ],
  ],
  [
    'C84',
    [
      ['Stefon Diggs', 'WR', 'WAS', 'FLEX', '22% target share with Terry McLaurin on IR; 8.1 last week, and rain is likely Thursday.'],
    ],
  ],
  [
    'C85',
    [
      ['Garrett Wilson', 'WR', 'NYJ', 'FLEX if active', 'Limited Wednesday in the concussion protocol after missing last week; 28% target share.'],
    ],
  ],
  [
    'C86',
    [
      ['KC Concepcion', 'WR', 'CLE', 'FLEX', '18.8 last week on 93% of the snaps; Denzel Boston did not practice Wednesday (toe), and Houston allows the 3rd-most WR points.'],
    ],
  ],
  [
    'C87',
    [
      ['George Pickens', 'WR', 'DAL', 'FLEX if active', 'Limited Wednesday (hamstring) after missing last week, and his snaps may be capped; 7.8 targets a game in a 55.5 total.'],
    ],
  ],
  [
    'C88',
    [
      ['Khalil Shakir', 'WR', 'BUF', 'FLEX', 'Between 9.8 and 13.4 in each of his last four; Buffalo implied for 29.5.'],
    ],
  ],
  [
    'C89',
    [
      ['Jalen Coker', 'WR', 'CAR', 'FLEX', '20% target share on 82% of the snaps last week; New Orleans allows the 16th-most WR points in a dome.'],
    ],
  ],
  [
    'C90',
    [
      ['Wan\'Dale Robinson', 'WR', 'TEN', 'FLEX', '15.7 on 94% of the snaps before the bye; Carnell Tate did not practice Wednesday (shoulder), and Jacksonville allows the 14th-most WR points.'],
    ],
  ],
  [
    'C91',
    [
      ['DK Metcalf', 'WR', 'PIT', 'FLEX', '23% target share, 8.0 targets a game; 1.4 before the bye.'],
    ],
  ],
  [
    'C92',
    [
      ['Germie Bernard', 'WR', 'PIT', 'FLEX', '14.4, 25.7, 5.7 and 8.0 his last four on 85% or more of the snaps; 6.0 targets a game.'],
    ],
  ],
  [
    'C93',
    [
      ['Jordan Watkins', 'WR', 'SF', 'FLEX', '18.6 last week on 77% of the snaps; Mike Evans did not practice again, and San Francisco is implied for 29.5.'],
    ],
  ],
  [
    'C94',
    [
      ['Caleb Douglas', 'WR', 'MIA', 'FLEX', '8 targets for 13.0 last week, 22% target share on the season; Kyle McCord is in line for his first start; WR30.'],
    ],
  ],
  [
    'C95',
    [
      ['Ryan Flournoy', 'WR', 'DAL', 'SIT', '7.3 on 3 targets last week despite 97% of the snaps, and George Pickens is due back; 17.0, 11.0 and 13.1 in the three games before.'],
    ],
  ],
  [
    'C96',
    [
      ['Deebo Samuel Sr.', 'WR', 'SF', 'SIT', 'Limited Wednesday (hamstring); last played Week 5.'],
    ],
  ],
  [
    'C97',
    [
      ['Mike Evans', 'WR', 'SF', 'SIT', 'Did not practice Wednesday (Achilles, ribs); has not played since Week 6.'],
    ],
  ],
  [
    'C98',
    [
      ['A.J. Brown', 'WR', 'NE', 'SIT', 'Limited Wednesday (knee, ankle); has not played since Week 7.'],
    ],
  ],
  [
    'C99',
    [
      ['Denzel Boston', 'WR', 'CLE', 'SIT', 'Did not practice Wednesday (toe); 15.8 last week.'],
    ],
  ],
  [
    'C100',
    [
      ['Jakobi Meyers', 'WR', 'JAX', 'SIT', 'Did not practice Wednesday (ankle); 4.6 targets a game.'],
    ],
  ],
  [
    'C101',
    [
      ['Carnell Tate', 'WR', 'TEN', 'SIT', 'Did not practice Wednesday (shoulder); last played Week 7.'],
    ],
  ],
  [
    'C102',
    [
      ['Ladd McConkey', 'WR', 'LAC', 'SIT', 'Day-to-day with back spasms and did not play last week; the Chargers are implied for 17.0.'],
    ],
  ],
  [
    'C103',
    [
      ['Tank Dell', 'WR', 'HOU', 'SIT', 'Limited Wednesday (hand); 20.5 last week on 47% of the snaps.'],
    ],
  ],
  [
    'C104',
    [
      ['Tre Tucker', 'WR', 'LV', 'SIT', 'Seattle allows the fewest WR points, and Las Vegas is implied for 17.0.'],
    ],
  ],
  [
    'C105',
    [
      ['DJ Moore', 'WR', 'BUF', 'SIT', '6.6 last week on 5 targets, 10.1 a game; the Jets allow the 8th-fewest WR points.'],
    ],
  ],
  [
    'C106',
    [
      ['Malik Washington', 'WR', 'MIA', 'SIT', '4.1 last week on 3 targets; Kyle McCord is in line for his first start.'],
    ],
  ],
  [
    'C107',
    [
      ['Devaughn Vele', 'WR', 'NO', 'SIT', '3.7 last week on 4 targets after 16.4; 18% target share.'],
    ],
  ],
  [
    'C108',
    [
      ['Xavier Worthy', 'WR', 'KC', 'SIT', 'Full practice Wednesday (hamstring); 8.5 a game on 5.9 targets.'],
    ],
  ],
  [
    'C109',
    [
      ['Puka Nacua', 'WR', 'LAR', 'OUT', 'Out with knee sprains and turf toe, expected to miss at least a month; the engine still projects 25.0.'],
    ],
  ],
  [
    'C110',
    [
      ['Davante Adams', 'WR', 'LAR', 'OUT', 'On IR (hamstring), not expected back before late November; the engine still projects 16.3.'],
    ],
  ],
  [
    'C111',
    [
      ['Michael Wilson', 'WR', 'ARI', 'OUT', 'On IR with a neck injury reported as season-ending; the engine still projects 13.0.'],
    ],
  ],
  [
    'C112',
    [
      ['Romeo Doubs', 'WR', 'NE', 'OUT', 'On IR (shoulder); the engine still projects 10.0.'],
    ],
  ],
  [
    'C113',
    [
      ['Terry McLaurin', 'WR', 'WAS', 'OUT', 'On IR after knee surgery; the engine still projects 9.4.'],
    ],
  ],
  [
    'C114',
    [
      ['Brock Bowers', 'TE', 'LV', 'START', '29% target share, 28.2 and 22.3 the last two; 20.9 a game.'],
    ],
  ],
  [
    'C115',
    [
      ['Trey McBride', 'TE', 'ARI', 'START', '28% target share, 10.4 targets a game; Arizona\'s top target with Michael Wilson on IR.'],
    ],
  ],
  [
    'C116',
    [
      ['Isaiah Likely', 'TE', 'NYG', 'START', '26% target share, 16.1 a game; Washington allows the 3rd-most TE points.'],
    ],
  ],
  [
    'C117',
    [
      ['George Kittle', 'TE', 'SF', 'START', '14.4 a game on a 23% target share; San Francisco implied for 29.5 in a 55.5 total.'],
    ],
  ],
  [
    'C118',
    [
      ['Tyler Warren', 'TE', 'IND', 'START', '23% target share, 7.6 targets a game; Miami allows the 4th-most TE points.'],
    ],
  ],
  [
    'C119',
    [
      ['Travis Kelce', 'TE', 'KC', 'START', 'Full practice Wednesday (ankle); 17.3 last week; 19% target share on the season.'],
    ],
  ],
  [
    'C120',
    [
      ['Harold Fannin Jr.', 'TE', 'CLE', 'START if active', 'Limited Wednesday (groin); 18% target share and 23.4 two weeks ago, though Houston allows the 7th-fewest TE points.'],
    ],
  ],
  [
    'C121',
    [
      ['Sam LaPorta', 'TE', 'DET', 'START', '11.6 a game on 90% of the snaps last week; Detroit implied for 27.0, though New England allows the 6th-fewest TE points.'],
    ],
  ],
  [
    'C122',
    [
      ['Darren Waller', 'TE', 'CAR', 'START', '10 targets for 23.0 last week; New Orleans allows the 8th-most TE points.'],
    ],
  ],
  [
    'C123',
    [
      ['Tucker Kraft', 'TE', 'GB', 'START', '14.8 and 17.3 before 1.9 last week on 82% of the snaps; Minnesota allows the fewest TE points.'],
    ],
  ],
  [
    'C124',
    [
      ['Dalton Kincaid', 'TE', 'BUF', 'START if active', 'Limited Wednesday (ankle); 10.6 a game, and Buffalo is implied for 29.5.'],
    ],
  ],
  [
    'C125',
    [
      ['Hunter Henry', 'TE', 'NE', 'START if active', 'Limited Wednesday (foot); Detroit allows the most TE points; TE12.'],
    ],
  ],
  [
    'C126',
    [
      ['Kyle Pitts Sr.', 'TE', 'ATL', 'SIT', '2.6 and 5.3 the last two; Kansas City allows the 6th-most TE points; TE13.'],
    ],
  ],
  [
    'C127',
    [
      ['T.J. Hockenson', 'TE', 'MIN', 'SIT', 'Did not practice Wednesday (wrist, chest); Green Bay allows the 3rd-fewest TE points; TE14.'],
    ],
  ],
  [
    'C128',
    [
      ['Mike Gesicki', 'TE', 'CIN', 'SIT', '3.1 last week on 47% of the snaps after 17.6 the week before.'],
    ],
  ],
  [
    'C129',
    [
      ['Pat Freiermuth', 'TE', 'PIT', 'SIT', '9.9 a game on 53% of the snaps before the bye; Darnell Washington splits the position.'],
    ],
  ],
  [
    'C130',
    [
      ['Mason Taylor', 'TE', 'NYJ', 'SIT', '4.9 and 2.1 the last two on a 15% target share.'],
    ],
  ],
  [
    'C131',
    [
      ['Chig Okonkwo', 'TE', 'WAS', 'SIT', '11.6 last week on 7 targets, full practice (hip), but Washington is implied for 19.0.'],
    ],
  ],
  [
    'C132',
    [
      ['Jake Ferguson', 'TE', 'DAL', 'OUT', 'Out with a knee injury and expected to miss multiple weeks; the engine still projects 7.5.'],
    ],
  ],
  [
    'C133',
    [
      ['Seattle Seahawks', 'DEF', 'SEA', 'START', 'Las Vegas implied for 17.0 with Fernando Mendoza first on the depth chart; 11.7 a game, 17 last week.'],
    ],
  ],
  [
    'C134',
    [
      ['Jacksonville Jaguars', 'DEF', 'JAX', 'START', 'Tennessee implied for 18.0; 24 and 15 the last two.'],
    ],
  ],
  [
    'C135',
    [
      ['Los Angeles Rams', 'DEF', 'LAR', 'START', 'Arizona implied for 15.0, the lowest on the slate, with Carson Beck first on the depth chart; 14 and 13 the last two.'],
    ],
  ],
  [
    'C136',
    [
      ['Houston Texans', 'DEF', 'HOU', 'START', 'Cleveland implied for 18.5; 13 last week.'],
    ],
  ],
  [
    'C137',
    [
      ['Green Bay Packers', 'DEF', 'GB', 'START', 'Minnesota implied for 19.75 with an unsettled quarterback; 15 and 12 the last two.'],
    ],
  ],
  [
    'C138',
    [
      ['Buffalo Bills', 'DEF', 'BUF', 'START', '21 and 22 the last two; the Jets are implied for 21.0 as 8.5-point underdogs.'],
    ],
  ],
  [
    'C139',
    [
      ['Minnesota Vikings', 'DEF', 'MIN', 'START', '13.0 a game, the best on the slate; Green Bay is without Josh Jacobs.'],
    ],
  ],
  [
    'C140',
    [
      ['New York Giants', 'DEF', 'NYG', 'START', 'Washington implied for 19.0 with rain likely Thursday; 17 last week.'],
    ],
  ],
];

const DST_TABLE = [
  ['Seattle Seahawks', 'at LV', '17', 'START (DST1)', 'Las Vegas implied for 17.0 with Fernando Mendoza first on the depth chart; 11.7 a game, 17 last week.'],
  ['Jacksonville Jaguars', 'at TEN', '18', 'START (DST2)', 'Tennessee implied for 18.0; 24 and 15 the last two.'],
  ['Los Angeles Rams', 'at ARI', '15', 'START (DST3)', 'Arizona implied for 15.0, the lowest on the slate, with Carson Beck first on the depth chart; 14 and 13 the last two.'],
  ['Houston Texans', 'at CLE', '18.5', 'START (DST4)', 'Cleveland implied for 18.5; 13 last week.'],
  ['Green Bay Packers', 'vs MIN', '19.75', 'START (DST5)', 'Minnesota implied for 19.75 with an unsettled quarterback; 15 and 12 the last two.'],
  ['Buffalo Bills', 'at NYJ', '21', 'START (DST6)', '21 and 22 the last two; the Jets are implied for 21.0 as 8.5-point underdogs.'],
  ['Minnesota Vikings', 'at GB', '22.75', 'START (DST7)', '13.0 a game, the best on the slate; Green Bay is without Josh Jacobs.'],
  ['New York Giants', 'vs WAS', '19', 'START (DST8)', 'Washington implied for 19.0 with rain likely Thursday; 17 last week.'],
];

const INJ_OUT = [
  ['Lamar Jackson', 'QB', 'BAL', 'On IR with a right thumb injury that needs surgery; the engine still projects 13.1.', 'Jacoby Brissett (SIT).', 'out', 'C29'],
  ['Sam Darnold', 'QB', 'SEA', 'Ruled out again (quadriceps, ribs); the engine still projects 15.3.', 'Drew Lock (SIT).', 'out', 'C30'],
  ['Malik Willis', 'QB', 'MIA', 'On IR (groin); the engine still projects 14.7.', 'Kyle McCord (SIT).', 'out', 'C31'],
  ['Jaxson Dart', 'QB', 'NYG', 'On IR; the engine still projects 16.6.', 'J.J. McCarthy (SIT).', 'out', 'C32'],
  ['Josh Jacobs', 'RB', 'GB', 'Listed out with a fractured ring finger and surgery planned; the engine still projects 12.6.', 'Kaleb Johnson (FLEX, RB22).', 'out', 'C63'],
  ['De\'Von Achane', 'RB', 'MIA', 'On IR (knee); the engine still projects 14.8.', 'Ollie Gordon II (FLEX, RB19).', 'out', 'C64'],
  ['Puka Nacua', 'WR', 'LAR', 'Out with knee sprains and turf toe, expected to miss at least a month; the engine still projects 25.0.', 'No other Rams receiver has a call.', 'out', 'C109'],
  ['Davante Adams', 'WR', 'LAR', 'On IR (hamstring), not expected back before late November; the engine still projects 16.3.', 'No other Rams receiver has a call.', 'out', 'C110'],
  ['Michael Wilson', 'WR', 'ARI', 'On IR with a neck injury reported as season-ending; the engine still projects 13.0.', 'No other Arizona receiver has a call.', 'out', 'C111'],
  ['Romeo Doubs', 'WR', 'NE', 'On IR (shoulder); the engine still projects 10.0.', 'DeMario Douglas (FLEX, WR19).', 'out', 'C112'],
  ['Terry McLaurin', 'WR', 'WAS', 'On IR after knee surgery; the engine still projects 9.4.', 'Stefon Diggs (FLEX, WR20).', 'out', 'C113'],
  ['Jake Ferguson', 'TE', 'DAL', 'Out with a knee injury and expected to miss multiple weeks; the engine still projects 7.5.', 'No other Dallas tight end has a call.', 'out', 'C132'],
];

const INJ_THU = [
  ['Cam Skattebo', 'RB', 'NYG', 'Limited Monday, then full Tuesday and Wednesday (hamstring) after missing last week, and his coach expects him to be a full go; 16.3 carries a game, though Washington allows the 9th-fewest RB points.', 'Devin Singletary (SIT). Make any swap before the 8:15p ET kickoff.', 'gtd', 'C50'],
];

const INJ_INTL = [
  ['Amon-Ra St. Brown', 'WR', 'DET', 'Limited Wednesday (ribs); 33% target share, 19.7 a game, and New England allows the 2nd-most WR points.', 'Jameson Williams (START, WR13). Carry a receiver who kicks off at 1:00p or later.', 'gtd', 'C68'],
  ['Hunter Henry', 'TE', 'NE', 'Limited Wednesday (foot); Detroit allows the most TE points; TE12.', 'No other New England tight end has a call. Carry a tight end who kicks off at 1:00p or later.', 'gtd', 'C125'],
  ['Jared Goff', 'QB', 'DET', 'Limited Wednesday (chest); 9.0 and 5.3 the last two despite 18.4 a game; QB13.', 'No other Detroit quarterback has a call.', 'sit', 'C13'],
  ['Rhamondre Stevenson', 'RB', 'NE', 'Did not practice Wednesday (knee) and listed as doubtful; TreVeyon Henderson is out (illness).', 'Corey Kiner (SIT).', 'sit', 'C57'],
  ['A.J. Brown', 'WR', 'NE', 'Limited Wednesday (knee, ankle); has not played since Week 7.', 'DeMario Douglas (FLEX, WR19).', 'sit', 'C98'],
];

const INJ_ONE = [
  ['Bhayshul Tuten', 'RB', 'JAX', 'Did not practice Wednesday (ankle, foot); 12 carries on 36% of the snaps last week, but Tennessee allows the 13th-most RB points and Jacksonville is implied for 28.5.', 'Chris Rodriguez Jr. (SIT). Carry a back who kicks off at 4:05p or later.', 'gtd', 'C46'],
  ['Woody Marks', 'RB', 'HOU', 'Limited Wednesday (knee); 18 carries on 66% of the snaps last week, and David Montgomery did not practice (groin).', 'David Montgomery is a sit and did not practice Wednesday, and no other Houston back has a call. Carry a back who kicks off at 4:05p or later.', 'gtd', 'C55'],
  ['Omar Cooper Jr.', 'WR', 'NYJ', 'Limited Wednesday (ankle); 11 targets for 13.8 last week after 22.3 and 22.5, and Buffalo allows the 10th-most WR points.', 'Garrett Wilson (FLEX if active, WR21). Carry a receiver who kicks off at 4:05p or later.', 'gtd', 'C82'],
  ['Garrett Wilson', 'WR', 'NYJ', 'Limited Wednesday in the concussion protocol after missing last week; 28% target share.', 'Omar Cooper Jr. (FLEX if active, WR18). Carry a receiver who kicks off at 4:05p or later.', 'gtd', 'C85'],
  ['Harold Fannin Jr.', 'TE', 'CLE', 'Limited Wednesday (groin); 18% target share and 23.4 two weeks ago, though Houston allows the 7th-fewest TE points.', 'No other Cleveland tight end has a call. Carry a tight end who kicks off at 4:05p or later.', 'gtd', 'C120'],
  ['Dalton Kincaid', 'TE', 'BUF', 'Limited Wednesday (ankle); 10.6 a game, and Buffalo is implied for 29.5.', 'No other Buffalo tight end has a call. Carry a tight end who kicks off at 4:05p or later.', 'gtd', 'C124'],
  ['Kyler Murray', 'QB', 'MIN', 'Did not practice Wednesday (hamstring), listed as doubtful and week-to-week.', 'Kirk Cousins (SIT).', 'sit', 'C15'],
  ['Deshaun Watson', 'QB', 'CLE', 'Named the starter Wednesday after his concussion; 14.7 a game and Cleveland is implied for 18.5.', 'No other Cleveland quarterback has a call.', 'sit', 'C22'],
  ['Alvin Kamara', 'RB', 'NO', 'Did not practice Wednesday (rest, back); 6 carries on 49% of the snaps for 7.9 last week.', 'Audric Estime (FLEX, RB21).', 'sit', 'C53'],
  ['Travis Etienne Jr.', 'RB', 'NO', 'On IR and designated to return, limited Wednesday (hamstring); the Saints decide on activating him at the end of the week.', 'Audric Estime (FLEX, RB21).', 'sit', 'C53'],
  ['David Montgomery', 'RB', 'HOU', 'Did not practice Wednesday (groin); has not played since Week 5.', 'Woody Marks (FLEX if active, RB23).', 'sit', 'C62'],
  ['Denzel Boston', 'WR', 'CLE', 'Did not practice Wednesday (toe); 15.8 last week.', 'KC Concepcion (FLEX, WR22).', 'sit', 'C99'],
  ['Jakobi Meyers', 'WR', 'JAX', 'Did not practice Wednesday (ankle); 4.6 targets a game.', 'Parker Washington (START, WR10).', 'sit', 'C100'],
  ['Carnell Tate', 'WR', 'TEN', 'Did not practice Wednesday (shoulder); last played Week 7.', 'Wan\'Dale Robinson (FLEX, WR26).', 'sit', 'C101'],
  ['Tank Dell', 'WR', 'HOU', 'Limited Wednesday (hand); 20.5 last week on 47% of the snaps.', 'Nico Collins (START, WR11).', 'sit', 'C103'],
  ['T.J. Hockenson', 'TE', 'MIN', 'Did not practice Wednesday (wrist, chest); Green Bay allows the 3rd-fewest TE points; TE14.', 'No other Minnesota tight end has a call.', 'sit', 'C127'],
];

const INJ_LATE = [
  ['Christian McCaffrey', 'RB', 'SF', 'Listed as not practicing Wednesday with no injury given; 22.7 on 18 carries last week, 20.8 a game, and San Francisco is implied for 29.5.', 'Kaelon Black (SIT). Carry a back who kicks off Sunday night or Monday.', 'gtd', 'C35'],
  ['Jaxon Smith-Njigba', 'WR', 'SEA', 'Listed as not practicing Wednesday with no injury given; 36% target share, 25.9 a game, and Las Vegas allows the 12th-most WR points.', 'No other Seattle receiver has a call. Carry a receiver who kicks off Sunday night or Monday.', 'gtd', 'C65'],
  ['George Pickens', 'WR', 'DAL', 'Limited Wednesday (hamstring) after missing last week, and his snaps may be capped; 7.8 targets a game in a 55.5 total.', 'CeeDee Lamb (START, WR3). Carry a receiver who kicks off Sunday night or Monday.', 'gtd', 'C87'],
  ['Drew Lock', 'QB', 'SEA', 'Starts again with Darnold out, limited Wednesday (right elbow, oblique); 12.6 last week, and Las Vegas allows the 3rd-most QB points, so a 2QB start.', 'No other Seattle quarterback has a call.', 'sit', 'C21'],
  ['Deebo Samuel Sr.', 'WR', 'SF', 'Limited Wednesday (hamstring); last played Week 5.', 'Jordan Watkins (FLEX, WR29).', 'sit', 'C96'],
  ['Mike Evans', 'WR', 'SF', 'Did not practice Wednesday (Achilles, ribs); has not played since Week 6.', 'Jordan Watkins (FLEX, WR29).', 'sit', 'C97'],
];

const INJ_NIGHT = [];

const INJ_MNF = [
  ['Justin Herbert', 'QB', 'LAC', 'Left middle finger, imaging negative and expected to play Monday; 10.3 a game and the Chargers are implied for 17.0.', 'No other Chargers quarterback has a call.', 'sit', 'C19'],
  ['Ladd McConkey', 'WR', 'LAC', 'Day-to-day with back spasms and did not play last week; the Chargers are implied for 17.0.', 'No other Chargers receiver has a call.', 'sit', 'C102'],
];

const SLOT = (slot) => GAMES.filter((g) => g.slot === slot).map((g) => <GameCard key={g.id} g={g} />);

const QB_NEXT = 'Sits and unranked: Kirk Cousins, Kyler Murray, Carson Wentz, Geno Smith, Aaron Rodgers, Michael Penix Jr., Justin Herbert, Jacoby Brissett, Drew Lock, Deshaun Watson, Daniel Jones, Cam Ward, J.J. McCarthy, Fernando Mendoza, Carson Beck and Kyle McCord. Out: Lamar Jackson (13.1), Sam Darnold (15.3), Malik Willis (14.7) and Jaxson Dart (16.6). Caleb Williams, Bo Nix and Baker Mayfield are on bye.';
const RB_NEXT = 'Sits: Rhamondre Stevenson, Alvin Kamara, Travis Etienne Jr., Aaron Jones Sr., Jordan Mason, Omarion Hampton, Rachaad White, Blake Corum, David Montgomery, Braelon Allen, Jadarian Price, Pierre Strong Jr., MarShawn Lloyd, Rico Dowdle, and the handcuffs Kaelon Black, Chris Rodriguez Jr., Devin Singletary and Corey Kiner. Out: Josh Jacobs (12.6) and De\'Von Achane (14.8). Swift, Irving, Barkley and Jonah Coleman are on bye.';
const WR_NEXT = 'Sits: Ryan Flournoy, Deebo Samuel Sr., Mike Evans, A.J. Brown, Denzel Boston, Jakobi Meyers, Carnell Tate, Ladd McConkey, Tank Dell, Tre Tucker, DJ Moore, Malik Washington, Devaughn Vele and Xavier Worthy. Out: Puka Nacua (25.0), Davante Adams (16.3), Michael Wilson (13.0), Romeo Doubs (10.0) and Terry McLaurin (9.4). Nobody from Chicago, Denver, Philadelphia or Tampa Bay is ranked.';
const TE_NEXT = 'Sits: Mike Gesicki, Pat Freiermuth, Mason Taylor and Chig Okonkwo. Out: Jake Ferguson. Kyle Pitts Sr. (TE13) and T.J. Hockenson (TE14) are ranked with sit rulings.';
const DST_TIER_NEXT = 'Every D/ST in the top eight has a ruling. Indianapolis faces Miami at 17.5 but has 3.3 a game, so do not chase it.';


const ALREADY_OUT = ['Jeremiyah Love (ARI RB, IR)', 'James Conner (ARI RB, IR)', 'Gardner Minshew II (ARI QB, out for the season)', 'Tyler Huntley (BAL QB, IR)', 'Brian Robinson Jr. (ATL RB, IR)', 'TreVeyon Henderson (NE RB, out, illness)', 'Jaylin Noel (HOU WR, IR)', 'Tyler Goodson (DAL RB, out)', 'Jacory Croskey-Merritt (WAS RB, IR)', 'Jeremy McNichols (WAS RB, out for the season)', 'Tyrone Tracy Jr. (NYG RB, IR)', 'Alec Pierce (IND WR, IR)', 'Colson Yankoff (WAS TE, out Thursday)'];

// Handcuff rows are [team, starter and status, handcuff, verdict].

const HANDCUFFS = [
  ['JAX', 'Bhayshul Tuten: did not practice Wednesday (ankle, foot).', 'Chris Rodriguez Jr.', 'SIT. Limited Wednesday (hand); 10 carries on 45% of the snaps last week, and the lead job only if Tuten sits.'],
  ['SF', 'Christian McCaffrey: listed as not practicing Wednesday, no injury given.', 'Kaelon Black', 'SIT. Takes the work only if McCaffrey sits; 7.0 on 11 carries last week.'],
  ['NYG', 'Cam Skattebo: limited Monday, then full Tuesday and Wednesday (hamstring) after missing last week.', 'Devin Singletary', 'SIT. 21 carries on 93% of the snaps for 5.9 last week; the lead job only if Skattebo sits.'],
  ['NYJ', 'Breece Hall: back last week on 43% of the snaps.', 'Braelon Allen', 'SIT. 8 carries on 59% of the snaps with Hall back, down from 21 the week before.'],
  ['GB', 'Josh Jacobs: listed out (fractured ring finger).', 'Kaleb Johnson', 'FLEX, RB22. 14 carries for 12.8 last week after Josh Jacobs left, and reported as the likely lead back, though Pierre Strong Jr. played more snaps (45% to 39%); Minnesota allows the 6th-fewest RB points. Pierre Strong Jr. is a sit.'],
  ['NO', 'Alvin Kamara: did not practice Wednesday (rest, back). Travis Etienne Jr.: on IR, designated to return.', 'Audric Estime', 'FLEX, RB21. 15 carries for 14.7 last week, and Carolina allows the 2nd-most RB points; Alvin Kamara\'s Wednesday off was a rest day and Travis Etienne Jr. may be activated, so the role is not secure.'],
  ['NE', 'Rhamondre Stevenson: did not practice Wednesday (knee), doubtful. TreVeyon Henderson: out (illness).', 'Corey Kiner', 'SIT. Next up if Stevenson sits; 8 carries on 17% of the snaps last week, and Detroit allows the 3rd-fewest RB points.'],
  ['HOU', 'David Montgomery: did not practice Wednesday (groin).', 'Woody Marks', 'FLEX if active, RB23. Limited Wednesday (knee); 18 carries on 66% of the snaps last week, and David Montgomery did not practice (groin).'],
  ['ARI', 'Jeremiyah Love and James Conner: on IR. Bam Knight: limited Wednesday (concussion).', 'Tyler Allgeier', 'FLEX, RB20. 17 carries on 96% of the snaps last week with Jeremiyah Love and James Conner on IR; Arizona is implied for 15.0, and the Rams allow the 5th-fewest RB points.'],
  ['MIA', 'De\'Von Achane: on IR (knee).', 'Ollie Gordon II', 'FLEX, RB19. 16 carries on 72% of the snaps last week, 15.3 carries a game; Indianapolis allows the 6th-most RB points, though Miami is implied for 17.5.'],
  ['SEA', 'Zach Charbonnet: a flex.', 'Jadarian Price', 'SIT. 9 carries on 36% of the snaps last week; the No. 2 behind Charbonnet.'],
  ['LAR', 'Kyren Williams: a start.', 'Blake Corum', 'SIT. 11 carries on 36% of the snaps last week; the No. 2 behind Kyren Williams.'],
  ['TEN', 'Tony Pollard: a start.', 'Tyjae Spears', 'No ruling, no call. Did not practice Wednesday (knee).'],
];

// IDP rows are [player, team, position, opponent, note].

const IDP_TABLE = [
  ['Arvell Reese', 'NYG', 'LB', 'vs WAS (Thursday)', '11.8 a game, 25.0 last week'],
  ['Greg Rousseau', 'BUF', 'LB', 'at NYJ', '11.0 a game, 10.5 and 10.0 the last two'],
  ['Nakobe Dean', 'LV', 'LB', 'vs SEA', '10.9 a game, 13.5 last week'],
  ['Evan Williams', 'GB', 'S', 'vs MIN', '10.8 a game, 11.5 last week'],
  ['David Bailey', 'NYJ', 'LB', 'vs BUF', '10.3 a game, 21.0 last week'],
  ['Fred Warner', 'SF', 'LB', 'at DAL', '9.7 a game, 9.0 last week'],
  ['George Karlaftis', 'KC', 'DE', 'at ATL', '9.6 a game, 11.0 and 16.0 the last two'],
  ['Foyesade Oluokun', 'JAX', 'LB', 'at TEN', '9.6 a game, 12.0 and 10.5 the last two'],
];

const IDP_AVOID = 'Blake Cashman is in the concussion protocol and did not practice Wednesday. Tremaine Edmunds is on IR. Bobby Okereke did not practice Wednesday, and Carson Schwesinger (wrist) was limited.';

const SLEEPERS = [
  ['Kaleb Johnson', 'FLEX, RB22. 14 carries for 12.8 last week after Josh Jacobs left, and reported as the likely lead back, though Pierre Strong Jr. played more snaps (45% to 39%); Minnesota allows the 6th-fewest RB points.', 'RB'],
  ['Audric Estime', 'FLEX, RB21. 15 carries for 14.7 last week, and Carolina allows the 2nd-most RB points; Alvin Kamara\'s Wednesday off was a rest day and Travis Etienne Jr. may be activated, so the role is not secure.', 'RB'],
  ['KC Concepcion', 'FLEX, WR22. 18.8 last week on 93% of the snaps; Denzel Boston did not practice Wednesday (toe), and Houston allows the 3rd-most WR points.', 'WR'],
  ['Jordan Watkins', 'FLEX, WR29. 18.6 last week on 77% of the snaps; Mike Evans did not practice again, and San Francisco is implied for 29.5.', 'WR'],
  ['Darren Waller', 'START, TE9. 10 targets for 23.0 last week; New Orleans allows the 8th-most TE points.', 'TE'],
];

const FADES = [
  ['Matthew Stafford', 'SIT, QB14. 8.3 and 11.2 the last two, and Puka Nacua is out with Davante Adams on IR; Arizona allows the 2nd-most QB points; QB14.', 'QB'],
  ['Jared Goff', 'SIT, QB13. Limited Wednesday (chest); 9.0 and 5.3 the last two despite 18.4 a game; QB13.', 'QB'],
  ['Alvin Kamara', 'SIT. Did not practice Wednesday (rest, back); 6 carries on 49% of the snaps for 7.9 last week.', 'RB'],
  ['Braelon Allen', 'SIT. 8 carries on 59% of the snaps with Hall back, down from 21 the week before.', 'RB'],
  ['Kyle Pitts Sr.', 'SIT, TE13. 2.6 and 5.3 the last two; Kansas City allows the 6th-most TE points; TE13.', 'TE'],
];

const PIVOTS = [
  ['Cam Skattebo out', 'Devin Singletary (SIT) takes the lead job.'],
  ['St. Brown out', 'Jameson Williams (START, WR13) gets more of the passing game.'],
  ['Hunter Henry out', 'No other New England tight end has a call. Carry a tight end who kicks off at 1:00p or later.'],
  ['Bhayshul Tuten out', 'Chris Rodriguez Jr. (SIT) takes the lead job.'],
  ['Woody Marks out', 'David Montgomery is a sit and did not practice Wednesday, so no other Houston back has a call. Carry a back who kicks off at 4:05p or later.'],
  ['Omar Cooper Jr. out', 'Garrett Wilson (FLEX if active, WR21) is the other Jets receiver with a call.'],
  ['Garrett Wilson out', 'Omar Cooper Jr. (FLEX if active, WR18) is the other Jets receiver with a call.'],
  ['Harold Fannin Jr. out', 'No other Cleveland tight end has a call. Carry a tight end who kicks off at 4:05p or later.'],
  ['Dalton Kincaid out', 'No other Buffalo tight end has a call. Carry a tight end who kicks off at 4:05p or later.'],
  ['Josh Jacobs out (already)', 'Kaleb Johnson (FLEX, RB22) is the likely lead back.'],
  ['De\'Von Achane out (already)', 'Ollie Gordon II (FLEX, RB19) is the other Miami back with a call.'],
  ['Malik Willis out (already)', 'Kyle McCord (SIT) is in line for his first start.'],
  ['Christian McCaffrey out', 'Kaelon Black (SIT) takes the work.'],
  ['Jaxon Smith-Njigba out', 'No other Seattle receiver has a call. Carry a receiver who kicks off Sunday night or Monday.'],
  ['George Pickens out', 'CeeDee Lamb (START, WR3) is the higher-ranked Dallas receiver.'],
  ['Jake Ferguson out (already)', 'No other Dallas tight end has a call.'],
  ['Puka Nacua out (already)', 'No other Rams receiver has a call. Carry a receiver who kicks off Sunday night or Monday.'],
  ['Sam Darnold out (already)', 'Drew Lock (SIT) is slated to start.'],
  ['Michael Wilson out (already)', 'No other Arizona receiver has a call. Carry a receiver who kicks off Sunday night or Monday.'],
  ['Lamar Jackson out (already)', 'Jacoby Brissett (SIT) is expected to start Monday.'],
];

const CHECK_THU = [
  ['Cam Skattebo (NYG RB).', 'Active: FLEX. Out: Devin Singletary (SIT) takes the lead job.'],
  ['Everyone else on the card.', 'Thursday locks first: make any swap between the 6:45p ET inactives and the 8:15p ET kickoff.'],
];

const CHECK_INTL = [
  ['Amon-Ra St. Brown (DET WR).', 'Active: START. Out: Jameson Williams (START, WR13) gets more of the passing game.'],
  ['Hunter Henry (NE TE).', 'Active: START. Out: no other New England tight end has a call. Carry a tight end who kicks off at 1:00p or later.'],
  ['Sits either way.', 'Jared Goff, Rhamondre Stevenson and A.J. Brown.'],
];

const CHECK_ONE = [
  ['Bhayshul Tuten (JAX RB).', 'Active: FLEX. Out: Chris Rodriguez Jr. (SIT) takes the lead job.'],
  ['Woody Marks (HOU RB).', 'Active: FLEX. Out: David Montgomery is a sit and did not practice Wednesday, so no other Houston back has a call. Carry a back who kicks off at 4:05p or later.'],
  ['Omar Cooper Jr. (NYJ WR).', 'Active: FLEX. Out: Garrett Wilson (FLEX if active, WR21) is the other Jets receiver with a call.'],
  ['Garrett Wilson (NYJ WR).', 'Active: FLEX. Out: Omar Cooper Jr. (FLEX if active, WR18) is the other Jets receiver with a call.'],
  ['Harold Fannin Jr. (CLE TE).', 'Active: START. Out: no other Cleveland tight end has a call. Carry a tight end who kicks off at 4:05p or later.'],
  ['Dalton Kincaid (BUF TE).', 'Active: START. Out: no other Buffalo tight end has a call. Carry a tight end who kicks off at 4:05p or later.'],
  ['Sits either way.', 'Kyler Murray, Deshaun Watson, Alvin Kamara, Travis Etienne Jr., David Montgomery, Denzel Boston, Jakobi Meyers, Carnell Tate, Tank Dell and T.J. Hockenson.'],
];

const CHECK_LATE = [
  ['Christian McCaffrey (SF RB).', 'Active: START. Out: Kaelon Black (SIT) takes the work.'],
  ['Jaxon Smith-Njigba (SEA WR).', 'Active: START. Out: no other Seattle receiver has a call. Carry a receiver who kicks off Sunday night or Monday.'],
  ['George Pickens (DAL WR).', 'Active: FLEX. Out: CeeDee Lamb (START, WR3) is the higher-ranked Dallas receiver.'],
  ['Sits either way.', 'Drew Lock, Deebo Samuel Sr. and Mike Evans.'],
];

const CHECK_SNF = [
  ['Nobody on this card has an if-active call.', 'The Pittsburgh at Cincinnati starts are Joe Burrow, Ja\'Marr Chase, Tee Higgins, Chase Brown and Jaylen Warren.'],
];

const CHECK_MNF = [
  ['Sits either way.', 'Justin Herbert and Ladd McConkey.'],
  ['Everyone else on the card.', 'Monday is the last window, so a scratch here has no later game to pivot to.'],
];

const Body = () => (
  <>
    <HeroBanner />

    <Lead>
      Fourteen games, Thursday through Monday. Chicago, Denver, Philadelphia and Tampa Bay are on bye, so 28 teams play.
      Washington at the Giants kicks off first, Thursday at 8:15p ET. New England at Detroit plays in Munich at 9:30a ET Sunday, Pittsburgh at Cincinnati is the Sunday night game, and the Chargers at Baltimore closes the week Monday. Baltimore traded for Jacoby Brissett, who is expected to start Monday, and Lamar Jackson and Tyler Huntley are on IR. Puka Nacua is out with knee sprains and turf toe, and Josh Jacobs is listed out for Green Bay. Every call is here. Set your Thursday lineup first, and set your pivots before you go to bed Saturday.
    </Lead>

    <Note title="Read this first">
      <strong>Lines are our database as of Nov 12, 8:27am ET. Weather as of 6:27am ET. Practice notes
      are the Wednesday reports; no Thursday report was published at writing.</strong>{' '}
      Updates since Tuesday&apos;s waiver column:
      <Box component="ul" sx={{ pl: 2.5, m: '8px 0 0 !important' }}>
        <li>Baltimore traded for Jacoby Brissett (finalized Friday); he is expected to start Monday. Lamar Jackson and Tyler Huntley are on IR.</li>
        <li>Arizona: Gardner Minshew II is out for the season (elbow surgery), Michael Wilson is on IR (neck), and Carson Beck is first on the depth chart.</li>
        <li>Miami placed Malik Willis on IR (groin); Kyle McCord is in line for his first start.</li>
        <li>Rams: Puka Nacua is out (knee sprains, turf toe) and expected to miss at least a month; Davante Adams stays on IR.</li>
        <li>Green Bay: Josh Jacobs is listed out (fractured ring finger, surgery planned). Kaleb Johnson is reported as the likely lead back.</li>
        <li>Seattle ruled Sam Darnold out again; Drew Lock starts.</li>
        <li>Cleveland named Deshaun Watson the starter Wednesday.</li>
        <li>Our data lists Kirk Cousins with Minnesota, first on its depth chart; no report I could find names Minnesota&apos;s starter, and Kyler Murray did not practice (hamstring).</li>
        <li>New England in Munich: TreVeyon Henderson is out (illness) and Rhamondre Stevenson did not practice (knee).</li>
      </Box>
      Re-check the Thursday and Friday reports and the inactives before you lock anything. Every window below says
      when the inactives drop. Every time on this page is Eastern.
    </Note>

    <P>
      Scoring is PPR. Chicago, Denver, Philadelphia and Tampa Bay are on bye, so nobody from those four is ranked or called.
      Where an engine projection is a placeholder (an injured or inactive player the model still scores),
      I say so and lean on usage.
    </P>
    <RailList
      items={[
        ['FPA rank', '1 means the defense allows the most points to that position (a good matchup), 32 the fewest (tough). Weeks 1 to 9.'],
        ['Verdicts', 'START, FLEX, SIT and OUT are the rulings. "If active" calls are void if the player does not appear, and they sit in the game-time group of each card.'],
        ['Tiers', 'QB 14, RB 24, WR 30, TE 14 and D/ST 8, in the order I rank them. A player ranked without a ruling says so.'],
        ['Ruling links', 'Every call on a card links to its Darkness Ruling (C1 to C140) with the reason.'],
      ]}
    />

    <JumpGrid games={GAMES} />

    <H2>The Slate Board</H2>
    <P>
      Every game, in kickoff order with Thursday first: line, total, weather and both implied totals on
      one scale. Filled bars are the favorites. San Francisco at Dallas has the highest total, 55.5, then
      New England at Detroit at 51.5 and Buffalo at the Jets at 50.5. Miami at Indianapolis and the Chargers
      at Baltimore share the lowest total, 38.5. Buffalo and San Francisco have the highest implied totals,
      29.5, then Jacksonville at 28.5, Detroit at 27.0 and Cincinnati at 26.5. Arizona has the lowest, 15.0,
      then the Chargers and Las Vegas at 17.0. Jacksonville (-10.5), the Rams (-9.5) and Buffalo (-8.5) are
      the biggest favorites.
    </P>
    <SlateBoard games={GAMES} />
    <P>
      New Orleans and Las Vegas play indoors. Munich has no forecast in our data. Wind tops out at 12 mph
      in the two MetLife games, Thursday and Buffalo at the Jets. Thursday at MetLife has a 74% chance of
      light rain. Dallas has a retractable roof and a 69% chance of showers outside, and Cleveland has a 23%
      chance of showers. Only Thursday&apos;s rain is worth a thought, and it is already in the Washington
      and Giants rulings.
    </P>

    <H2>The Injury Board</H2>
    <P>
      The practice notes here are the Wednesday reports. The decision rules are simple, and I apply them
      the same way to every name on this page.
    </P>
    <RailList
      color="var(--warning)"
      items={[
        ['"If active" calls', 'are void if the player does not appear. A call that turns on a practice report carries that injury on its card.'],
        ['Engine placeholders', 'Nacua, Adams, Michael Wilson, Doubs, McLaurin, Jacobs, Achane, Ferguson, Darnold, Willis, Dart and Lamar Jackson carry a projection. Each has an OUT ruling, so the projection is a placeholder.'],
        ['Byes', 'Chicago, Denver, Philadelphia and Tampa Bay: nobody is ranked or called.'],
      ]}
    />
    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, my: 2 }}>
      <Chip tone="var(--accent)">Thursday: about 6:45p ET</Chip>
      <Chip tone="var(--accent)">Munich: about 8:00a ET Sunday</Chip>
      <Chip tone="var(--accent)">1:00p games: about 11:30a ET</Chip>
      <Chip tone="var(--accent)">4:05p / 4:25p: about 2:35p / 2:55p ET</Chip>
      <Chip tone="var(--accent)">SNF: about 6:50p ET</Chip>
      <Chip tone="var(--accent)">MNF: about 6:45p ET Monday</Chip>
    </Box>

    <InjuryGroup title="Out, or treat as out" when="Engine projections for these players are placeholders." rows={INJ_OUT} />
    <InjuryGroup title="Thursday" when="Inactives about 6:45p ET" rows={INJ_THU} />
    {INJ_INTL.length ? <InjuryGroup title="Munich" when="Inactives about 8:00a ET" rows={INJ_INTL} /> : null}
    <InjuryGroup title="1:00p games" when="Inactives about 11:30a ET" rows={INJ_ONE} />
    <InjuryGroup title="Late window" when="Inactives about 2:35p / 2:55p ET" rows={INJ_LATE} />
    <InjuryGroup title="Sunday night" when="Inactives about 6:50p ET" rows={INJ_NIGHT} />
    <InjuryGroup title="Monday night" when="Inactives about 6:45p ET Monday; no later window" rows={INJ_MNF} />
    <Box component="h3" sx={{ m: '24px 0 8px !important', fontSize: '1.15rem !important' }}>Already out for the week or longer</Box>
    <Box component="p" sx={{ mt: '0 !important', fontSize: '0.92rem', color: 'var(--text-muted)', lineHeight: 1.6 }}>
      {ALREADY_OUT.join('; ')}.
    </Box>

    <H2>Thursday Night</H2>
    <P>
      One game, and it kicks off first. Washington at the Giants is at MetLife at 8:15p ET, with a 74% chance
      of light rain and wind at 12 mph. Inactives drop about 6:45p ET. Set your lineup before you do anything
      else on Thursday.
    </P>
    {SLOT('thu')}

    <H2>Sunday Morning in Munich</H2>
    <P>
      New England at Detroit kicks off at 9:30a ET Sunday in Munich, the first kickoff of the Sunday slate.
      Inactives drop about 8:00a ET. TreVeyon Henderson is out (illness), and Rhamondre Stevenson did not
      practice Wednesday (knee).
    </P>
    {SLOT('intl')}

    <H2>The 1:00p Window</H2>
    <P>
      Seven games at 1:00p ET. Nothing kicks between 1:00p and 4:05p, so a 1:00p decision needs a
      4:05p-or-later swap on your bench. Inactives about 11:30a ET.
    </P>
    {SLOT('one')}

    <H2>Late Window</H2>
    <P>
      Three games, two at 4:05p and one at 4:25p. The Rams at Arizona and Seattle at Las Vegas kick off at
      4:05p, and San Francisco at Dallas kicks off at 4:25p. Inactives drop about 2:35p ET for the 4:05p games
      and about 2:55p ET for the 4:25p game.
    </P>
    {SLOT('late')}

    <H2>Prime Time</H2>
    <P>
      Sunday night is Pittsburgh at Cincinnati at 8:20p ET, and Monday night is the Chargers at Baltimore at
      8:15p ET, the last window. Inactives drop about 6:50p ET Sunday and about 6:45p ET Monday. Jacoby
      Brissett is expected to start for Baltimore. Practice notes here are from Wednesday, so hold the Monday
      read loosely.
    </P>
    {SLOT('prime')}

    <H2>Position Tiers</H2>
    <P>
      The rankings for the Thursday through Monday slate. The bands follow my written verdict on each
      player: START, FLEX or SIT. A player I ranked without a ruling is listed under RANKED, NO CALL. The
      note under each name is the reason from his ruling.
    </P>
    <H3>Quarterback, top 14</H3>
    <TierBoard pos="QB" rows={QB_ROWS} next={QB_NEXT} />
    <H3>Running back, top 24</H3>
    <TierBoard pos="RB" rows={RB_ROWS} next={RB_NEXT} />
    <H3>Wide receiver, top 30</H3>
    <TierBoard pos="WR" rows={WR_ROWS} next={WR_NEXT} />
    <H3>Tight end, top 14</H3>
    <TierBoard pos="TE" rows={TE_ROWS} next={TE_NEXT} />
    <H3>D/ST, top 8</H3>
    <TierBoard pos="DST" rows={DST_ROWS} next={DST_TIER_NEXT} />

    <H2>Handcuff Board</H2>
    <P>
      The starter&apos;s report decides the handcuff, so read this beside the Injury Board. The verdict is
      for Week 10 and nothing else. A handcuff with no ruling gets no call.
    </P>
    <Table aria-label="Week 10 handcuff board">
      <THead>
        <TR>
          <TH scope="col">Team</TH><TH scope="col">Starter and status</TH><TH scope="col">Handcuff</TH><TH scope="col">Verdict</TH>
        </TR>
      </THead>
      <TBody>
        {HANDCUFFS.map(([team, starter, cuff, verdict]) => (
          <TR key={team}><TD><strong>{team}</strong></TD><TD>{starter}</TD><TD><strong>{cuff}</strong></TD><TD>{verdict}</TD></TR>
        ))}
      </TBody>
    </Table>

    <H2>D/ST Streaming Board</H2>
    <P>
      Each row is a D/ST and the offense it faces. &quot;Opp implied&quot; is the points the opposing offense
      is expected to score. Among these matchups, the two lowest opposing totals are Arizona (15) and
      Las Vegas (17), faced by the Rams and Seattle.
    </P>
    <Table aria-label="Week 10 D/ST streaming board">
      <THead>
        <TR>
          <TH scope="col">D/ST</TH><TH scope="col">Opponent</TH><TH scope="col">Opp implied</TH><TH scope="col">Verdict</TH><TH scope="col">Why</TH>
        </TR>
      </THead>
      <TBody>
        {DST_TABLE.map(([team, opp, imp, verdict, why]) => (
          <TR key={team}><TD><strong>{team}</strong></TD><TD>{opp}</TD><TD>{imp}</TD><TD>{verdict}</TD><TD>{why}</TD></TR>
        ))}
      </TBody>
    </Table>

    <H2>IDP Streamers</H2>
    <P>
      Each streamer comes with the numbers behind the call. Check your own wire before you add one.
    </P>
    <Table aria-label="Week 10 IDP streamers">
      <THead>
        <TR>
          <TH scope="col">Player</TH><TH scope="col">Team</TH><TH scope="col">Pos</TH><TH scope="col">Opp</TH><TH scope="col">Note</TH>
        </TR>
      </THead>
      <TBody>
        {IDP_TABLE.map(([name, team, pos, opp, note]) => (
          <TR key={name}><TD><strong>{name}</strong></TD><TD>{team}</TD><TD>{pos}</TD><TD>{opp}</TD><TD>{note}</TD></TR>
        ))}
      </TBody>
    </Table>
    <P>{IDP_AVOID}</P>

    <H2>Sleepers, Fades and Pivots</H2>
    <H3>Sleepers</H3>
    <P>Lower-profile names. Check your own wire before you add one.</P>
    <RailList color="var(--success)" items={SLEEPERS} />
    <H3>Busts and fades</H3>
    <RailList color="var(--danger)" items={FADES} />
    <H3>If he is out, pivot to</H3>
    <P>
      The whole contingency list in one place. If the first name is out at his inactive window, this
      is your next move.
    </P>
    <RailList color="var(--warning)" items={PIVOTS} />

    <H2>The Darkness Rulings</H2>
    <P>
      One hundred and forty rulings, C1 to C140, and 154 calls inside them. Each one is here with
      its reason.
    </P>
    {RULINGS.map((r) => <RulingCard key={r[0]} r={r} />)}

    <H2>Inactives Checklist</H2>
    <P>
      Inactives drop about 90 minutes before each kickoff. Windows are Eastern time. Thursday is the first
      window, so start there.
    </P>
    <WindowChecklist title="Thursday inactives" time="about 6:45p ET" rows={CHECK_THU} />
    <WindowChecklist title="Munich inactives" time="about 8:00a ET Sunday" rows={CHECK_INTL} />
    <WindowChecklist title="1:00p inactives" time="about 11:30a ET" rows={CHECK_ONE} />
    <WindowChecklist title="4:05p and 4:25p inactives" time="about 2:35p and 2:55p ET" rows={CHECK_LATE} />
    <WindowChecklist title="Sunday night inactives" time="about 6:50p ET" rows={CHECK_SNF} />
    <WindowChecklist title="Monday night inactives" time="about 6:45p ET Monday" rows={CHECK_MNF} />

    <Quote>
      Start the names the rulings start, lean on usage, and have your pivots set before Sunday&apos;s
      9:30a Munich kickoff. The reports still to come may change any of it.
    </Quote>
  </>
);

export default Body;
