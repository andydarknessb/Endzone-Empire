import React from 'react';
import { Box } from '@mui/material';
import {
  Lead, P, H2, H3, Quote, UL, LI, Link,
  Table, THead, TBody, TR, TH, TD,
} from '../../components/public/kit/Prose';

const NFL_WEEK_3 = 'https://www.nfl.com/schedules/2026/by-week/preseason-week-3';
const NFL_THURSDAY = 'https://www.nfl.com/news/2026-nfl-preseason-week-3-what-we-learned-from-thursday-s-games';
const NFL_FRIDAY = 'https://www.nfl.com/news/2026-nfl-preseason-week-3-what-we-learned-friday-games';
const NFL_SATURDAY = 'https://www.nfl.com/news/2026-nfl-preseason-week-3-what-we-learned-from-saturday-s-games';
const NFL_AUG_29 = 'https://www.nfl.com/news/nfl-news-roundup-latest-league-updates-from-saturday-aug-29';
const NFL_AUG_30 = 'https://www.nfl.com/news/nfl-news-roundup-latest-league-updates-from-sunday-aug-30';
const NFL_JEANTY = 'https://www.nfl.com/news/raiders-rb-ashton-jeanty-apparent-right-leg-injury';
const NFL_PEARSALL = 'https://www.nfl.com/news/niners-wr-ricky-pearsall-knee-surgery-will-miss-2026-season';
const PACKERS_RECAP = 'https://www.packers.com/news/game-recap-5-takeaways-from-packers-preseason-win-over-cardinals-pre-week-3-2026';
const NBC_OSSAI = 'https://www.nbcsports.com/nfl/profootballtalk/rumor-mill/news/jets-lb-joseph-ossai-week-to-week-with-foot-injury';
const NBC_TRACY = 'https://www.nbcsports.com/fantasy/football/player-news/2026-08-28/tyrone-tracy-concussion-clears-protocol';

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
      aria-labelledby="week3-hero-title week3-hero-description"
    >
      <title id="week3-hero-title">NFL Preseason Week 3 roster-bubble stock watch</title>
      <desc id="week3-hero-description">
        An original editorial illustration of a receiver breaking free down a sideline while a
        roster board behind him separates names that survive from names that fall away.
      </desc>
      <defs>
        <linearGradient id="week3-field" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#0a1c26" />
          <stop offset="0.55" stopColor="#16455a" />
          <stop offset="1" stopColor="#0c2a37" />
        </linearGradient>
        <linearGradient id="week3-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#241a3d" />
          <stop offset="1" stopColor="#0a1c26" />
        </linearGradient>
      </defs>
      <rect width="800" height="300" fill="url(#week3-sky)" />
      <path d="M0 118 Q200 82 400 118 T800 118 V300 H0Z" fill="url(#week3-field)" />
      {[60, 160, 260, 360, 460, 560, 660, 760].map((x) => (
        <line key={x} x1={x} y1="124" x2={x - 40} y2="300" stroke="rgba(255,255,255,0.12)" />
      ))}
      <path d="M92 244 C210 208 318 190 452 172" fill="none" stroke="#61d6ff" strokeWidth="7" strokeLinecap="round" strokeDasharray="20 12" />
      <path d="M436 166 L456 171 L444 187" fill="none" stroke="#61d6ff" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="292" cy="150" r="27" fill="#c8925f" />
      <path d="M262 138 Q292 108 322 138 L317 151 Q292 139 267 151Z" fill="#f3f5f7" />
      <path d="M275 168 Q292 157 309 168 L338 240 H246Z" fill="#eef3f6" />
      <path d="M246 186 L212 224" stroke="#c8925f" strokeWidth="17" strokeLinecap="round" />
      <path d="M338 186 L376 174" stroke="#c8925f" strokeWidth="17" strokeLinecap="round" />
      <ellipse cx="392" cy="170" rx="26" ry="16" fill="#7b4126" transform="rotate(-24 392 170)" />
      <path d="M377 168 L407 170" stroke="#f5e5cf" strokeWidth="3" />
      <rect x="556" y="146" width="196" height="128" rx="12" fill="rgba(3,12,20,0.72)" stroke="rgba(255,255,255,0.16)" />
      {[0, 1, 2, 3].map((row) => (
        <React.Fragment key={row}>
          <rect x="574" y={168 + row * 26} width={row === 3 ? 74 : 118} height="10" rx="5" fill={row === 3 ? '#ff7777' : '#5fe2a0'} />
          <rect x={row === 3 ? 656 : 700} y={168 + row * 26} width={row === 3 ? 78 : 34} height="10" rx="5" fill="rgba(255,255,255,0.18)" />
        </React.Fragment>
      ))}
      <text x="654" y="164" textAnchor="middle" fill="#c9d8e6" fontFamily="system-ui, sans-serif" fontWeight="700" fontSize="12" letterSpacing="2">53-MAN BOARD</text>
      <rect x="96" y="24" width="608" height="76" rx="14" fill="rgba(3,12,20,0.78)" />
      <text x="400" y="57" textAnchor="middle" fill="#ffffff" fontFamily="system-ui, sans-serif" fontWeight="850" fontSize="30" letterSpacing="1">PRESEASON WEEK 3</text>
      <text x="400" y="84" textAnchor="middle" fill="#c9d8e6" fontFamily="system-ui, sans-serif" fontWeight="650" fontSize="15" letterSpacing="3">FINALE · CUTDOWN · ROLES · INJURIES</text>
    </Box>
  );
}

