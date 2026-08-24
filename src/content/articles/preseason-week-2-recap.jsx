import React from 'react';
import { Box } from '@mui/material';
import {
  Lead, P, H2, H3, Quote, UL, LI, Link,
  Table, THead, TBody, TR, TH, TD,
} from '../../components/public/kit/Prose';

const NFL_WEEK_2 = 'https://www.nfl.com/schedules/2026/by-week/preseason-week-2';
const NFL_THURSDAY = 'https://www.nfl.com/news/2026-nfl-preseason-week-2-what-we-learned-thursday-games';
const NFL_FRIDAY = 'https://www.nfl.com/news/2026-nfl-preseason-week-2-what-we-learned-friday-games';
const NFL_SATURDAY = 'https://www.nfl.com/news/2026-nfl-preseason-week-2-what-we-learned-saturday-games';
const NFL_SUNDAY = 'https://www.nfl.com/news/2026-nfl-preseason-week-2-what-we-learned-seahawks-titans';
const NFL_INJURIES = 'https://www.nfl.com/news/nfl-roundup-latest-league-news-from-sunday-aug-23';

function HeroBanner() {
  return (
    <Box
      component="svg"
      viewBox="0 0 800 300"
      xmlns="http://www.w3.org/2000/svg"
      sx={{
        width: '100%',
        borderRadius: 'var(--radius-md, 12px)',
        overflow: 'hidden',
        mb: 4,
        display: 'block',
      }}
      role="img"
      aria-labelledby="week2-hero-title week2-hero-description"
    >
      <title id="week2-hero-title">NFL Preseason Week 2 fantasy stock watch</title>
      <desc id="week2-hero-description">
        An original editorial illustration of a quarterback scanning a football field while
        draft-stock arrows rise and fall behind him.
      </desc>
      <defs>
        <linearGradient id="week2-field" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#071d17" />
          <stop offset="0.55" stopColor="#164a35" />
          <stop offset="1" stopColor="#0b2b22" />
        </linearGradient>
        <linearGradient id="week2-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#152d4d" />
          <stop offset="1" stopColor="#071d17" />
        </linearGradient>
      </defs>
      <rect width="800" height="300" fill="url(#week2-sky)" />
      <path d="M0 112 Q200 70 400 112 T800 112 V300 H0Z" fill="url(#week2-field)" />
      {[80, 180, 280, 380, 480, 580, 680, 780].map((x) => (
        <line key={x} x1={x} y1="118" x2={x - 42} y2="300" stroke="rgba(255,255,255,0.13)" />
      ))}
      <path d="M112 218 C170 154 229 152 295 205" fill="none" stroke="#5fe2a0" strokeWidth="8" strokeLinecap="round" />
      <path d="M282 191 L298 207 L276 211" fill="none" stroke="#5fe2a0" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M688 166 C637 223 584 230 520 192" fill="none" stroke="#ff7777" strokeWidth="8" strokeLinecap="round" />
      <path d="M537 188 L518 190 L527 209" fill="none" stroke="#ff7777" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="400" cy="158" r="30" fill="#d7a46e" />
      <path d="M366 144 Q400 112 434 144 L428 158 Q400 145 372 158Z" fill="#f3f5f7" />
      <path d="M381 176 Q400 164 419 176 L450 250 H350Z" fill="#edf2f5" />
      <path d="M350 196 L310 238" stroke="#d7a46e" strokeWidth="18" strokeLinecap="round" />
      <path d="M450 196 L490 230" stroke="#d7a46e" strokeWidth="18" strokeLinecap="round" />
      <ellipse cx="512" cy="218" rx="28" ry="17" fill="#7b4126" transform="rotate(-18 512 218)" />
      <path d="M496 217 L528 217" stroke="#f5e5cf" strokeWidth="3" />
      <path d="M507 208 L510 227 M515 207 L518 225" stroke="#f5e5cf" strokeWidth="2" />
      <rect x="96" y="24" width="608" height="76" rx="14" fill="rgba(3,12,20,0.76)" />
      <text x="400" y="57" textAnchor="middle" fill="#ffffff" fontFamily="system-ui, sans-serif" fontWeight="850" fontSize="30" letterSpacing="1">PRESEASON WEEK 2</text>
      <text x="400" y="84" textAnchor="middle" fill="#c9d8e6" fontFamily="system-ui, sans-serif" fontWeight="650" fontSize="15" letterSpacing="3">DRAFT STOCK • ROOKIES • DEFENSE • INJURIES</text>
    </Box>
  );
}

