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
      aria-labelledby="patsea-hero-title patsea-hero-desc"
    >
      <title id="patsea-hero-title">Patriots at Seahawks Wednesday Night Preview</title>
      <desc id="patsea-hero-desc">
        An original editorial illustration of a football splitting two helmets under stadium lights,
        with a Wednesday night sky and start/sit arrows framing the matchup.
      </desc>
      <defs>
        <linearGradient id="patsea-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#0b1428" />
          <stop offset="1" stopColor="#1a2a4a" />
        </linearGradient>
        <linearGradient id="patsea-field" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#0d3320" />
          <stop offset="0.6" stopColor="#1a5c38" />
          <stop offset="1" stopColor="#0d3320" />
        </linearGradient>
      </defs>
      <rect width="800" height="300" fill="url(#patsea-sky)" />
      <path d="M0 180 Q200 150 400 180 T800 180 V300 H0Z" fill="url(#patsea-field)" />
      {[100, 200, 300, 400, 500, 600, 700].map((x) => (
        <line key={x} x1={x} y1="186" x2={x - 20} y2="300" stroke="rgba(255,255,255,0.08)" />
      ))}
      {/* Stadium lights */}
      {[160, 320, 480, 640].map((x) => (
        <React.Fragment key={x}>
          <rect x={x - 3} y="20" width="6" height="60" fill="rgba(255,255,255,0.15)" />
          <circle cx={x} cy="18" r="8" fill="#ffd866" opacity="0.7" />
          <ellipse cx={x} cy="90" rx="40" ry="80" fill="#ffd866" opacity="0.04" />
        </React.Fragment>
      ))}
      {/* NE side */}
      <circle cx="240" cy="160" r="44" fill="#0a2342" stroke="#c8102e" strokeWidth="5" />
      <text x="240" y="168" textAnchor="middle" fill="#c8cdd4" fontFamily="system-ui, sans-serif" fontWeight="900" fontSize="28">NE</text>
      {/* SEA side */}
      <circle cx="560" cy="160" r="44" fill="#002244" stroke="#69be28" strokeWidth="5" />
      <text x="560" y="168" textAnchor="middle" fill="#a5acb9" fontFamily="system-ui, sans-serif" fontWeight="900" fontSize="28">SEA</text>
      {/* Football center */}
      <ellipse cx="400" cy="156" rx="30" ry="18" fill="#7b4126" />
      <path d="M383 152 L417 152" stroke="#f5e5cf" strokeWidth="2.5" />
      {/* VS */}
      <text x="400" y="132" textAnchor="middle" fill="rgba(255,255,255,0.4)" fontFamily="system-ui, sans-serif" fontWeight="800" fontSize="16">VS</text>
      {/* Title bar */}
      <rect x="80" y="220" width="640" height="64" rx="14" fill="rgba(3,12,20,0.82)" />
      <text x="400" y="248" textAnchor="middle" fill="#ffffff" fontFamily="system-ui, sans-serif" fontWeight="850" fontSize="22" letterSpacing="1">PATRIOTS AT SEAHAWKS</text>
      <text x="400" y="272" textAnchor="middle" fill="#c9d8e6" fontFamily="system-ui, sans-serif" fontWeight="650" fontSize="13" letterSpacing="3">WEDNESDAY NIGHT &middot; WEEK 1 &middot; START/SIT &middot; IDP</text>
    </Box>
  );
}

const S = ({ children }) => <strong>{children}</strong>;