function StockPulseGraphic() {
  const risers = [
    'THOMAS',
    'WASHINGTON',
    'BELL',
    'STURDIVANT',
  ];
  const fallers = [
    'MENDOZA',
    'LEMON',
    'LEVIS',
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
      <text x="36" y="42" fill="var(--text-primary)" fontFamily="system-ui, sans-serif" fontWeight="800" fontSize="18">WEEK 3 SIGNAL BOARD</text>
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
      <text x="36" y="286" fill="var(--text-muted)" fontFamily="system-ui, sans-serif" fontSize="12">Finale-week evidence is discounted for reserve personnel and roster churn.</text>
    </Box>
  );
}

function CutdownGraphic() {
  return (
    <Box
      component="svg"
      viewBox="0 0 760 220"
      xmlns="http://www.w3.org/2000/svg"
      sx={{ width: '100%', display: 'block', my: 3, color: 'text.primary' }}
      role="img"
      aria-label="Original illustration of a roster board narrowing from a wide camp list down to a 53-man cut line, with a few names moving up into open roles"
    >
      <rect x="1" y="1" width="758" height="218" rx="16" fill="var(--surface-sunken)" stroke="var(--border-subtle)" />
      <path d="M64 32 H696 M64 188 H696" stroke="var(--border-strong)" strokeDasharray="8 10" />
      <path d="M92 44 L360 104 L92 176Z" fill="var(--surface-raised)" />
      <path d="M372 96 H612" stroke="var(--danger)" strokeWidth="6" strokeLinecap="round" strokeDasharray="18 12" />
      <text x="492" y="84" textAnchor="middle" fill="var(--danger)" fontFamily="system-ui, sans-serif" fontWeight="750" fontSize="13">CUT LINE</text>
      <path d="M372 128 C452 128 500 150 566 162" fill="none" stroke="var(--pos-idp)" strokeWidth="10" strokeLinecap="round" />
      <path d="M372 120 C452 120 512 92 588 58" fill="none" stroke="var(--success)" strokeWidth="10" strokeLinecap="round" />
      <path d="M572 56 L592 54 L586 74" fill="none" stroke="var(--success)" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="360" cy="110" r="14" fill="var(--accent)" />
      <text x="380" y="208" textAnchor="middle" fill="var(--text-muted)" fontFamily="system-ui, sans-serif" fontSize="13">THE FINALE DECIDES ROSTERS. THE ROSTER DECIDES FANTASY ROLES.</text>
    </Box>
  );
}

const W = ({ children }) => <strong>{children}</strong>;