function StockPulseGraphic() {
  const risers = [
    'STRIBLING',
    'BROOKS',
    'WASHINGTON',
    'YOUNG',
  ];
  const fallers = [
    'WARD',
    'MENDOZA',
    'TRACY',
  ];
  return (
    <Box
      component="svg"
      viewBox="0 0 760 310"
      xmlns="http://www.w3.org/2000/svg"
      sx={{ width: '100%', display: 'block', my: 3, color: 'text.primary' }}
      aria-hidden="true"
      focusable="false"
    >
      <rect x="1" y="1" width="758" height="308" rx="16" fill="var(--surface-sunken)" stroke="var(--border-subtle)" />
      <text x="36" y="42" fill="var(--text-primary)" fontFamily="system-ui, sans-serif" fontWeight="800" fontSize="18">WEEK 2 SIGNAL BOARD</text>
      <text x="36" y="70" fill="var(--success)" fontFamily="system-ui, sans-serif" fontWeight="750" fontSize="14">RISERS</text>
      {risers.map((name, index) => {
        const y = 94 + index * 38;
        return (
          <React.Fragment key={name}>
            <text x="36" y={y + 14} fill="var(--text-muted)" fontFamily="system-ui, sans-serif" fontWeight="700" fontSize="12">{name}</text>
            <rect x="150" y={y} width="200" height="16" rx="8" fill="var(--surface-raised)" />
            <rect x="150" y={y} width="160" height="16" rx="8" fill="var(--success)" />
          </React.Fragment>
        );
      })}
      <line x1="390" y1="68" x2="390" y2="270" stroke="var(--border-strong)" />
      <text x="426" y="70" fill="var(--danger)" fontFamily="system-ui, sans-serif" fontWeight="750" fontSize="14">FALLERS</text>
      {fallers.map((name, index) => {
        const y = 94 + index * 48;
        return (
          <React.Fragment key={name}>
            <text x="426" y={y + 14} fill="var(--text-muted)" fontFamily="system-ui, sans-serif" fontWeight="700" fontSize="12">{name}</text>
            <rect x="530" y={y} width="190" height="16" rx="8" fill="var(--surface-raised)" />
            <rect x="572" y={y} width="148" height="16" rx="8" fill="var(--danger)" />
          </React.Fragment>
        );
      })}
      <text x="426" y="254" fill="var(--text-muted)" fontFamily="system-ui, sans-serif" fontSize="12">Directional signals, not a ranked scale</text>
      <text x="36" y="286" fill="var(--text-muted)" fontFamily="system-ui, sans-serif" fontSize="12">Preseason evidence is weighted by role, personnel and sample size.</text>
    </Box>
  );
}

function DefensiveImpactGraphic() {
  return (
    <Box
      component="svg"
      viewBox="0 0 760 220"
      xmlns="http://www.w3.org/2000/svg"
      sx={{ width: '100%', display: 'block', my: 3, color: 'text.primary' }}
      role="img"
      aria-label="Original illustration of a pass rush closing a pocket and an interception return breaking toward the end zone"
    >
      <rect x="1" y="1" width="758" height="218" rx="16" fill="var(--surface-sunken)" stroke="var(--border-subtle)" />
      <path d="M60 42 H700 M60 178 H700" stroke="var(--border-strong)" strokeDasharray="8 10" />
      <circle cx="380" cy="110" r="24" fill="var(--accent)" />
      <path d="M190 58 C265 58 290 88 348 102 M190 162 C265 162 290 132 348 118" fill="none" stroke="var(--pos-idp)" strokeWidth="12" strokeLinecap="round" />
      <path d="M570 110 C620 110 650 80 690 54" fill="none" stroke="var(--warning)" strokeWidth="9" strokeLinecap="round" strokeDasharray="14 10" />
      <path d="M674 51 L694 52 L687 70" fill="none" stroke="var(--warning)" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />
      <ellipse cx="548" cy="110" rx="22" ry="13" fill="var(--warning)" transform="rotate(-18 548 110)" />
      <text x="380" y="204" textAnchor="middle" fill="var(--text-muted)" fontFamily="system-ui, sans-serif" fontSize="13">PRESSURE CHANGES THE THROW. BALL SKILLS CHANGE THE GAME.</text>
    </Box>
  );
}

