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
        with a Wednesday night sky and a Super Bowl rematch banner framing the matchup.
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
      {[160, 320, 480, 640].map((x) => (
        <React.Fragment key={x}>
          <rect x={x - 3} y="20" width="6" height="60" fill="rgba(255,255,255,0.15)" />
          <circle cx={x} cy="18" r="8" fill="#ffd866" opacity="0.7" />
          <ellipse cx={x} cy="90" rx="40" ry="80" fill="#ffd866" opacity="0.04" />
        </React.Fragment>
      ))}
      <circle cx="240" cy="160" r="44" fill="#0a2342" stroke="#c8102e" strokeWidth="5" />
      <text x="240" y="168" textAnchor="middle" fill="#c8cdd4" fontFamily="system-ui, sans-serif" fontWeight="900" fontSize="28">NE</text>
      <circle cx="560" cy="160" r="44" fill="#002244" stroke="#69be28" strokeWidth="5" />
      <text x="560" y="168" textAnchor="middle" fill="#a5acb9" fontFamily="system-ui, sans-serif" fontWeight="900" fontSize="28">SEA</text>
      <ellipse cx="400" cy="156" rx="30" ry="18" fill="#7b4126" />
      <path d="M383 152 L417 152" stroke="#f5e5cf" strokeWidth="2.5" />
      <text x="400" y="132" textAnchor="middle" fill="rgba(255,255,255,0.4)" fontFamily="system-ui, sans-serif" fontWeight="800" fontSize="16">VS</text>
      <path d="M394 190 L406 190 L404 200 L396 200Z" fill="#ffd866" opacity="0.5" />
      <text x="400" y="214" textAnchor="middle" fill="#ffd866" fontFamily="system-ui, sans-serif" fontWeight="700" fontSize="10" opacity="0.7" letterSpacing="2">SB LX REMATCH</text>
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
      The 2026 NFL season opens with a Super Bowl LX rematch: New England at Seattle, Wednesday
      night at Lumen Field. The defending-champion Seahawks returned the league&apos;s best defense
      and added Cooper Kupp and Rashid Shaheed to an offense that already featured Jaxon
      Smith-Njigba. The Patriots, after their first Super Bowl appearance in five years, retooled
      with A.J. Brown and Romeo Doubs flanking Drake Maye. This is not a mismatch. It is a
      3.5-point game with a 45.5 over/under, and fantasy managers need to pay close attention to
      both sides. Here is the full start/sit breakdown, the injury board, and the IDP streamers.
    </Lead>

    <H2>The Matchup at a Glance</H2>
    <Table aria-labelledby="the-matchup-at-a-glance">
      <THead>
        <TR><TH scope="col">Category</TH><TH scope="col">Patriots</TH><TH scope="col">Seahawks</TH></TR>
      </THead>
      <TBody>
        <TR><TD>2025 Result</TD><TD>Super Bowl LX runners-up</TD><TD>Super Bowl LX champions</TD></TR>
        <TR><TD>Implied Total</TD><TD>~21</TD><TD>~24.5</TD></TR>
        <TR><TD>Spread</TD><TD>+3.5</TD><TD>&minus;3.5</TD></TR>
        <TR><TD>Key Absence</TD><TD>-</TD><TD>Charbonnet (PUP, torn ACL)</TD></TR>
      </TBody>
    </Table>
    <P>
      A 3.5-point spread in a Super Bowl rematch means Vegas sees this as a competitive game, not
      a coronation. The 45.5 over/under is the highest of the Wednesday slate and suggests both
      offenses will move the ball. Seattle&apos;s championship defense is real, but so is New
      England&apos;s receiver upgrade: Brown and Doubs give Maye a pair of proven route runners he
      did not have in last year&apos;s playoff run.
    </P>

    <H2>Start/Sit: Offense</H2>

    <H3>Start: Kenneth Walker III, RB, Seahawks</H3>
    <P>
      Zach Charbonnet tore his ACL during the Seahawks&apos; divisional-round win over San Francisco
      in January, had surgery on February 20, and opened the season on PUP. He cannot return before
      Week 5 at the earliest. Walker inherits the full early-down and goal-line workload, with only
      Jadarian Price, George Holani, and Emanuel Wilson behind him. A home game where the Seahawks
      are favored means positive game script and a run-first approach. Walker is a locked-in RB1
      this week with top-five upside on volume alone.
    </P>

    <H3>Start: A.J. Brown, WR, Patriots</H3>
    <P>
      Brown is the centerpiece of New England&apos;s offseason overhaul and steps in as Maye&apos;s
      clear WR1. A 45.5 over/under and a competitive spread mean this game should stay close enough
      for the Patriots to run their full playbook rather than abandon it early. Seattle&apos;s
      defense is elite, but Brown has beaten elite coverage his entire career and commands targets
      in contested situations. He is a top-12 WR play this week with a high floor in PPR formats.
    </P>

    <H3>Start: Jaxon Smith-Njigba, WR, Seahawks</H3>
    <P>
      With DK Metcalf now in his second season in Pittsburgh, Smith-Njigba remains the top target
      in a Seattle passing game that added Kupp and Shaheed around him this offseason. Sam Darnold
      has a deep receiving corps for the first time in his career, but JSN is the chain-mover who
      ate targets all through the 2025 championship run. At home in a game Seattle is expected to
      control, JSN profiles as a high-floor WR2 with WR1 upside if the game stays competitive
      enough to keep Darnold throwing.
    </P>

    <H3>Start: Drake Maye, QB, Patriots (superflex/2QB only)</H3>
    <P>
      This is a format call, not a ranking call. In superflex and two-QB leagues, a close game with
      a 45.5 over/under means Maye throws 30-plus times into a shootout script rather than chasing
      a blowout from behind. He has real weapons now in Brown and Doubs, which raises his ceiling
      considerably from last season. In one-QB leagues he sits behind established options.
    </P>

    <H3>Flex: Romeo Doubs, WR, Patriots</H3>
    <P>
      New England signed Doubs to a four-year, $68 million deal this offseason, installing him as
      the WR2 opposite Brown. The volume should be there in a game with a 45.5 total, but this is
      his first game in a new offense against the defending champions&apos; secondary. Flex him in
      12-team formats. Give him a week on the bench in shallower leagues while you see how the
      target share develops among Brown, Doubs, and DeMario Douglas.
    </P>

    <H3>Sit: Rhamondre Stevenson, RB, Patriots</H3>
    <P>
      Seattle fielded the NFL&apos;s best defense in 2025 en route to the championship, and they
      returned the core of it. Leonard Williams, Byron Murphy II, and Ernest Jones IV are all back.
      The Patriots may need to throw to keep pace, which compresses rushing volume even in a close
      game. TreVeyon Henderson is in the mix for goal-line work. Stevenson is a flex at best and a
      sit in 10-team formats.
    </P>

    <H3>Sit: Cooper Kupp, WR, Seahawks</H3>
    <P>
      Kupp arrived in Seattle this offseason and joins a receiving corps where Smith-Njigba and
      Shaheed are already established in the system. At 33, after multiple injury-shortened seasons,
      Week 1 in a new offense with a new quarterback is a wait-and-see situation. He may finish as
      a WR2 by midseason, but this week he is a boom-or-bust flex whose target share has not been
      proven in live action. Let someone else start him and show you the role first.
    </P>

    <H3>Sit: Hunter Henry, TE, Patriots</H3>
    <P>
      Henry is a reliable option in close games, but New England&apos;s receiver overhaul pushes him
      down the target pecking order. Brown and Doubs will command the primary share of Maye&apos;s
      throws. Against Seattle&apos;s defense the passing volume should be adequate, but Henry&apos;s
      slice of it shrinks. He is a backend TE1 with limited upside this week.
    </P>

    <H2>Start/Sit Summary</H2>
    <Table aria-labelledby="start-sit-summary">
      <THead>
        <TR><TH scope="col">Player</TH><TH scope="col">Pos</TH><TH scope="col">Verdict</TH><TH scope="col">Reasoning</TH></TR>
      </THead>
      <TBody>
        <TR><TD><S>Kenneth Walker III</S></TD><TD>RB</TD><TD>Start (RB1)</TD><TD>Full workload, Charbonnet on PUP, positive game script</TD></TR>
        <TR><TD><S>A.J. Brown</S></TD><TD>WR</TD><TD>Start (WR1)</TD><TD>NE&apos;s top target, competitive game, high O/U</TD></TR>
        <TR><TD><S>Jaxon Smith-Njigba</S></TD><TD>WR</TD><TD>Start (WR2)</TD><TD>SEA&apos;s WR1, high-floor target share, home favorite</TD></TR>
        <TR><TD><S>Drake Maye</S></TD><TD>QB</TD><TD>Start (SF/2QB)</TD><TD>Upgraded weapons, competitive game script, high O/U</TD></TR>
        <TR><TD>Romeo Doubs</TD><TD>WR</TD><TD>Flex</TD><TD>$68M WR2, first game in new system</TD></TR>
        <TR><TD>Rhamondre Stevenson</TD><TD>RB</TD><TD>Sit</TD><TD>Best run defense in NFL, Henderson in the mix</TD></TR>
        <TR><TD>Cooper Kupp</TD><TD>WR</TD><TD>Sit</TD><TD>New offense, unproven target share, wait-and-see</TD></TR>
        <TR><TD>Hunter Henry</TD><TD>TE</TD><TD>Sit</TD><TD>Pushed down target order by WR upgrades</TD></TR>
      </TBody>
    </Table>

    <H2>The Injury Board</H2>
    <P>
      Reported statuses heading into Wednesday. Where a return date has not been announced, that
      is stated plainly.
    </P>

    <H3>Seahawks</H3>
    <UL>
      <LI><S>Zach Charbonnet, RB:</S> PUP list, out at least four games. Tore his ACL during the divisional-round playoff win over San Francisco in January, surgery February 20. Earliest possible return is Week 5. Kenneth Walker&apos;s workload expands immediately, with Jadarian Price, George Holani, and Emanuel Wilson as the depth pieces behind him.</LI>
      <LI><S>Irvin Charles, WR:</S> injured reserve. Removes a depth receiver, though the top three of Smith-Njigba, Shaheed, and Kupp are unaffected.</LI>
      <LI><S>Jake Bobo, WR:</S> injured reserve. Thins Seattle&apos;s receiver depth behind the top three, elevating Tory Horton into a larger role.</LI>
      <LI><S>DeMarcus Lawrence, EDGE:</S> healthy and active. The 34-year-old reportedly considered retirement this offseason but returned after posting six sacks and 39 pressures in 2025. He anchors the pass rush alongside Uchenna Nwosu and Derick Hall.</LI>
    </UL>

    <H3>Patriots</H3>
    <UL>
      <LI><S>Jeremiah Webb, WR:</S> injured reserve. A depth loss that does not affect the top of the chart with Brown, Doubs, and DeMario Douglas healthy.</LI>
      <LI><S>Corey Kiner, RB:</S> acquired from Arizona in a cutdown-day trade. Provides depth behind Stevenson and TreVeyon Henderson but is not a redraft-relevant name outside the deepest leagues.</LI>
    </UL>

    <H2>IDP Streamers</H2>
    <P>
      A Super Bowl rematch between two playoff teams means extended competitive snaps for defensive
      starters on both sides, which inflates IDP production. Seattle&apos;s championship defense is
      the side to target because the Patriots will need to throw to keep pace, and pressured passing
      creates sacks, tackles for loss, and takeaway opportunities.
    </P>

    <H3>Ernest Jones IV, LB, Seahawks</H3>
    <P>
      Jones earned Pro Bowl honors anchoring the middle of Seattle&apos;s championship defense in
      2025. He is the primary run-fit linebacker and the hook-zone defender in nickel, which means
      he accumulates tackles against both the run and the short pass. Against a Patriots offense that
      may lean on quick throws to handle Seattle&apos;s pass rush, Jones stays on the field and in
      the tackle flow. He is a top-10 LB play this week with an LB1 floor.
    </P>

    <H3>DeMarcus Lawrence, EDGE, Seahawks</H3>
    <P>
      Lawrence posted six sacks and 39 pressures in 2025 at age 33, then came back for one more
      year after reportedly weighing retirement. The 34-year-old draws a Patriots offensive line
      in its first live game protecting Maye behind a retooled roster. His ownership is below 50
      percent in most IDP formats because of the age, but the production is still there and a home
      game where New England has to throw makes him a high-floor edge streamer. Top-15 EDGE play.
    </P>

    <H3>Derick Hall, EDGE, Seahawks</H3>
    <P>
      Hall is the younger complement to Lawrence and Nwosu on Seattle&apos;s deep edge rotation. In
      a game where the Patriots need to pass to keep pace, Hall benefits from the attention Lawrence
      draws on the opposite side. Available in over 60 percent of IDP leagues, he projects for
      three to four tackles with sack upside in a game Seattle controls at home. A solid EDGE2
      streamer this week.
    </P>

    <H3>Devon Witherspoon, CB, Seahawks</H3>
    <P>
      Witherspoon is a tackle-machine corner in a championship secondary. Against a Patriots offense
      that will lean on Brown and Doubs in the short-to-intermediate range, Witherspoon will make
      plays near the line on screens and quick outs. He is a DB1 in leagues that reward tackles
      from the secondary and the safest defensive back to stream this week.
    </P>

    <H2>IDP Streamer Summary</H2>
    <Table aria-labelledby="idp-streamer-summary">
      <THead>
        <TR><TH scope="col">Player</TH><TH scope="col">Pos</TH><TH scope="col">Team</TH><TH scope="col">Why This Week</TH></TR>
      </THead>
      <TBody>
        <TR><TD><S>Ernest Jones IV</S></TD><TD>LB</TD><TD>SEA</TD><TD>Pro Bowl LB, tackle machine, on field in nickel</TD></TR>
        <TR><TD><S>DeMarcus Lawrence</S></TD><TD>EDGE</TD><TD>SEA</TD><TD>6 sacks in 2025, NE must pass, home game</TD></TR>
        <TR><TD><S>Derick Hall</S></TD><TD>EDGE</TD><TD>SEA</TD><TD>Benefits from Lawrence attention, pass-heavy script</TD></TR>
        <TR><TD><S>Devon Witherspoon</S></TD><TD>CB</TD><TD>SEA</TD><TD>Tackle-heavy corner vs. short-pass offense</TD></TR>
      </TBody>
    </Table>

    <H2>The Wednesday Night Edge</H2>
    <P>
      Wednesday openers favor the home team, and Seattle has the added advantage of being the
      defending champions returning to their own stadium. For fantasy purposes, the 3.5-point
      spread and 45.5 over/under tell you this game stays competitive: neither offense shuts down,
      and both passing games stay engaged deep into the fourth quarter. That benefits skill players
      on both sides but particularly benefits Seattle&apos;s defense, which gets extended snaps
      against a Patriots offense forced to throw in an environment where the 12th Man will be at
      full volume for the banner ceremony.
    </P>
    <Quote>
      Charbonnet&apos;s torn ACL is a four-game absence at minimum. Walker&apos;s expanded workload
      is the most bankable edge in this game. On the other side, Seattle&apos;s championship
      defense against a second-year quarterback with new receivers is the IDP matchup of the week.
    </Quote>
    <P>
      Set your lineups with the spread in mind. This is not a blowout script. Both offenses will
      be on the field, both passing games will be active, and the streamers on Seattle&apos;s
      defense will eat.
    </P>
  </>
);

export default Body;
