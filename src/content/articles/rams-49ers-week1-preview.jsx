import React from 'react';
import { Box } from '@mui/material';
import {
  Lead, P, H2, H3, Quote, UL, LI,
  Table, THead, TBody, TR, TH, TD,
} from '../../components/public/kit/Prose';

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
      aria-labelledby="ramsf-hero-title ramsf-hero-desc"
    >
      <title id="ramsf-hero-title">Rams vs 49ers Thursday Night Preview from Melbourne</title>
      <desc id="ramsf-hero-desc">
        An original editorial illustration of the Rams and 49ers helmets flanking a football
        above the Melbourne Cricket Ground oval, under a Thursday night sky with the
        International Series banner.
      </desc>
      <defs>
        <linearGradient id="ramsf-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#0a0e1a" />
          <stop offset="1" stopColor="#1c2640" />
        </linearGradient>
        <linearGradient id="ramsf-field" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#1a4a2a" />
          <stop offset="0.5" stopColor="#2d7a44" />
          <stop offset="1" stopColor="#1a4a2a" />
        </linearGradient>
      </defs>
      <rect width="800" height="300" fill="url(#ramsf-sky)" />
      {[{x:50,y:30},{x:150,y:55},{x:280,y:20},{x:520,y:35},{x:650,y:50},{x:730,y:25},{x:380,y:15},{x:90,y:70}].map((s, i) => (
        <circle key={i} cx={s.x} cy={s.y} r="1.5" fill="#ffffff" opacity="0.5" />
      ))}
      <ellipse cx="400" cy="220" rx="320" ry="80" fill="url(#ramsf-field)" stroke="rgba(255,255,255,0.15)" strokeWidth="2" />
      <rect x="385" y="200" width="30" height="40" rx="2" fill="rgba(210,180,120,0.3)" />
      <ellipse cx="400" cy="220" rx="160" ry="40" fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="1" strokeDasharray="8 4" />
      {[120, 280, 520, 680].map((x) => (
        <React.Fragment key={x}>
          <rect x={x - 3} y="80" width="6" height="80" fill="rgba(255,255,255,0.12)" />
          <circle cx={x} cy="78" r="7" fill="#ffd866" opacity="0.6" />
          <ellipse cx={x} cy="100" rx="30" ry="60" fill="#ffd866" opacity="0.03" />
        </React.Fragment>
      ))}
      <circle cx="240" cy="140" r="44" fill="#003594" stroke="#ffd100" strokeWidth="5" />
      <text x="240" y="148" textAnchor="middle" fill="#ffd100" fontFamily="system-ui, sans-serif" fontWeight="900" fontSize="26">LAR</text>
      <circle cx="560" cy="140" r="44" fill="#aa0000" stroke="#b3995d" strokeWidth="5" />
      <text x="560" y="148" textAnchor="middle" fill="#b3995d" fontFamily="system-ui, sans-serif" fontWeight="900" fontSize="26">SF</text>
      <ellipse cx="400" cy="136" rx="30" ry="18" fill="#7b4126" />
      <path d="M383 132 L417 132" stroke="#f5e5cf" strokeWidth="2.5" />
      <text x="400" y="112" textAnchor="middle" fill="rgba(255,255,255,0.4)" fontFamily="system-ui, sans-serif" fontWeight="800" fontSize="16">VS</text>
      <text x="400" y="175" textAnchor="middle" fill="#ffd866" fontFamily="system-ui, sans-serif" fontWeight="700" fontSize="10" opacity="0.7" letterSpacing="3">MELBOURNE &middot; INTERNATIONAL SERIES</text>
      <rect x="80" y="240" width="640" height="50" rx="14" fill="rgba(3,12,20,0.85)" />
      <text x="400" y="262" textAnchor="middle" fill="#ffffff" fontFamily="system-ui, sans-serif" fontWeight="850" fontSize="20" letterSpacing="1">RAMS VS 49ERS</text>
      <text x="400" y="280" textAnchor="middle" fill="#c9d8e6" fontFamily="system-ui, sans-serif" fontWeight="650" fontSize="11" letterSpacing="3">THURSDAY NIGHT &middot; WEEK 1 &middot; START/SIT &middot; IDP</text>
    </Box>
  );
}