const W = ({ children }) => <strong>{children}</strong>;

const Body = () => (
  <>
    <HeroBanner />

    <Lead>
      Preseason Week 2 gave fantasy managers something more useful than August box-score heat:
      repeat production, first-team role clues, and a few hard availability changes. The trick is
      separating a player who earned another look from one who actually earned a new draft price.
      Here is the full, source-backed read from all 16 games.
    </Lead>

    <H2>The Scoreboard</H2>
    <Table aria-labelledby="the-scoreboard">
      <THead>
        <TR><TH scope="col">Away</TH><TH scope="col">Score</TH><TH scope="col">Home</TH><TH scope="col">Score</TH></TR>
      </THead>
      <TBody>
        <TR><TD><W>Raiders</W></TD><TD><W>22</W></TD><TD>Texans</TD><TD>20</TD></TR>
        <TR><TD><W>49ers</W></TD><TD><W>41</W></TD><TD>Chargers</TD><TD>17</TD></TR>
        <TR><TD><W>Jets</W></TD><TD><W>17</W></TD><TD>Steelers</TD><TD>0</TD></TR>
        <TR><TD><W>Panthers</W></TD><TD><W>34</W></TD><TD>Jaguars</TD><TD>17</TD></TR>
        <TR><TD><W>Packers</W></TD><TD><W>33</W></TD><TD>Broncos</TD><TD>13</TD></TR>
        <TR><TD>Commanders</TD><TD>13</TD><TD><W>Lions</W></TD><TD><W>17</W></TD></TR>
        <TR><TD><W>Bills</W></TD><TD><W>31</W></TD><TD>Browns</TD><TD>7</TD></TR>
        <TR><TD><W>Falcons</W></TD><TD><W>34</W></TD><TD>Colts</TD><TD>6</TD></TR>
        <TR><TD><W>Ravens</W></TD><TD><W>13</W></TD><TD>Vikings</TD><TD>3</TD></TR>
        <TR><TD>Saints</TD><TD>0</TD><TD><W>Rams</W></TD><TD><W>34</W></TD></TR>
        <TR><TD><W>Giants</W></TD><TD><W>26</W></TD><TD>Dolphins</TD><TD>3</TD></TR>
        <TR><TD>Bears</TD><TD>9</TD><TD><W>Bengals</W></TD><TD><W>27</W></TD></TR>
        <TR><TD>Eagles</TD><TD>21</TD><TD><W>Patriots</W></TD><TD><W>24</W></TD></TR>
        <TR><TD>Chiefs</TD><TD>15</TD><TD><W>Buccaneers</W></TD><TD><W>16</W></TD></TR>
        <TR><TD><W>Cowboys</W></TD><TD><W>34</W></TD><TD>Cardinals</TD><TD>13</TD></TR>
        <TR><TD>Seahawks</TD><TD>16</TD><TD><W>Titans</W></TD><TD><W>19</W></TD></TR>
      </TBody>
    </Table>
    <P>
      The <Link to={NFL_WEEK_2}>NFL&apos;s official Week 2 results</Link> produced four shutout-or-near-
       shutout statements: New York blanked Pittsburgh, the Rams blanked New Orleans, and the
      Giants and Ravens held their opponents to three points. Those scores matter less for fantasy
      drafts than who created them, but they frame a weekend when reserve defenses repeatedly
      dictated the game.
    </P>

    <H2>The Draft-Room Read</H2>
    <Table aria-labelledby="the-draft-room-read">
      <THead>
        <TR><TH scope="col">Player</TH><TH scope="col">Signal</TH><TH scope="col">Draft response</TH></TR>
      </THead>
      <TBody>
        <TR><TD>De&apos;Zhaun Stribling</TD><TD>Rising</TD><TD>Late-round watch</TD></TR>
        <TR><TD>Jonathon Brooks</TD><TD>Rising</TD><TD>Price the role, not the TD</TD></TR>
        <TR><TD>Mike Washington Jr.</TD><TD>Rising</TD><TD>Deep bench and dynasty</TD></TR>
        <TR><TD>Colbie Young</TD><TD>Rising</TD><TD>Deep-league watch</TD></TR>
        <TR><TD>Cam Ward</TD><TD>Falling</TD><TD>Redraft caution</TD></TR>
        <TR><TD>Fernando Mendoza</TD><TD>Falling</TD><TD>Developmental warning</TD></TR>
        <TR><TD>Tyrone Tracy Jr.</TD><TD>Falling</TD><TD>Role-security concern</TD></TR>
      </TBody>
    </Table>
    <StockPulseGraphic />

    <H2>Fantasy Stock Risers</H2>

    <H3>De&apos;Zhaun Stribling, WR, San Francisco 49ers</H3>
    <P>
      Stribling followed seven catches for 63 yards in the opener with four catches on five targets
      for 46 yards in just 14 snaps. That is 11 receptions and 109 yards across two games, but the
      repeatability matters more than the sum. He is earning targets quickly while San Francisco
      sorts through receiver availability. That makes the second-round rookie a legitimate
      late-round watch—not proof of a regular-season target share. <Link to={NFL_THURSDAY}>NFL
      Week 2 report</Link>.
    </P>

    <H3>Jonathon Brooks, RB, Carolina Panthers</H3>
    <P>
      Brooks started, carried five times for 18 yards and finished Carolina&apos;s second possession
      with a 1-yard touchdown. The better sequence came before the score: an 11-yard burst, then a
      clean protection rep after he had missed an assignment on the prior series. Chuba Hubbard
      did not play, so Brooks did not settle the backfield. He did show that Carolina trusts him
      for first-team and goal-line work. Draft the expanding role, not a preseason touchdown.
      {' '}<Link to="https://www.panthers.com/news/rapid-reactions-panthers-beat-the-jaguars-34-17-as-starters-shine">
      Panthers rapid reactions</Link>.
    </P>

    <H3>Mike Washington Jr., RB, Las Vegas Raiders</H3>
    <P>
      Washington turned nine carries into 56 yards, with a 33-yard burst on Las Vegas&apos; opening
      drive. Ashton Jeanty remains the backfield&apos;s center of gravity, so Washington is still a
      reserve-role bet. The rookie&apos;s case became more relevant when Jeanty left Sunday&apos;s
      practice unable to put weight on his right leg. There was no team-confirmed diagnosis as of
      Monday, which means the responsible move is to elevate Washington on a watchlist without
      drafting as if Jeanty will miss games. <Link to="https://www.raiders.com/news/game-recap-raiders-erase-17-point-deficit-outmuscle-texans-down-the-stretch">
      Raiders recap</Link>; <Link to={NFL_INJURIES}>NFL injury update</Link>.
    </P>

    <H3>Colbie Young, WR, Cincinnati Bengals</H3>
    <P>
      Cincinnati rested its top three receivers, and Young responded with the kind of opportunity
      profile that earns another look: eight targets on 22 routes, three catches, 48 yards and a
      17-yard touchdown. All three receptions came at least 10 yards downfield. Five misses on
      eight targets keep this from becoming a standard-league recommendation, but a fourth-round
      rookie drawing repeated contested looks belongs on deep-league and dynasty radars.
      {' '}<Link to={NFL_SATURDAY}>NFL Saturday report</Link>.
    </P>

    <H3>Woody Marks, RB, Houston Texans</H3>
    <P>
      Marks ran four times for 39 yards, scored from 20 yards out and was praised in Houston&apos;s
      protection review. David Montgomery remains the lead back. Marks&apos; arrow is up because he
      supplied the two things that keep a reserve runner active—explosiveness and pass protection—not
      because four carries erased the depth chart. <Link to="https://www.nfl.com/news/texans-depth-shines-narrow-preseason-loss-raiders">
      NFL Texans-Raiders report</Link>.
    </P>

    <H3>Joe Milton III, QB, Dallas Cowboys</H3>
    <P>
      Milton completed 9 of 13 passes for 179 yards and two touchdowns, then added a short rushing
      score. His movement is within Dallas&apos; QB2 competition, not into ordinary redraft lineups.
      In superflex and deep dynasty formats, though, a strong-armed backup making a 53-yard
      touchdown throw and a 70-yard connection is worth tracking behind Dak Prescott.
      {' '}<Link to="https://www.dallascowboys.com/news/game-recap-milton-leads-cowboys-to-34-13-win">
      Cowboys game recap</Link>.
    </P>

    <H2>Fantasy Stock Losers</H2>

    <H3>Cam Ward, QB, Tennessee Titans</H3>
    <P>
      Ward went 8 of 12 for 69 yards against Seattle&apos;s backups, with no touchdown and no turnover.
      Tennessee&apos;s starting offense produced no touchdown in three drives, and its run game gave
      Ward only 10 yards of support. Across two preseason games, he is 13 of 24 for 126 yards with
      no touchdowns. A new offense and protection issues supply context; they do not supply
      redraft upside. Ward remains a dynasty hold, but his 2026 one-quarterback case is moving the
      wrong way. <Link to={NFL_SUNDAY}>NFL Sunday report</Link>.
    </P>

    <H3>Fernando Mendoza, QB, Las Vegas Raiders</H3>
    <P>
      The No. 1 pick completed 8 of 15 passes for 86 yards and threw an 80-yard pick-six to rookie
      linebacker Wade Woodaz. He was hit five times, pressured on 37.5% of his dropbacks and played
      without Las Vegas&apos; starting offensive line. That context prevents a panic verdict. It also
      makes Mendoza a developmental quarterback who should not be pushed up a fantasy board on
      draft pedigree alone. <Link to={NFL_THURSDAY}>NFL Thursday report</Link>.
    </P>

    <H3>Tyrone Tracy Jr., RB, New York Giants</H3>
    <P>
      Tracy entered behind Devin Singletary, lost a fumble near the goal line and finished with 26
      yards on six carries. Singletary produced 40 yards and a touchdown on eight attempts, while
      Tracy also allowed a pressure in three pass-blocking reps and worked on kickoff coverage.
      Cam Skattebo remains the starter, but this was a damaging night for Tracy&apos;s reserve-role
      security. <Link to={NFL_SATURDAY}>NFL Saturday report</Link>.
    </P>

    <H3>The Saints&apos; backup quarterbacks</H3>
    <P>
      Zach Wilson started 4 of 4, then completed only two of his next eight attempts and threw an
      interception. Spencer Rattler later turned a red-zone throw into Alex Cook&apos;s 100-yard
      pick-six. New Orleans finished with zero points. This competition has little standard-league
      value, but neither quarterback gave dynasty managers a reason to spend a bench spot.
      {' '}<Link to={NFL_SATURDAY}>NFL Saturday report</Link>.
    </P>

    <H2>Rookie Roll Call</H2>
    <P>
      Stribling, Washington and Young already moved the fantasy conversation. These rookies also
      earned space in the Week 2 notebook:
    </P>
    <UL>
      <LI><strong>Joey Aguilar and Trebor Pe&ntilde;a, Jaguars:</strong> Aguilar completed 9 of 10 for 130 yards, including a 29-yard touchdown to Pe&ntilde;a. Developmental, but sharp.</LI>
      <LI><strong>Jack Strand, Falcons:</strong> The undrafted quarterback completed 12 of 17 for 212 yards and a touchdown, then added 22 rushing yards and another score.</LI>
      <LI><strong>Behren Morton, Patriots:</strong> The seventh-rounder went 13 of 17 for 129 yards and delivered a 37-yard winning touchdown with 57 seconds left. He also punted three times.</LI>
      <LI><strong>Camden Brown, Cowboys:</strong> The undrafted receiver&apos;s 70-yard catch set up Milton&apos;s rushing touchdown and extended his roster-case momentum.</LI>
      <LI><strong>Athan Kaliakmanis and Jaden Bradley, Commanders:</strong> Kaliakmanis threw for 162 yards without taking a sack; rookie Bradley supplied a one-handed, 30-yard catch in tight coverage.</LI>
    </UL>
    <P>
      These are roster and dynasty-watch signals, not redraft endorsements. The supporting reports
      come from the <Link to="https://www.jaguars.com/news/game-report-2026-preseason-week-2-panthers-34-jaguars-17">Jaguars</Link>,
      {' '}<Link to="https://www.atlantafalcons.com/news/game-breakdown-what-happened-in-falcons-preseason-game-vs-indianapolis-colts">Falcons</Link>,
      {' '}<Link to="https://www.patriots.com/news/game-notes-patriots-defeat-eagles-in-fourth-quarter-game-winning-drive">Patriots</Link>,
      {' '}<Link to={NFL_SATURDAY}>NFL</Link>, and
      {' '}<Link to="https://www.commanders.com/news/washington-commanders-detroit-lions-preseason-takeaways">Commanders</Link>.
    </P>

    <H2>Defense Won the Weekend</H2>
    <DefensiveImpactGraphic />

    <H3>Wade Woodaz, LB, Houston Texans</H3>
    <P>
      Woodaz jumped Mendoza&apos;s throw and returned it 80 yards for a touchdown. It was the headline
      play for a reserve unit that hit the rookie quarterback five times. For IDP managers, a
      fourth-round rookie turning his safety background into linebacker ball production is worth
      monitoring. <Link to={NFL_THURSDAY}>NFL Thursday report</Link>.
    </P>

    <H3>Anthony Hill Jr., LB, Tennessee Titans</H3>
    <P>
      Hill led Tennessee with seven tackles and added a second-half interception. The second-round
      rookie&apos;s individual night was even more valuable because the Titans&apos; starting defense had
      conceded 16 first-quarter points to Seattle&apos;s second unit. <Link to="https://www.tennesseetitans.com/news/titans-seahawks-preseason-week-2-postgame-notes">
      Titans postgame notes</Link>.
    </P>

    <H3>Wesley Bailey and Alex Cook, Los Angeles Rams</H3>
    <P>
      Bailey filled the pressure column: five tackles, one tackle for loss, one sack, three
      quarterback hits and a forced fumble. Cook supplied the scoreboard swing with a 100-yard
      interception return. The Rams&apos; 34-0 shutout was not one anonymous unit performance; it was
      two defenders ending scoring threats themselves. <Link to="https://www.therams.com/news/5-takeaways-from-rams-34-0-preseason-week-2-win-over-saints-qb-usage-olb-wesley-bailey-and-dbs-making-plays-and-more">
      Rams takeaways</Link>.
    </P>

    <H3>Mike Green, EDGE, Baltimore Ravens</H3>
    <P>
      Green recorded a sack and forced a holding penalty on the next play. Baltimore&apos;s pass rush
      pressured J.J. McCarthy six times across his 11 dropbacks, then added two more sacks after he
      left. That is the kind of individual disruption that can create an IDP role even when the
      final preseason score is disposable. <Link to={NFL_SATURDAY}>NFL Saturday report</Link>;
      {' '}<Link to="https://www.baltimoreravens.com/news/ravens-vikings-preseason-stock-report-defense-tyler-loop-ryan-eckley">
      Ravens stock report</Link>.
    </P>

    <H3>Jaishawn Barham and Quintayvious Hutchins</H3>
    <P>
      Dallas rookie linebacker Barham debuted with five tackles, a tackle for loss and several
      forceful finishes. New England seventh-round linebacker Hutchins closed the Eagles game with
      a 9-yard strip-sack. Both turned limited audition snaps into direct evidence for defensive
      and special-teams roles. <Link to="https://www.dallascowboys.com/news/game-recap-milton-leads-cowboys-to-34-13-win">Cowboys recap</Link>;
      {' '}<Link to="https://www.patriots.com/news/game-notes-patriots-defeat-eagles-in-fourth-quarter-game-winning-drive">Patriots game notes</Link>.
    </P>

    <H2>The Injury Board</H2>
    <P>
      Injury reporting remained fluid Monday. These are the official statuses—not guesses about
      diagnoses or recovery dates.
    </P>
    <UL>
      <LI><strong>Jayden Higgins, WR, Texans:</strong> tore his ACL in the August 18 joint practice and is out for the 2026 season. His absence removes a direct receiving competitor and changes Houston&apos;s depth calculus.</LI>
      <LI><strong>Tyler Biadasz, C, Chargers:</strong> injured his left knee in the joint practice with San Francisco and was later placed on season-ending injured reserve. That is protection context for Justin Herbert, not a reason to invent a precise statistical downgrade. <Link to="https://www.chargers.com/news/tyler-biadasz-injury-update-2026">Chargers update</Link>.</LI>
      <LI><strong>Bud Clark, S, Seahawks:</strong> broke his ankle against Tennessee. Seattle coach Mike Macdonald said the second-round rookie would miss several months.</LI>
      <LI><strong>Ashton Jeanty, RB, Raiders:</strong> left Sunday&apos;s practice unable to put weight on his right leg. No team-confirmed diagnosis or timetable was available Monday.</LI>
      <LI><strong>Isaiah Bond, WR, Browns:</strong> was evaluated for a concussion during the Buffalo game and subsequently cleared the protocol. <Link to="https://www.clevelandbrowns.com/news/isaiah-bond-being-evaluated-for-a-concussion">Browns update</Link>.</LI>
      <LI><strong>Mason Richman, OL, Seahawks:</strong> sustained what Macdonald described as a major, long-term injury. No diagnosis or timetable was announced in the official update.</LI>
    </UL>
    <P>
      There was also positive availability news in San Francisco: Christian McCaffrey returned
      after a planned workload-management absence, Stribling returned from a shoulder-related
      absence, and George Kittle came off the physically unable to perform list.
      {' '}<Link to="https://www.49ers.com/news/day-16-of-2026-training-camp-george-kittle-s-remarkable-return">49ers camp report</Link>.
      Additional status updates are in the <Link to={NFL_INJURIES}>NFL&apos;s August 23 roundup</Link>;
      Higgins&apos; season-ending injury
      was reported separately by <Link to="https://www.nfl.com/news/texans-wr-jayden-higgins-torn-acl-out-2026-season">NFL.com</Link>.
    </P>

    <H2>What Changes on Draft Day</H2>
    <P>
      Stribling has the cleanest repeat receiving signal. Brooks supplied the most useful
      first-team backfield evidence. Washington and Young earned deeper-format attention. Ward,
      Mendoza and Tracy created reasons to demand a discount, not reasons to erase long-term
      talent. That distinction is the whole preseason game: move a player when usage and
      performance point together; move him less when one splash play is doing all the work.
    </P>
    <Quote>
      Week 2 should sharpen the bottom of a draft board, not overturn its top. Treat every arrow
      here as a prompt to recheck role and health before your room opens.
    </Quote>

    <H2>Reporting Notes and Primary Sources</H2>
    <P>
      All scores and statistical claims were checked against official NFL or club reporting current
      through August 24, 2026. Fantasy stock labels are Endzone Empire analysis, not reported ADP
      movement. Preseason personnel and small samples limit every projection.
    </P>
    <UL>
      <LI><Link to={NFL_WEEK_2}>NFL Week 2 schedule and results</Link></LI>
      <LI><Link to={NFL_THURSDAY}>NFL Thursday takeaways</Link></LI>
      <LI><Link to={NFL_FRIDAY}>NFL Friday takeaways</Link></LI>
      <LI><Link to={NFL_SATURDAY}>NFL Saturday takeaways</Link></LI>
      <LI><Link to={NFL_SUNDAY}>NFL Sunday takeaways</Link></LI>
      <LI><Link to={NFL_INJURIES}>NFL August 23 injury and transaction roundup</Link></LI>
    </UL>
  </>
);

export default Body;