const Body = () => (
  <>
    <HeroBanner />

    <Lead>
      Preseason Week 3 is the week most managers read wrong. Starters sat, backups played into the
      fourth quarter, and by Sunday rosters had cut to 53, which means a good share of the
      weekend&apos;s production came from players auditioning for a job rather than holding one. The
      useful signal is not who scored, it is who won a job, who inherited one, and who lost
      availability heading into Week 1. Here is the full, source-backed read from all 16 finales.
    </Lead>

    <H2>The Scoreboard</H2>
    <Table aria-labelledby="the-scoreboard">
      <THead>
        <TR><TH scope="col">Away</TH><TH scope="col">Score</TH><TH scope="col">Home</TH><TH scope="col">Score</TH></TR>
      </THead>
      <TBody>
        <TR><TD>Steelers</TD><TD>27</TD><TD><W>Bills</W></TD><TD><W>28</W></TD></TR>
        <TR><TD>Patriots</TD><TD>13</TD><TD><W>Browns</W></TD><TD><W>37</W></TD></TR>
        <TR><TD><W>49ers</W></TD><TD><W>18</W></TD><TD>Raiders</TD><TD>12</TD></TR>
        <TR><TD><W>Rams</W></TD><TD><W>20</W></TD><TD>Chargers</TD><TD>18</TD></TR>
        <TR><TD>Commanders</TD><TD>3</TD><TD><W>Ravens</W></TD><TD><W>41</W></TD></TR>
        <TR><TD>Texans</TD><TD>13</TD><TD><W>Panthers</W></TD><TD><W>16</W></TD></TR>
        <TR><TD><W>Falcons</W></TD><TD><W>17</W></TD><TD>Dolphins</TD><TD>12</TD></TR>
        <TR><TD>Buccaneers</TD><TD>0</TD><TD><W>Jaguars</W></TD><TD><W>19</W></TD></TR>
        <TR><TD><W>Giants</W></TD><TD><W>23</W></TD><TD>Jets</TD><TD>6</TD></TR>
        <TR><TD><W>Saints</W></TD><TD><W>27</W></TD><TD>Cowboys</TD><TD>24</TD></TR>
        <TR><TD>Seahawks</TD><TD>9</TD><TD>Chiefs</TD><TD>9</TD></TR>
        <TR><TD><W>Bengals</W></TD><TD><W>30</W></TD><TD>Eagles</TD><TD>13</TD></TR>
        <TR><TD>Cardinals</TD><TD>38</TD><TD><W>Packers</W></TD><TD><W>42</W></TD></TR>
        <TR><TD>Vikings</TD><TD>6</TD><TD><W>Broncos</W></TD><TD><W>34</W></TD></TR>
        <TR><TD><W>Lions</W></TD><TD><W>25</W></TD><TD>Colts</TD><TD>16</TD></TR>
        <TR><TD><W>Bears</W></TD><TD><W>24</W></TD><TD>Titans</TD><TD>15</TD></TR>
      </TBody>
    </Table>
    <P>
      Two lines in that table are not typos. Seattle and Kansas City finished 9-9, because a
      preseason game is allowed to end tied. And Green Bay really did beat Arizona 42-38, rallying
      from 11 points down in the final four minutes on a touchdown thrown by its third quarterback
      with 20 seconds left. Every score above is the
      {' '}<Link to={NFL_WEEK_3}>NFL&apos;s official Week 3 result</Link>;
      {' '}<Link to={PACKERS_RECAP}>Packers recap</Link>.
    </P>

    <H2>The Draft-Room Read</H2>
    <Table aria-labelledby="the-draft-room-read">
      <THead>
        <TR><TH scope="col">Player</TH><TH scope="col">Signal</TH><TH scope="col">Draft response</TH></TR>
      </THead>
      <TBody>
        <TR><TD>Zavion Thomas</TD><TD>Rising</TD><TD>Deep-league and return-game watch</TD></TR>
        <TR><TD>Mike Washington Jr.</TD><TD>Rising</TD><TD>Contingency stash, not a starter</TD></TR>
        <TR><TD>Skyler Bell</TD><TD>Rising</TD><TD>Deep-league watch, made the 53</TD></TR>
        <TR><TD>J. Michael Sturdivant</TD><TD>Rising</TD><TD>Dynasty and practice-squad watch</TD></TR>
        <TR><TD>Fernando Mendoza</TD><TD>Falling</TD><TD>Developmental patience</TD></TR>
        <TR><TD>Makai Lemon</TD><TD>Falling</TD><TD>Buy the discount, role unchanged</TD></TR>
        <TR><TD>Will Levis</TD><TD>Falling</TD><TD>No redraft case</TD></TR>
      </TBody>
    </Table>
    <StockPulseGraphic />
    <P>
      Those are directional signals, not a ranked scale, and finale-week evidence is discounted
      here for reserve personnel and roster churn before it earns a place on the list.
    </P>

    <H2>Fantasy Stock Risers</H2>

    <H3>Zavion Thomas, WR, Chicago Bears</H3>
    <P>
      Thomas caught a 97-yard touchdown from Tyson Bagent on the offense&apos;s first play from
      scrimmage and finished with five catches for 140 yards in his first NFL game action. Next Gen
      Stats put the throw&apos;s air distance at 41.3 yards and his top speed at 21.99 mph. He added
      return work on top of it. The third-round rookie sits behind an established receiver room, so
      this is a deep-league and return-value bet rather than a target-share claim. It is still a
      first impression worth writing down.
      {' '}<Link to={NFL_SATURDAY}>NFL Saturday report</Link>;
      {' '}<Link to="https://www.chicagobears.com/video/can-t-miss-highlight-zavion-thomas-speeds-for-97-yard-td-on-first-play-from-scrimmage">Bears highlight</Link>.
    </P>

    <H3>Mike Washington Jr., RB, Las Vegas Raiders</H3>
    <P>
      Washington ran eight times for 49 yards against San Francisco and closed the preseason with
      23 carries for 168 yards, a 7.3-yard average built on long runs of 53 and 33 yards in the
      first two weeks. His value is entirely contingent. Ashton Jeanty is believed to have sprained
      his right ankle in practice, an injury NFL Network and ESPN reporting describes as not
      long-term, with no team-confirmed return timetable. That combination makes Washington a
      late-round contingency stash, and nothing more than that until the Raiders say otherwise.
      {' '}<Link to={NFL_THURSDAY}>NFL Thursday report</Link>;
      {' '}<Link to={NFL_JEANTY}>NFL Jeanty report</Link>.
    </P>

    <H3>Skyler Bell, WR, Buffalo Bills</H3>
    <P>
      The fourth-round rookie missed the first two preseason weeks with a groin injury, then led
      Buffalo with seven catches on 10 targets for 49 yards and turned his only carry, a jet sweep,
      into a 28-yard touchdown. Ten targets is the number to hold onto; seven yards a catch is the
      number to be honest about. Buffalo won 28-27 on a late two-point conversion, and Bell made
      the initial 53, which is the part that actually matters for a Week 3 standout.
      {' '}<Link to={NFL_THURSDAY}>NFL Thursday report</Link>;
      {' '}<Link to="https://www.buffalobills.com/news/top-3-things-we-learned-bills-vs-steelers-preseason-week-3-2026">Bills takeaways</Link>.
    </P>

    <H3>J. Michael Sturdivant, WR, Green Bay Packers</H3>
    <P>
      In the 42-38 finale, Sturdivant caught six passes for 112 yards including a 29-yard
      touchdown, finishing as Green Bay&apos;s preseason receiving leader with 142 yards on nine
      catches. Teammate Will Sheppard caught three passes for 26 yards and returned a punt 81 yards
      for a score. Cutdown day split them: Sturdivant, undrafted, made Green Bay&apos;s initial 53,
      while Sheppard was released and re-signed to the practice squad. That is the honest ceiling
      on both. Note them, do not draft them.
      {' '}<Link to={NFL_FRIDAY}>NFL Friday report</Link>;
      {' '}<Link to={PACKERS_RECAP}>Packers recap</Link>;
      {' '}<Link to="https://www.packers.com/news/packers-keep-six-receivers-seven-defensive-linemen-here-s-the-initial-2026-roster">Packers initial roster</Link>.
    </P>

    <H3>Ty Simpson, QB, Los Angeles Rams</H3>
    <P>
      The No. 13 overall pick completed 18 of 23 for 119 yards with a touchdown and no
      interceptions, closing the preseason 47 of 60 for 382 yards with three touchdowns and zero
      picks. Sean McVay had still not settled the QB2 job between Simpson and Stetson Bennett. The
      efficiency is real and the yards per attempt is modest, which is the honest summary of a
      rookie running a controlled script. Superflex and dynasty only.
      {' '}<Link to={NFL_THURSDAY}>NFL Thursday report</Link>;
      {' '}<Link to="https://www.therams.com/news/quarterback-ty-simpson-decisive-composed-and-accurate-in-rams-preseason-finale-win-against-chargers">Rams recap</Link>.
    </P>

    <H2>Fantasy Stock Losers</H2>

    <H3>Fernando Mendoza, QB, Las Vegas Raiders</H3>
    <P>
      The No. 1 overall pick went 7 of 14 for 57 yards with an interception, took two sacks and
      posted a 31.0 passer rating against San Francisco. That follows a Week 2 outing that included
      an 80-yard pick-six. Kirk Cousins went 8 of 11 for 51 yards ahead of him in the same game,
      which is the most important sentence here: Las Vegas has a veteran to lean on, so there is no
      urgency to force the rookie. Mendoza is a developmental quarterback whose draft slot should
      not buy him a fantasy roster spot in one-quarterback leagues.
      {' '}<Link to={NFL_THURSDAY}>NFL Thursday report</Link>.
    </P>

    <H3>Makai Lemon, WR, Philadelphia Eagles</H3>
    <P>
      Philadelphia&apos;s first-round rookie finally debuted after a hamstring injury cost him most of
      camp, and it went badly: three catches on five targets for three yards, a botched punt-
      fielding decision he had to recover himself, and a drop that turned directly into an
      interception, in a 30-13 loss. Read the cause, not the box score. Philadelphia has not said
      how heavily it will use him, and DeVonta Smith and Dontayvion Wicks are the established
      pieces around him, so the honest read is that a receiver who missed most of camp looked like
      a receiver who missed most of camp. If your room drafted the night after, Lemon is the name
      most likely to be underpriced against his draft capital.
      {' '}<Link to={NFL_FRIDAY}>NFL Friday report</Link>;
      {' '}<Link to="https://www.inquirer.com/eagles/first-round-wide-receiver-makai-lemon-preseason-debut-20260829.html">Philadelphia Inquirer</Link>.
    </P>

    <H3>Will Levis, QB, Tennessee Titans</H3>
    <P>
      With Cam Ward and Mitchell Trubisky held out, Levis had a full half to make a case and did
      not: 14 of 22 for 143 yards, 1 of 6 on third down, plus a fumbled handoff exchange with a
      receiver. Tennessee lost 24-15. A quarterback given the whole runway in a starters-rested
      game needs to separate, and the third-down line says he did not.
      {' '}<Link to={NFL_SATURDAY}>NFL Saturday report</Link>.
    </P>

    <H3>Tua Tagovailoa, QB, Atlanta Falcons</H3>
    <P>
      Tagovailoa returned to Miami and completed 7 of 8 for 95 yards, a line that looks better than
      it played: no completion traveled more than 10 yards in the air, most of the yardage came
      after the catch, and he lost a fumble on a snap exchange. Atlanta had not named a Week 1
      starter, and Michael Penix Jr. sat the finale after only three full-team practices, so this
      was Tagovailoa&apos;s uncontested chance to settle an open competition and he did not.
      The fantasy consolation went to Kyle Pitts, who caught
      all three of his targets for 59 yards including a 37-yard tight end screen.
      {' '}<Link to={NFL_FRIDAY}>NFL Friday report</Link>;
      {' '}<Link to="https://www.atlantafalcons.com/news/game-breakdown-what-happened-falcons-dolphins-preseason-final-score-takeaways">Falcons breakdown</Link>.
    </P>

    <H3>The Buccaneers&apos; passing game</H3>
    <P>
      Tampa Bay was shut out 19-0. Jalon Daniels completed 8 of 15 for 57 yards across seven drives
      and Jake Browning went 2 of 4 for 2 yards. The Buccaneers converted 2 of 12 third downs and
      allowed five sacks. Tampa Bay named Daniels its backup behind Baker Mayfield anyway, on the
      strength of a full August rather than one wet Friday, which is a useful reminder that clubs
      weight the body of work more heavily than any single finale.
      {' '}<Link to={NFL_FRIDAY}>NFL Friday report</Link>;
      {' '}<Link to="https://www.nfl.com/news/undrafted-rookie-jalon-daniels-earns-bucs-qb2-gig-behind-baker-mayfield">NFL report on the Bucs&apos; QB2 decision</Link>.
    </P>

    <H2>The Audition Tape</H2>
    <P>
      Week 3 produces a category the first two weeks do not: excellent games by players who were
      not going to keep the job anyway. Two of these were waived within 48 hours of the performance
      that made them worth writing about, which is the whole argument for reading the finale
      through the roster rather than the box score. Handle all of them as roster news, not fantasy
      adds.
    </P>
    <UL>
      <LI><strong>Dillon Gabriel, QB, Browns:</strong> 12 of 15 for 186 yards with three first-half touchdowns and a 157.9 rating, three days after Cleveland named Deshaun Watson its starter. He was subsequently placed on injured reserve with a designation to return because of a back injury, which closes the near-term fantasy question entirely. <Link to={NFL_THURSDAY}>NFL Thursday report</Link>.</LI>
      <LI><strong>Cody Schrader, RB, Broncos:</strong> the loudest cautionary tale of the week. Schrader handled 19 touches for 132 yards, six catches for 90 yards against 13 carries for 42, and caught a fourth-down touchdown from Sam Ehlinger. Denver waived him on August 30 and re-signed him to the practice squad the next day. A 132-yard night did not beat out the four backs already on the roster. <Link to={NFL_FRIDAY}>NFL Friday report</Link>; <Link to="https://www.denverbroncos.com/video/sam-ehlinger-scrambles-tosses-fourth-down-td-pass-to-cody-schrader">Broncos video</Link>.</LI>
      <LI><strong>Sam Ehlinger, QB, Broncos:</strong> 15 of 20 for 233 yards with three touchdowns and an interception, including an 88-yard score to rookie tight end Justin Joly. Joly was waived on August 30 and claimed by Miami. <Link to={NFL_FRIDAY}>NFL Friday report</Link>.</LI>
      <LI><strong>Kyle McCord, QB, Packers:</strong> Green Bay&apos;s third quarterback went 22 of 35 for 226 yards and four touchdowns, and brought the Packers back from 11 points down in the final four minutes, the winner going to Kisean Johnson with 20 seconds left. <Link to={PACKERS_RECAP}>Packers recap</Link>.</LI>
      <LI><strong>Tyson Bagent, QB, Bears:</strong> 16 of 17 for 208 yards and two touchdowns in a half, with a 156.9 rating. <Link to={NFL_SATURDAY}>NFL Saturday report</Link>.</LI>
      <LI><strong>Gardner Minshew, QB, Cardinals:</strong> 7 of 9 for 126 yards and a touchdown, a 155.8 rating, in a losing shootout. <Link to={NFL_FRIDAY}>NFL Friday report</Link>.</LI>
    </UL>

    <H2>Defense and IDP Notes</H2>

    <H3>Bryan Thomas Jr., DE, Jacksonville Jaguars</H3>
    <P>
      The undrafted rookie from South Carolina recorded 2.5 sacks in Jacksonville&apos;s 19-0 shutout,
      with the league&apos;s recap crediting four tackles and four pressures on top of it. He was the
      only undrafted free agent to make the Jaguars&apos; initial 53. For deep IDP leagues, an edge
      rusher who forced his way onto a roster with production rather than draft capital is the
      right kind of name to file. <Link to={NFL_FRIDAY}>NFL Friday report</Link>;
      {' '}<Link to="https://www.jaguars.com/team/players-roster/bryan-thomas-jr/">Jaguars roster</Link>.
    </P>

    <H3>Dani Dennis-Sutton, EDGE, Green Bay Packers</H3>
    <P>
      The fourth-round rookie produced four pressures and a sack in his debut. Green Bay&apos;s edge
      picture gained urgency two days later when Micah Parsons was moved to the reserve PUP list,
      which sidelines him for at least the first four games. Dennis-Sutton is not the answer to
      that, but he is now auditioning into real snaps rather than into a depth chart with no room.
      {' '}<Link to={NFL_FRIDAY}>NFL Friday report</Link>; <Link to={NFL_AUG_30}>NFL August 30
      roundup</Link>.
    </P>

    <H3>Ennis Rakestraw Jr., CB, Detroit Lions</H3>
    <P>
      Rakestraw played the entire first half, allowed three receptions for 44 yards on five targets
      and made a diving interception. His full preseason: 11 receptions allowed on 15 targets for
      151 yards, with two passes defensed and one interception. That is a usable coverage baseline
      for IDP managers who track targets rather than tackles. <Link to={NFL_SATURDAY}>NFL Saturday
      report</Link>.
    </P>

    <H3>Sauce Gardner and Keenan Allen, Indianapolis Colts</H3>
    <P>
      Both played four snaps. Gardner intercepted a pass before exiting; Allen caught a 24-yard
      throw from Anthony Richardson on the opening drive. Cameos like these are availability
      confirmations, which in the final week of August is worth more than a long stat line from
      a player who is still fighting for a roster spot. <Link to={NFL_SATURDAY}>NFL Saturday
      report</Link>.
    </P>

    <H2>The Injury Board</H2>
    <P>
      Reported statuses, attributed to the club or to the reporter who carried them. Where a
      diagnosis or timetable was not announced, that is said plainly rather than guessed at.
    </P>
    <UL>
      <LI><strong>Ashton Jeanty, RB, Raiders:</strong> believed to have sprained his right ankle after landing awkwardly on a dive in practice. NFL Network and ESPN reporting indicates it is not considered a long-term injury; the return timeline was not established. <Link to={NFL_JEANTY}>NFL report</Link>.</LI>
      <LI><strong>Micah Parsons, LB, Packers:</strong> moved to the reserve PUP list, so he misses at least the first four games. <Link to={NFL_AUG_30}>NFL August 30 roundup</Link>.</LI>
      <LI><strong>Zach Charbonnet, RB, Seahawks:</strong> placed on the PUP list, also out at least four games. No source has named who absorbs the work, which is the question to answer before your draft. <Link to={NFL_AUG_30}>NFL August 30 roundup</Link>.</LI>
      <LI><strong>Ricky Pearsall, WR, 49ers:</strong> out for 2026 after surgery on the PCL in his right knee. This one predates Week 3 and is listed because it is still shaping San Francisco&apos;s receiver room. <Link to={NFL_PEARSALL}>NFL report</Link>.</LI>
      <LI><strong>George Kittle, TE, 49ers:</strong> expected to practice in Week 1 preparation with a chance to play in the opener. <Link to={NFL_AUG_30}>NFL August 30 roundup</Link>.</LI>
      <LI><strong>Joseph Ossai, EDGE, Jets:</strong> left the Giants game with a left foot injury after 11 snaps. Head coach Aaron Glenn called him week to week. <Link to={NBC_OSSAI}>NBC Sports</Link>.</LI>
      <LI><strong>Tyrone Tracy Jr., RB, Giants:</strong> left the Jets game after an eight-yard run, having gained 37 yards and a touchdown on four carries. He was evaluated for a concussion and cleared the protocol; the nature of the injury was not otherwise specified. <Link to={NBC_TRACY}>NBC Sports</Link>.</LI>
      <LI><strong>Marist Liufau, LB, Cowboys:</strong> the Cowboys said on August 29 that he was scheduled for surgery on a fractured left forearm. <Link to={NFL_AUG_29}>NFL August 29 roundup</Link>.</LI>
      <LI><strong>Mohamed Kamara, LB, Buccaneers:</strong> knee sprain, with an MRI due to determine severity as of August 29. Teammate Keionte Scott sprained an ankle and was expected to be fine. <Link to={NFL_AUG_29}>NFL August 29 roundup</Link>.</LI>
      <LI><strong>Coleman Owen, WR, Colts:</strong> suffered a concussion during Saturday&apos;s game. <Link to={NFL_AUG_29}>NFL August 29 roundup</Link>.</LI>
    </UL>

    <H2>Cutdown Day Moved More Than the Games Did</H2>
    <CutdownGraphic />
    <P>
      Rosters trimmed to 53 on August 30, and the transaction wire produced several items with
      fantasy consequences that no box score captured.
    </P>
    <UL>
      <LI><strong>Josh Jacobs, RB, Packers:</strong> placed on the Commissioner&apos;s Exempt List. There is no announced end date. That is the status, and it is enough to make every Green Bay backfield share a live question. <Link to={NFL_AUG_30}>NFL August 30 roundup</Link>.</LI>
      <LI><strong>Broderick Jones, OT:</strong> traded from the Steelers to the Cowboys along with a fourth-round pick for third- and sixth-round selections. Protection context for Dallas, and a subtraction from Pittsburgh&apos;s line.</LI>
      <LI><strong>Quinn Ewers, QB:</strong> traded from the Dolphins to the Jaguars for a 2028 sixth-round pick.</LI>
      <LI><strong>Corey Kiner, RB:</strong> traded from the Cardinals to the Patriots for a 2028 seventh-round pick.</LI>
      <LI><strong>Bobby Okereke, LB:</strong> signed a one-year deal with the Panthers. He started 17 games for the Giants last season with 143 tackles, one sack and two interceptions, which makes him an immediate IDP name in a new defense.</LI>
      <LI><strong>Jonnu Smith, TE:</strong> signed with the Packers.</LI>
      <LI><strong>Mecole Hardman, WR,</strong> released by the Bills; <strong>Bailey Zappe, QB,</strong> released by the Jets.</LI>
    </UL>
    <P>
      Trades and signings above are from the <Link to={NFL_AUG_29}>NFL&apos;s August 29 roundup</Link>
      {' '}unless otherwise linked.
    </P>

    <H2>What Changes on Draft Day</H2>
    <P>
      Almost nothing at the top, which is the correct outcome for a week the starters skipped. The
      real movement is in the last four rounds and on the waiver wire you will inherit in Week 1.
      Washington is the contingency to own if you drafted Jeanty. Charbonnet&apos;s PUP designation and
      Parsons&apos; are four-game facts, not rumors, and should be priced as such. Lemon is underpriced
      against his draft capital after one rusty debut. Thomas and Bell are deep-format names worth
      a bench slot only in the formats that reward them, and the reason to trust them over the
      rest of the weekend&apos;s standouts is simple: they are on the 53. Cody Schrader put up 132
      yards and was waived two days later. That is the lesson of Week 3 in one line. Jacobs&apos;
      roster status remains the largest unresolved variable on the board.
    </P>
    <Quote>
      Week 3 is the week to reread your own board, not to rewrite it. The finale mostly tells you
      who will be available in September, and availability is the cheapest edge in fantasy football.
    </Quote>

    <H2>Reporting Notes and Primary Sources</H2>
    <P>
      All scores and statistical claims were checked against official NFL or club reporting current
      through September 1, 2026, with two exceptions noted inline: the Joseph Ossai and Tyrone
      Tracy Jr. statuses are sourced to NBC Sports, which carried the coaches&apos; own words before
      either club posted an update. Fantasy stock labels are Endzone Empire analysis, not reported
      ADP movement. Where sources disagreed on a figure, this article omits the contested number
      rather than picking one: Zavion Thomas&apos; return yardage is reported two ways, so only his
      receiving line appears above. Every performance here came in a starters-rested week against
      mixed or reserve personnel, and several came from players still competing for a roster spot,
      so weight all of it accordingly.
    </P>
    <UL>
      <LI><Link to={NFL_WEEK_3}>NFL Week 3 schedule and results</Link></LI>
      <LI><Link to={NFL_THURSDAY}>NFL Thursday takeaways</Link></LI>
      <LI><Link to={NFL_FRIDAY}>NFL Friday takeaways</Link></LI>
      <LI><Link to={NFL_SATURDAY}>NFL Saturday takeaways</Link></LI>
      <LI><Link to={NFL_AUG_29}>NFL August 29 news and injury roundup</Link></LI>
      <LI><Link to={NFL_AUG_30}>NFL August 30 news and injury roundup</Link></LI>
      <LI><Link to={NFL_JEANTY}>NFL Ashton Jeanty report</Link></LI>
      <LI><Link to={NFL_PEARSALL}>NFL Ricky Pearsall report</Link></LI>
      <LI><Link to={PACKERS_RECAP}>Packers takeaways from the Cardinals finale</Link></LI>
      <LI><Link to={NBC_OSSAI}>NBC Sports on Joseph Ossai</Link></LI>
      <LI><Link to={NBC_TRACY}>NBC Sports on Tyrone Tracy Jr.</Link></LI>
    </UL>
  </>
);

export default Body;