const S = ({ children }) => <strong>{children}</strong>;

const Body = () => (
  <>
    <HeroBanner />

    <Lead>
      The NFL&apos;s first international game of 2026 sends the Rams and 49ers to the Melbourne
      Cricket Ground for Thursday Night Football on Netflix. Los Angeles is a 3.5-point road
      favorite behind an offense that returned 10 of 11 starters and a defense rebuilt around
      Myles Garrett, Aaron Donald, and Trent McDuffie. San Francisco is thinner than it has been
      in years: Ricky Pearsall is done for the season, Christian Kirk starts on IR, and Brandon
      Aiyuk left in free agency. This is a 48.5-point total with clear fantasy edges on both sides
      of the ball. Here is the full start/sit breakdown, the injury board, and the IDP streamers
      for the Melbourne opener.
    </Lead>

    <H2>The Matchup at a Glance</H2>
    <Table aria-labelledby="the-matchup-at-a-glance">
      <THead>
        <TR><TH scope="col">Category</TH><TH scope="col">Rams</TH><TH scope="col">49ers</TH></TR>
      </THead>
      <TBody>
        <TR><TD>Implied Total</TD><TD>~26</TD><TD>~22.5</TD></TR>
        <TR><TD>Spread</TD><TD>&minus;3.5</TD><TD>+3.5</TD></TR>
        <TR><TD>Key Addition</TD><TD>Myles Garrett (23 sacks in 2025)</TD><TD>-</TD></TR>
        <TR><TD>Key Absence</TD><TD>-</TD><TD>Pearsall (PCL, season), Kirk (IR, calf)</TD></TR>
      </TBody>
    </Table>
    <P>
      The Rams treated the Melbourne trip as a drive-by: fly in Tuesday, play Thursday, fly home
      Friday. That compressed schedule favors continuity, and LA has it in abundance. Matthew
      Stafford is coming off an MVP-caliber season with a career-high 7.7 percent touchdown rate,
      and his offense barely changed around him. San Francisco&apos;s receiving corps, meanwhile,
      lost three of its top targets from 2025 between Pearsall&apos;s torn PCL, Kirk&apos;s IR
      stint, and Aiyuk&apos;s departure. Jauan Jennings signed elsewhere as well, leaving Brock
      Purdy to lean heavily on George Kittle and Deebo Samuel.
    </P>

    <H2>Start/Sit: Offense</H2>

    <H3>Start: Puka Nacua, WR, Rams</H3>
    <P>
      Nacua finished 2025 with 129 receptions, 1,715 yards, and 10 touchdowns. He is the WR1
      overall entering this game. Stafford&apos;s MVP season was built on targeting Nacua at an
      elite rate, and nothing about the offseason changed that connection. San Francisco&apos;s
      secondary lost McDuffie to the Rams in a trade, weakening the unit that would be tasked with
      shadowing Nacua. Lock him in as a top-tier start.
    </P>

    <H3>Start: Kyren Williams, RB, Rams</H3>
    <P>
      Williams posted his third consecutive 1,000-yard, 10-touchdown rushing season in 2025 and
      enters the year as the consensus RB2. The Rams&apos; implied total of 26 points projects a
      full offensive workload, and Williams handles early downs and goal-line carries. A favorable
      game script as 3.5-point favorites means more rushing attempts, not fewer.
    </P>

    <H3>Start: George Kittle, TE, 49ers (if active)</H3>
    <P>
      Kittle showed no limitations during camp and is expected to suit up Thursday. With Pearsall
      out for the season, Kirk on IR, and Aiyuk gone, Kittle becomes the most important receiving
      option on the roster. Target consolidation benefits tight ends more than any other position.
      If he is active, he is an elite TE1 this week.
    </P>

    <H3>Start: Christian McCaffrey, RB, 49ers (if active)</H3>
    <P>
      McCaffrey rushed for 1,202 yards and 10 touchdowns while adding 924 receiving yards and
      seven receiving scores in 2025. If he suits up, he is the overall RB1 regardless of matchup.
      His dual-threat usage becomes even more critical with the receiving corps depleted around him.
      Monitor his status through Thursday morning. If active, start him everywhere.
    </P>

    <H3>Start with Caveats: Davante Adams, WR, Rams</H3>
    <P>
      Adams posted 60 catches for 789 yards in 2025 but scored 14 touchdowns, a rate that is
      historically unsustainable. His fantasy value is TD-dependent: when he scores, he is a WR1;
      when he does not, he is a mid-tier WR3. Against a depleted 49ers secondary that will key on
      Nacua, Adams should see softer coverage. Start him as a WR2 but understand the floor is
      lower than the ranking suggests.
    </P>

    <H3>Start with Caveats: Matthew Stafford, QB, Rams</H3>
    <P>
      Stafford&apos;s 2025 MVP campaign featured a career-high 7.7 percent touchdown rate that
      is unlikely to repeat at that level. He is a strong QB2 this week in a favorable matchup with
      a 48.5 over/under, but one-QB league managers with elite options should not bench those
      options for him. In superflex, he is a locked-in starter.
    </P>

    <H3>Start with Caveats: Deebo Samuel, WR, 49ers</H3>
    <P>
      Samuel signed a one-year prove-it deal to stay in San Francisco and enters the season as the
      49ers&apos; WR1 by default after the roster losses. His PPR value rises when Kittle and
      McCaffrey draw defensive attention, and the depleted receiving corps forces Purdy to target
      him more frequently. Flex him in PPR formats with confidence, but temper expectations in
      standard scoring where his yards-per-target can fluctuate.
    </P>

    <H3>Start with Caveats: Brock Purdy, QB, 49ers</H3>
    <P>
      Purdy is a low-end QB2 this week. The receiving corps losses limit his ceiling, but McCaffrey
      and Kittle give him a reliable floor of checkdowns and intermediate throws. The 48.5
      over/under supports enough passing volume to keep him relevant in superflex and two-QB
      formats. In one-QB leagues, he is a fringe starter at best.
    </P>

    <H3>Sit: Rams Tight Ends</H3>
    <P>
      Los Angeles runs a four-way split at tight end that dilutes any single player&apos;s fantasy
      value. None of them projects for enough targets to warrant a start in standard-sized leagues.
      Avoid the entire group until one separates from the pack.
    </P>

    <H3>Sit: Blake Corum, RB, Rams</H3>
    <P>
      Corum is a TD-or-bust play behind Kyren Williams. He sees limited early-down work and his
      fantasy production depends entirely on whether he vultures a goal-line carry. In a game
      where Williams is the clear lead back, Corum belongs on the bench.
    </P>

    <H3>Sit: Rashod Evans, WR, Rams</H3>
    <P>
      Evans missed most of training camp and will be snap-managed in Week 1. Even at full health,
      he sits behind Nacua and Adams in the target pecking order. Let him get healthy and establish
      a role before considering him.
    </P>

    <H3>Sit: 49ers DST</H3>
    <P>
      San Francisco&apos;s defense faces a Rams offense that returned nearly every starter from
      an MVP-led unit. The implied total of 26 for Los Angeles tells you Vegas expects the Rams
      to score freely. Avoid the 49ers&apos; defense this week.
    </P>

    <H3>Play: Rams DST</H3>
    <P>
      The Rams traded for Myles Garrett (23 sacks in 2025), coaxed Aaron Donald out of retirement,
      and acquired Trent McDuffie from Seattle. That front seven faces a 49ers offense missing
      three of its top receivers and potentially without McCaffrey. Even if CMC plays, Purdy will
      be under constant pressure from a pass rush that combines Garrett, Donald, and Byron Young.
      Stream the Rams defense with confidence.
    </P>

    <H2>Start/Sit Summary</H2>
    <Table aria-labelledby="start-sit-summary">
      <THead>
        <TR><TH scope="col">Player</TH><TH scope="col">Pos</TH><TH scope="col">Verdict</TH><TH scope="col">Reasoning</TH></TR>
      </THead>
      <TBody>
        <TR><TD><S>Puka Nacua</S></TD><TD>WR</TD><TD>Start (WR1)</TD><TD>129-1715-10 in 2025, Stafford&apos;s top target, elite volume</TD></TR>
        <TR><TD><S>Kyren Williams</S></TD><TD>RB</TD><TD>Start (RB2)</TD><TD>Three straight 1000/10 seasons, favorable game script</TD></TR>
        <TR><TD><S>George Kittle</S></TD><TD>TE</TD><TD>Start (TE1, if active)</TD><TD>Target consolidation, SF&apos;s top receiving option</TD></TR>
        <TR><TD><S>Christian McCaffrey</S></TD><TD>RB</TD><TD>Start (RB1, if active)</TD><TD>1202/10 rush + 924/7 rec, dual-threat usage rises</TD></TR>
        <TR><TD><S>Davante Adams</S></TD><TD>WR</TD><TD>Start (WR2, TD-dependent)</TD><TD>14 TDs on 60 catches, softer coverage with Nacua drawing focus</TD></TR>
        <TR><TD><S>Matthew Stafford</S></TD><TD>QB</TD><TD>Start (QB2)</TD><TD>MVP season, career-high TD rate, high O/U</TD></TR>
        <TR><TD><S>Deebo Samuel</S></TD><TD>WR</TD><TD>Flex (PPR)</TD><TD>SF WR1 by default, prove-it deal, PPR upside</TD></TR>
        <TR><TD><S>Brock Purdy</S></TD><TD>QB</TD><TD>Low-end QB2</TD><TD>Receiver losses cap ceiling, CMC/Kittle floor</TD></TR>
        <TR><TD><S>Rams TEs</S></TD><TD>TE</TD><TD>Sit</TD><TD>Four-way split, no target concentration</TD></TR>
        <TR><TD><S>Blake Corum</S></TD><TD>RB</TD><TD>Sit</TD><TD>TD-or-bust behind Kyren Williams</TD></TR>
        <TR><TD><S>Rashod Evans</S></TD><TD>WR</TD><TD>Sit</TD><TD>Snap-managed after camp absence</TD></TR>
        <TR><TD><S>49ers DST</S></TD><TD>DST</TD><TD>Sit</TD><TD>Rams returned full MVP-led offense</TD></TR>
        <TR><TD><S>Rams DST</S></TD><TD>DST</TD><TD>Play</TD><TD>Garrett + Donald + McDuffie vs depleted SF offense</TD></TR>
      </TBody>
    </Table>

    <H2>CMC Inactive Contingency</H2>
    <P>
      If McCaffrey is ruled out Thursday, the backfield splits between Kaelon Black and Jordan
      James. Elijah Mitchell&apos;s departure and Isaac Guerendo&apos;s loss of the backup role
      to James during camp mean the committee is a two-man operation. Black gets early-down and
      goal-line work. James handles third downs and change-of-pace carries. Neither is a confident
      start in standard leagues, but Black has flex appeal in deeper formats given the projected
      goal-line touches. James is a PPR-only dart throw.
    </P>

    <H2>The Injury Board</H2>
    <P>
      Reported statuses heading into Thursday. Where a return timeline has not been announced,
      that is stated plainly.
    </P>

    <H3>49ers</H3>
    <UL>
      <LI><S>Ricky Pearsall, WR:</S> out for the season with a torn PCL. Removes the 49ers&apos; projected WR1 and consolidates targets toward Deebo Samuel, Kittle, and McCaffrey.</LI>
      <LI><S>Christian Kirk, WR:</S> injured reserve, calf injury. Out at least four games. Further thins a receiving corps already missing Pearsall and Aiyuk.</LI>
      <LI><S>Christian McCaffrey, RB:</S> game-time decision. Monitor his status through Thursday morning. If active, start him everywhere. If inactive, see the contingency plan above.</LI>
      <LI><S>Nick Bosa, EDGE:</S> active but returning from a torn ACL and battled patellar tendinitis during camp. Expected to be pitch-count managed Thursday. Fade him in IDP formats this week.</LI>
      <LI><S>Dre Greenlaw, LB:</S> active after returning from last season&apos;s Achilles tear. Cleared for full participation but may see a reduced snap count in his first game back.</LI>
    </UL>

    <H3>Rams</H3>
    <UL>
      <LI><S>Aaron Donald, DT:</S> active after coming out of retirement. Showed no limitations in camp and is expected to play a full snap count alongside Myles Garrett.</LI>
      <LI><S>Rashod Evans, WR:</S> active but expected to be snap-managed after missing most of training camp. Behind Nacua and Adams in the target order.</LI>
    </UL>

    <H2>IDP Streamers</H2>
    <P>
      The Rams&apos; defensive overhaul makes their front seven the primary IDP target this week.
      Garrett, Donald, and the new-look pass rush face a 49ers offensive line protecting Purdy
      behind a depleted receiving corps, which means more dropbacks, longer holds, and more
      pressure opportunities. On San Francisco&apos;s side, the tackle-volume plays come from
      linebackers and safeties projected for extended competitive snaps in a game with a 48.5 total.
    </P>

    <H3>Tackle Volume</H3>

    <H3>Landman, LB, Rams</H3>
    <P>
      Landman is the top IDP streamer of the week. He is the Rams&apos; primary run-fit
      linebacker and the hook-zone defender in nickel packages, which means he accumulates tackles
      against both the run and the short pass. San Francisco will try to establish the ground game
      early to keep Garrett and Donald off the field, and those runs funnel directly into
      Landman&apos;s gap. He has an LB1 floor in this matchup.
    </P>

    <H3>Speights, LB, Rams</H3>
    <P>
      Speights benefits from playing next to Landman in a front seven that commands attention up
      front. When Garrett and Donald collapse the pocket and force shorter throws, Speights
      cleans up tackles in zone coverage underneath. His value is volume-based: he stays on the
      field in base and nickel, and a competitive game keeps the defensive starters engaged deep
      into the fourth quarter.
    </P>

    <H3>Lake, S/NB, Rams</H3>
    <P>
      Lake plays the STAR slot defender role in the Rams&apos; nickel package, lining up over the
      slot receiver and making plays in the short area of the field. With San Francisco likely to
      target the middle of the field to avoid Garrett and Donald on the edges, Lake stays in the
      tackle flow on screens, quick slants, and checkdowns. He is a DB1 in formats that reward
      tackles from the secondary.
    </P>

    <H3>Curl, S, Rams</H3>
    <P>
      Curl plays in the box on early downs and attacks the line of scrimmage as a run-support
      defender. If McCaffrey is active, San Francisco&apos;s rushing attack runs through the A and
      B gaps, which brings Curl downhill on every carry. His tackle floor is steady regardless of
      game script because he is involved in both run fits and short-zone coverage.
    </P>

    <H3>Greenlaw, LB, 49ers</H3>
    <P>
      Greenlaw is back from last season&apos;s Achilles tear and cleared for full participation.
      His tackle instincts are proven, and a competitive game keeps him on the field for extended
      snaps. The concern is a reduced snap count in his first game back, which caps his ceiling.
      He is a deeper-league play only, but the talent and matchup are both there if the snap count
      cooperates.
    </P>

    <H3>Big-Play Upside</H3>

    <H3>Byron Young, EDGE, Rams</H3>
    <P>
      Young lines up opposite Myles Garrett on the Rams&apos; defensive line. When Garrett draws
      the double team and chip blocks from the 49ers&apos; protection scheme, Young gets clean
      one-on-one rushes against the opposite tackle. His sack upside this week is structural: the
      attention Garrett commands creates favorable matchups for everyone else on the edge.
    </P>

    <H3>Mykel Williams, DE, 49ers</H3>
    <P>
      Williams draws McClendon at right tackle for the Rams, the weakest link on Los Angeles&apos;s
      offensive line. That specific matchup gives Williams favorable pass-rush reps on obvious
      passing downs. His value is tied to that alignment: if McClendon struggles early, Williams
      could see increased usage as the 49ers try to manufacture pressure from the interior.
    </P>

    <H3>Kinchens, FS, Rams</H3>
    <P>
      Kinchens plays deep centerfield behind a pass rush that features Garrett and Donald. When the
      front four generates pressure, quarterbacks throw off-platform into Kinchens&apos;s coverage
      zone. The turnover upside is the appeal here, not the tackle floor. He is a boom-or-bust
      IDP streamer best suited for formats that reward interceptions and pass breakups.
    </P>

    <H3>IDP Fade: Nick Bosa, EDGE, 49ers</H3>
    <P>
      Bosa is returning from a torn ACL and battled patellar tendinitis throughout camp. The
      49ers plan to pitch-count manage him Thursday, which means limited snaps on a defense
      that may be on the field for extended drives against the Rams&apos; methodical offense.
      The talent is elite, but the snap count caps his fantasy ceiling this week. Avoid streaming
      him until the workload normalizes.
    </P>

    <H2>IDP Streamer Summary</H2>
    <Table aria-labelledby="idp-streamer-summary">
      <THead>
        <TR><TH scope="col">Player</TH><TH scope="col">Pos</TH><TH scope="col">Team</TH><TH scope="col">Type</TH><TH scope="col">Why This Week</TH></TR>
      </THead>
      <TBody>
        <TR><TD><S>Landman</S></TD><TD>LB</TD><TD>LAR</TD><TD>Tackle</TD><TD>Run-fit LB, SF runs into his gap, LB1 floor</TD></TR>
        <TR><TD><S>Speights</S></TD><TD>LB</TD><TD>LAR</TD><TD>Tackle</TD><TD>Zone cleanup tackles, full-time snaps in base and nickel</TD></TR>
        <TR><TD><S>Lake</S></TD><TD>S/NB</TD><TD>LAR</TD><TD>Tackle</TD><TD>STAR slot role, middle-of-field tackles on checkdowns</TD></TR>
        <TR><TD><S>Curl</S></TD><TD>S</TD><TD>LAR</TD><TD>Tackle</TD><TD>Box safety, run-support tackles on early downs</TD></TR>
        <TR><TD><S>Greenlaw</S></TD><TD>LB</TD><TD>SF</TD><TD>Tackle</TD><TD>Proven instincts, snap count concern caps ceiling</TD></TR>
        <TR><TD><S>Byron Young</S></TD><TD>EDGE</TD><TD>LAR</TD><TD>Big-play</TD><TD>Opposite Garrett, clean one-on-ones when Garrett draws doubles</TD></TR>
        <TR><TD><S>Mykel Williams</S></TD><TD>DE</TD><TD>SF</TD><TD>Big-play</TD><TD>Draws McClendon at RT, favorable pass-rush matchup</TD></TR>
        <TR><TD><S>Kinchens</S></TD><TD>FS</TD><TD>LAR</TD><TD>Big-play</TD><TD>Turnover upside behind Garrett/Donald pressure</TD></TR>
      </TBody>
    </Table>

    <H2>The Thursday Night Edge</H2>
    <P>
      Melbourne adds a layer of unpredictability: neither team has a home-field advantage, the
      playing surface is a cricket oval converted for football, and the compressed travel schedule
      puts a premium on roster continuity. The Rams have that continuity on offense and rebuilt
      their defense with proven veterans who do not need a system ramp-up. The 49ers are running
      a receiver corps held together by Kittle, Samuel, and the hope that McCaffrey suits up.
    </P>
    <Quote>
      The Rams&apos; defensive overhaul is the story of this game. Garrett, Donald, and McDuffie
      give Los Angeles the pass-rush and coverage combination to suffocate a depleted 49ers
      passing attack. Stream the Rams&apos; front seven in IDP formats and their team defense
      in all formats.
    </Quote>
    <P>
      Set your lineups around the Rams&apos; implied 26-point total, grab the IDP streamers before
      Thursday waivers lock, and monitor McCaffrey&apos;s status through the morning. If CMC sits,
      pivot to Black for goal-line flex value and adjust your 49ers exposure downward across the
      board.
    </P>
  </>
);

export default Body;