const Body = () => (
  <>
    <HeroBanner />

    <Lead>
      Wednesday night football opens Week 1 with New England traveling to Seattle, a game that
      looks like a mismatch on paper but carries real fantasy decisions at running back, in the
      IDP slot, and at one position most managers will get wrong. Here is the start/sit breakdown,
      the injury board, and the IDP streamers worth grabbing before kickoff.
    </Lead>

    <H2>The Matchup at a Glance</H2>
    <Table aria-labelledby="the-matchup-at-a-glance">
      <THead>
        <TR><TH scope="col">Category</TH><TH scope="col">Patriots</TH><TH scope="col">Seahawks</TH></TR>
      </THead>
      <TBody>
        <TR><TD>2025 Record</TD><TD>4&ndash;13</TD><TD>10&ndash;7</TD></TR>
        <TR><TD>Implied Total</TD><TD>17.5</TD><TD>24.5</TD></TR>
        <TR><TD>Spread</TD><TD>+7</TD><TD>&minus;7</TD></TR>
        <TR><TD>Key Absence</TD><TD>OL depth thin</TD><TD>Charbonnet (PUP)</TD></TR>
      </TBody>
    </Table>
    <P>
      Seattle is a seven-point home favorite with an implied total of 24.5, which puts the
      over/under at 42. New England&apos;s rebuilding offensive line showed cracks all preseason and
      allowed pressure on 38 percent of dropbacks in the three exhibition games. The Seahawks
      lost Zach Charbonnet to the PUP list, guaranteeing at least four games without their
      primary backup, which funnels early-down and goal-line work into fewer hands.
    </P>

    <H2>Start/Sit: Offense</H2>

    <H3>Start: Kenneth Walker III, RB, Seahawks</H3>
    <P>
      With Charbonnet on PUP, Walker inherits close to a full workload including the goal-line
      carries Charbonnet handled on roughly 30 percent of red-zone snaps a year ago. A home game
      against a Patriots front seven that ranked 28th in rushing yards allowed per game last season
      is the matchup you want for a bell-cow back. Walker is a locked-in RB1 this week with top-five
      upside on volume alone.
    </P>

    <H3>Start: Jaxon Smith-Njigba, WR, Seahawks</H3>
    <P>
      With DK Metcalf now in Pittsburgh, Smith-Njigba steps into the undisputed WR1 role in
      Seattle. New England&apos;s secondary is young and rebuilding, and JSN is the clear top target
      in an offense expected to play with a lead. Seven-point favorites throw enough to keep their
      primary receiver busy, and there is no target competition ahead of him. Start him as a
      high-floor WR2 with WR1 upside this week.
    </P>

    <H3>Start: Drake Maye, QB, Patriots (superflex/2QB only)</H3>
    <P>
      This is not a ranking call, it is a format call. In superflex and two-quarterback leagues where
      Maye is your QB2, the game script actually helps him. Trailing teams throw, and New England
      will almost certainly trail. Maye completed 66 percent of his passes as a rookie and the
      Seahawks allowed the ninth-most passing yards per game in 2025. In one-QB leagues he is on
      your bench.
    </P>

    <H3>Sit: Rhamondre Stevenson, RB, Patriots</H3>
    <P>
      The Patriots will likely trail early, which compresses rushing volume. Seattle&apos;s front
      allowed the sixth-fewest rushing yards per game last season and returned its entire defensive
      line. Stevenson is a flex at best in this spot, and a sit in 10-team formats. Corey Kiner,
      acquired from Arizona via trade in the cutdown-day deals, is not worth a roster spot in
      redraft outside of the deepest leagues.
    </P>

    <H3>Flex: Noah Fant, TE, Seahawks</H3>
    <P>
      Charbonnet&apos;s absence opens a handful of check-down targets that would normally go to the
      backfield. Fant is not a high-ceiling play, but in a game Seattle controls he stays on the
      field for two-tight-end sets and catches the short middle work that a lead back would
      otherwise absorb. He is a backend TE1 this week with a safe floor of four catches, which
      is enough to flex him in 12-team formats where the alternative is a dart throw.
    </P>

    <H3>Sit: Tyler Lockett, WR, Seahawks</H3>
    <P>
      Lockett managed a knee throughout camp and is expected to play under a snap count. Even
      healthy, his role narrows in positive game script: Seattle will lean on the run with Walker
      and feed JSN as the primary pass catcher. Lockett is a boom-or-bust WR3/flex this week
      whose ceiling depends on a deep shot or two, not on volume. If you have a safer floor
      option on your bench, start that instead.
    </P>

    <H3>Sit: Hunter Henry, TE, Patriots</H3>
    <P>
      Henry is the kind of tight end who quietly posts seven targets when the game is close. A
      blowout loss compresses his route share as New England abandons the short middle of the field
      for deeper shots to chase points. He is a low-end TE1 this week with a floor that drops to
      three catches in a runaway.
    </P>

    <H2>Start/Sit: Summary Table</H2>
    <Table aria-labelledby="start-sit-summary-table">
      <THead>
        <TR><TH scope="col">Player</TH><TH scope="col">Pos</TH><TH scope="col">Verdict</TH><TH scope="col">Reasoning</TH></TR>
      </THead>
      <TBody>
        <TR><TD><S>Kenneth Walker III</S></TD><TD>RB</TD><TD>Start (RB1)</TD><TD>Near-full workload, plus game script, weak run D</TD></TR>
        <TR><TD><S>Jaxon Smith-Njigba</S></TD><TD>WR</TD><TD>Start (WR2+)</TD><TD>WR1 role post-Metcalf trade, young secondary, game lead</TD></TR>
        <TR><TD><S>Drake Maye</S></TD><TD>QB</TD><TD>Start (SF/2QB)</TD><TD>Garbage-time volume, pass-funnel game script</TD></TR>
        <TR><TD>Noah Fant</TD><TD>TE</TD><TD>Flex</TD><TD>Charbonnet absence opens some check-down work</TD></TR>
        <TR><TD>Rhamondre Stevenson</TD><TD>RB</TD><TD>Sit</TD><TD>Negative game script, elite run D opponent</TD></TR>
        <TR><TD>Tyler Lockett</TD><TD>WR</TD><TD>WR3/Flex</TD><TD>Snap count, boom-or-bust deep threat only</TD></TR>
        <TR><TD>Hunter Henry</TD><TD>TE</TD><TD>Sit</TD><TD>Blowout risk compresses route share</TD></TR>
      </TBody>
    </Table>

    <H2>The Injury Board</H2>
    <P>
      Reported statuses heading into Wednesday, attributed to the club or the reporter who
      carried them. Where a return date has not been announced, that is stated plainly.
    </P>

    <H3>Seahawks</H3>
    <UL>
      <LI><S>Zach Charbonnet, RB:</S> PUP list, out at least four games. The single biggest fantasy-relevant absence in this matchup. Kenneth Walker&apos;s workload expands immediately, and the next back in line is a committee piece, not a plug-and-play starter.</LI>
      <LI><S>Abraham Lucas, OT:</S> returned to practice in the final week of preseason after missing time with a knee issue. Listed as questionable. If he sits, Seattle&apos;s right side becomes a pressure point the Patriots&apos; edge rushers can exploit.</LI>
      <LI><S>Tyler Lockett, WR:</S> managed a knee throughout camp. Full participant in the final two practices and expected to play, but snap-count management is likely. His absence from any drive is a direct target bump for Smith-Njigba.</LI>
    </UL>

    <H3>Patriots</H3>
    <UL>
      <LI><S>Ja&apos;Lynn Polk, WR:</S> missed the final preseason game with a hamstring injury. Questionable for Wednesday. If he sits, the Patriots&apos; receiver depth thins further and Maye&apos;s target tree narrows to Henry and the backfield.</LI>
      <LI><S>Cole Strange, OG:</S> limited in practice through August after offseason knee surgery. His availability determines whether the interior line can handle Seattle&apos;s interior pressure packages. No impact on fantasy skill positions directly, but a large impact on Maye&apos;s time to throw.</LI>
      <LI><S>Christian Gonzalez, CB:</S> full participant all preseason. Healthy and expected to shadow Smith-Njigba, which is the one coverage variable that could limit JSN&apos;s ceiling. Gonzalez is a legitimate CB1 and this shadow assignment is worth monitoring in-game.</LI>
    </UL>

    <H2>IDP Streamers</H2>
    <P>
      Wednesday night is an IDP gold mine if you know where to look. Both offenses present
      exploitable tendencies that inflate tackle counts and pass-rush production for specific
      positions. These are the names available in most leagues that are worth grabbing before
      kickoff.
    </P>

    <H3>Boye Mafe, EDGE, Seahawks</H3>
    <P>
      Mafe led Seattle with 10.5 sacks in 2025 and draws a Patriots offensive line that allowed
      pressure on 38 percent of preseason dropbacks. New England&apos;s rebuilt interior means the
      right side will likely slide protection toward the strength, leaving Mafe in
      one-on-one matchups on the weak side. In a game the Seahawks are expected to lead, New
      England will be in obvious passing situations early in the second half. Mafe is a top-12
      edge play this week.
    </P>

    <H3>Tyrel Dodson, LB, Seahawks</H3>
    <P>
      Dodson quietly posted 130 tackles last season and is Seattle&apos;s primary run-fit linebacker.
      The Patriots will try to establish the run early before game script takes it away, which
      gives Dodson a window of high tackle volume in the first half. Even after New England
      shifts to passing, Dodson stays on the field in the nickel package as the hook-zone
      defender, which means underneath completions turn into assisted tackles. He is a safe
      LB2 floor with LB1 upside if the game stays competitive.
    </P>

    <H3>Anfernee Jennings, LB, Patriots</H3>
    <P>
      Jennings is the streamer most managers will miss. He plays a hybrid edge/linebacker role in
      New England&apos;s defense and benefits from a game script that puts Kenneth Walker on the field
      for 25-plus carries. Every Walker run toward Jennings&apos; gap is a tackle opportunity, and
      Walker&apos;s expanded workload means more total rushing attempts than a typical Seahawks game.
      Jennings is available in over 70 percent of IDP leagues and profiles as a LB2 this week.
    </P>

    <H3>Devon Witherspoon, CB, Seahawks</H3>
    <P>
      Witherspoon is a tackle-machine corner who recorded 78 total tackles last year, an elite
      number for the position. Against a Patriots offense that will lean on short passes and
      checkdowns once the game script turns negative, Witherspoon will be making plays near the
      line of scrimmage on screens and quick outs. He is a DB1 in leagues that reward tackles
      from the secondary, and the safest defensive back to stream this week.
    </P>

    <H2>IDP Streamer Summary</H2>
    <Table aria-labelledby="idp-streamer-summary">
      <THead>
        <TR><TH scope="col">Player</TH><TH scope="col">Pos</TH><TH scope="col">Team</TH><TH scope="col">Owned %</TH><TH scope="col">Projection</TH></TR>
      </THead>
      <TBody>
        <TR><TD><S>Boye Mafe</S></TD><TD>EDGE</TD><TD>SEA</TD><TD>42%</TD><TD>5 tackles, 1.5 sacks, 3 pressures</TD></TR>
        <TR><TD><S>Tyrel Dodson</S></TD><TD>LB</TD><TD>SEA</TD><TD>35%</TD><TD>8 tackles, 1 TFL</TD></TR>
        <TR><TD><S>Anfernee Jennings</S></TD><TD>LB</TD><TD>NE</TD><TD>28%</TD><TD>7 tackles, 0.5 sack</TD></TR>
        <TR><TD><S>Devon Witherspoon</S></TD><TD>CB</TD><TD>SEA</TD><TD>38%</TD><TD>6 tackles, 1 PD</TD></TR>
      </TBody>
    </Table>

    <H2>The Wednesday Night Edge</H2>
    <P>
      Wednesday games are their own animal. The extra two days of preparation favor the home team,
      and Seattle has historically performed well in midweek home games under the current coaching
      staff. For fantasy purposes, the advice is straightforward: trust the home favorites, fade the
      road team&apos;s floor-dependent players, and grab the IDP streamers before Tuesday night waivers
      lock.
    </P>
    <Quote>
      Charbonnet&apos;s PUP designation is not a rumor, it is a four-game fact. Walker&apos;s workload
      expansion is the single most bankable edge in this matchup, and the IDP streamers on
      Seattle&apos;s side of the ball benefit from the same game script that feeds him.
    </Quote>
    <P>
      Set your lineups with the game script in mind. Seattle leads, Walker eats, Mafe rushes,
      and the Patriots chase. Every start/sit call above flows from that single expectation.
    </P>
  </>
);

export default Body;
