import React, { useState } from 'react';
import { Box, Tabs, Tab } from '@mui/material';
import {
  Lead, P, H2, Quote, UL, LI,
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
      aria-labelledby="wk1s-hero-title wk1s-hero-desc"
    >
      <title id="wk1s-hero-title">Week 1 Full Slate Fantasy Analysis</title>
      <desc id="wk1s-hero-desc">
        A command-center illustration with a central clock dial surrounded by stadium silhouettes,
        time-slot markers for every Sunday and Monday game, and a Week 1 Full Slate banner.
      </desc>
      <defs>
        <linearGradient id="wk1s-bg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#0a0e1a" />
          <stop offset="1" stopColor="#141e33" />
        </linearGradient>
        <linearGradient id="wk1s-glow" x1="0.5" y1="0" x2="0.5" y2="1">
          <stop offset="0" stopColor="#2a6fff" stopOpacity="0.3" />
          <stop offset="1" stopColor="#2a6fff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <rect width="800" height="300" fill="url(#wk1s-bg)" />
      {[100, 200, 300, 400, 500, 600, 700].map((x) => (
        <line key={`v${x}`} x1={x} y1="0" x2={x} y2="300" stroke="rgba(42,111,255,0.06)" />
      ))}
      {[60, 120, 180, 240].map((y) => (
        <line key={`h${y}`} x1="0" y1={y} x2="800" y2={y} stroke="rgba(42,111,255,0.06)" />
      ))}
      <circle cx="400" cy="120" r="70" fill="none" stroke="rgba(42,111,255,0.2)" strokeWidth="2" />
      <circle cx="400" cy="120" r="58" fill="rgba(42,111,255,0.04)" />
      <text x="400" y="84" textAnchor="middle" fill="#5a9fff" fontFamily="system-ui, sans-serif" fontWeight="700" fontSize="11">1:00</text>
      <text x="454" y="124" textAnchor="middle" fill="#5a9fff" fontFamily="system-ui, sans-serif" fontWeight="700" fontSize="11">4:25</text>
      <text x="400" y="168" textAnchor="middle" fill="#ffd866" fontFamily="system-ui, sans-serif" fontWeight="700" fontSize="11">SNF</text>
      <text x="346" y="124" textAnchor="middle" fill="#ff8c42" fontFamily="system-ui, sans-serif" fontWeight="700" fontSize="11">MNF</text>
      <line x1="400" y1="120" x2="400" y2="92" stroke="#5a9fff" strokeWidth="2" strokeLinecap="round" />
      <line x1="400" y1="120" x2="428" y2="120" stroke="#5a9fff" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="400" cy="120" r="4" fill="#5a9fff" />
      {[{ x: 60, w: 80 }, { x: 180, w: 70 }, { x: 550, w: 80 }, { x: 670, w: 70 }].map(({ x, w }) => (
        <path key={`st${x}`} d={`M${x} 155 Q${x + w / 2} 125 ${x + w} 155`} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="1.5" />
      ))}
      {[80, 200, 600, 720].map((x) => (
        <React.Fragment key={`lt${x}`}>
          <rect x={x - 2} y="100" width="4" height="55" fill="rgba(255,255,255,0.06)" />
          <circle cx={x} cy="98" r="4" fill="#ffd866" opacity="0.35" />
        </React.Fragment>
      ))}
      {Array.from({ length: 14 }, (_, i) => (
        <circle
          key={`dot${i}`}
          cx={218 + i * 26}
          cy="198"
          r="4"
          fill={i < 8 ? '#5a9fff' : i < 12 ? '#8b5cf6' : i < 13 ? '#ffd866' : '#ff8c42'}
          opacity="0.6"
        />
      ))}
      <rect x="60" y="218" width="680" height="64" rx="12" fill="rgba(3,12,30,0.85)" />
      <text x="400" y="246" textAnchor="middle" fill="#ffffff" fontFamily="system-ui, sans-serif" fontWeight="850" fontSize="22" letterSpacing="1">WEEK 1 FULL SLATE</text>
      <text x="400" y="268" textAnchor="middle" fill="#8badc9" fontFamily="system-ui, sans-serif" fontWeight="600" fontSize="12" letterSpacing="3">14 GAMES &middot; EVERY START/SIT &middot; D/ST &middot; IDP &middot; SLEEPERS</text>
    </Box>
  );
}

const S = ({ children }) => <strong>{children}</strong>;

const Body = () => {
  const [tab, setTab] = useState(0);
  return (
    <>
      <HeroBanner />

      <Lead>
        Fourteen games. Four time slots. Every start/sit call you need for Sunday and Monday of
        Week 1. Use the tabs below to jump between the early window, late window, primetime, and
        the cross-game boards covering D/ST rankings, IDP streamers, sleeper picks, and the
        11:30 ET inactives checklist.
      </Lead>

      <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 3, mt: 4 }}>
        <Tabs
          value={tab}
          onChange={(_, v) => setTab(v)}
          variant="scrollable"
          scrollButtons="auto"
          allowScrollButtonsMobile
          aria-label="Game time slots"
        >
          <Tab label="1:00 ET" />
          <Tab label="Late Window" />
          <Tab label="Primetime" />
          <Tab label="Boards" />
        </Tabs>
      </Box>

      {/* ================================================================ */}
      {/* TAB 0 : SUNDAY 1:00 ET                                          */}
      {/* ================================================================ */}
      {tab === 0 && (
        <>
          <H2>Bears at Panthers</H2>
          <P>
            CHI &minus;2.5, O/U 47.5. Charlotte, clear, mid-80s. <S>Rome Odunze</S> is Questionable
            (calf); if he sits, <S>Luther Burden</S> slides to WR1 and <S>Kalif Raymond</S> enters
            three-wide sets. Carolina RT <S>Taylor Moton</S> is on NFI with rookie <S>Monroe
            Freeling</S> starting. <S>Patrick Jones II</S> (CAR) is OUT.
          </P>
          <Table aria-label="Bears at Panthers start/sit">
            <THead>
              <TR><TH scope="col">Player</TH><TH scope="col">Pos</TH><TH scope="col">Call</TH><TH scope="col">Key Factor</TH></TR>
            </THead>
            <TBody>
              <TR><TD><S>Colston Loveland</S></TD><TD>TE</TD><TD>Start (TE1 stream)</TD><TD>Best TE stream on the slate; CAR allowed 1,109 yds/7 TDs to TEs</TD></TR>
              <TR><TD><S>D&apos;Andre Swift</S></TD><TD>RB</TD><TD>Start (RB2)</TD><TD>Solid volume</TD></TR>
              <TR><TD><S>Chuba Hubbard</S></TD><TD>RB</TD><TD>Start (RB2)</TD><TD>Lead back, Brooks cleared but unproven</TD></TR>
              <TR><TD><S>Tetairoa McMillan</S></TD><TD>WR</TD><TD>Start (WR2)</TD><TD>CHI 26th in pass pts allowed, 2nd-most 20+ yd plays</TD></TR>
              <TR><TD><S>Rome Odunze</S></TD><TD>WR</TD><TD>Start (WR2 if active)</TD><TD>Questionable calf</TD></TR>
              <TR><TD><S>Caleb Williams</S></TD><TD>QB</TD><TD>Start (mid-QB1)</TD><TD>47.5 O/U, new staff caveat</TD></TR>
              <TR><TD><S>Bryce Young</S></TD><TD>QB</TD><TD>Sit (QB2)</TD><TD>Low ceiling</TD></TR>
              <TR><TD><S>Xavier Legette</S></TD><TD>WR</TD><TD>Hold</TD><TD>Wait for target share to develop</TD></TR>
              <TR><TD><S>Jonathon Brooks</S></TD><TD>RB</TD><TD>Hold</TD><TD>Cleared but unproven behind Hubbard</TD></TR>
            </TBody>
          </Table>
          <P>
            <strong>Sleeper:</strong> <S>Burden</S> as a WR2, especially if <S>Odunze</S> sits.
            <strong> D/ST:</strong> Neither.
            <strong> IDP:</strong> Rookie S <S>Dillon Thieneman</S> (CHI) for tackles. <S>Jaelan Phillips</S> (CAR) is a waiver edge add.
          </P>

          <H2>Buccaneers at Bengals</H2>
          <P>
            CIN &minus;3.5, O/U 50.5. Cincinnati, clear. <S>Jalen McMillan</S> (TB) Doubtful (knee),
            <S> Sean Tucker</S> (TB) Questionable (hamstring), <S>DJ Turner</S> (CIN) Questionable
            (hamstring), <S>Shemar Stewart</S> (CIN) Doubtful. <S>Mike Evans</S> is off the Tampa
            roster entirely, concentrating targets on <S>Chris Godwin</S> and <S>Emeka Egbuka</S>.
          </P>
          <Table aria-label="Buccaneers at Bengals start/sit">
            <THead>
              <TR><TH scope="col">Player</TH><TH scope="col">Pos</TH><TH scope="col">Call</TH><TH scope="col">Key Factor</TH></TR>
            </THead>
            <TBody>
              <TR><TD><S>Joe Burrow</S></TD><TD>QB</TD><TD>Start (QB1)</TD><TD>50.5 O/U, elite weapons</TD></TR>
              <TR><TD><S>Ja&apos;Marr Chase</S></TD><TD>WR</TD><TD>Start (WR1)</TD><TD>Locked in</TD></TR>
              <TR><TD><S>Tee Higgins</S></TD><TD>WR</TD><TD>Start (WR2)</TD><TD>50.5 total, full go</TD></TR>
              <TR><TD><S>Chase Brown</S></TD><TD>RB</TD><TD>Start (RB1)</TD><TD>CIN lead back in a shootout</TD></TR>
              <TR><TD><S>Baker Mayfield</S></TD><TD>QB</TD><TD>Start (QB1)</TD><TD>Highest total on the slate</TD></TR>
              <TR><TD><S>Emeka Egbuka</S></TD><TD>WR</TD><TD>Start (WR2)</TD><TD>Evans gone, target concentration</TD></TR>
              <TR><TD><S>Chris Godwin</S></TD><TD>WR</TD><TD>Start (WR2)</TD><TD>PPR magnet with Evans gone</TD></TR>
              <TR><TD><S>Bucky Irving</S></TD><TD>RB</TD><TD>Start (RB1)</TD><TD>CIN was 32nd in rush yds allowed; rebuilt front tempers ceiling</TD></TR>
              <TR><TD><S>Cade Otton</S></TD><TD>TE</TD><TD>Start (top-12 TE)</TD><TD>17.6 PPR/gm allowed to TEs</TD></TR>
              <TR><TD><S>Mike Gesicki</S></TD><TD>TE</TD><TD>Sit (TE2)</TD><TD>Behind Otton in pecking order</TD></TR>
              <TR><TD><S>Kenneth Gainwell</S></TD><TD>RB</TD><TD>Sit</TD><TD>Bench-only unless Irving is a surprise inactive</TD></TR>
            </TBody>
          </Table>
          <P>
            <strong>Sleeper:</strong> <S>Otton</S> as a top-12 TE play; <S>Egbuka</S> as a deep-league WR2 with Evans gone and Turner hobbled.
            <strong> D/ST:</strong> Avoid both.
            <strong> IDP:</strong> <S>Tykee Smith</S> (TB S) against a 64% pass-rate offense. Tampa rookies <S>Rueben Bain</S> (edge) and <S>Josiah Trotter</S> (ILB) are tackle-format adds.
          </P>

          <H2>Saints at Lions</H2>
          <P>
            DET &minus;7, O/U 48.5. Ford Field dome. <S>Alvin Kamara</S> is Questionable (knee, first
            Wednesday practice since 8/18) and listed as RB2 behind <S>Travis Etienne</S> on the depth
            chart. <S>Cam Jordan</S> (NO) is OUT. <S>Jordyn Tyson</S> (NO WR) is on IR. Detroit
            safeties <S>Kerby Joseph</S> and <S>Brian Branch</S> are on PUP; <S>Terrion Arnold</S> was
            released.
          </P>
          <Table aria-label="Saints at Lions start/sit">
            <THead>
              <TR><TH scope="col">Player</TH><TH scope="col">Pos</TH><TH scope="col">Call</TH><TH scope="col">Key Factor</TH></TR>
            </THead>
            <TBody>
              <TR><TD><S>Chris Olave</S></TD><TD>WR</TD><TD>Start (WR1)</TD><TD>Must-start against a stripped secondary</TD></TR>
              <TR><TD><S>Travis Etienne</S></TD><TD>RB</TD><TD>Start (RB2)</TD><TD>Volume; flex if Kamara plays</TD></TR>
              <TR><TD><S>Jahmyr Gibbs</S></TD><TD>RB</TD><TD>Start (RB1)</TD><TD>Locked in</TD></TR>
              <TR><TD><S>Amon-Ra St. Brown</S></TD><TD>WR</TD><TD>Start (WR1)</TD><TD>Locked in</TD></TR>
              <TR><TD><S>Sam LaPorta</S></TD><TD>TE</TD><TD>Start (TE1)</TD><TD>Locked in</TD></TR>
              <TR><TD><S>Jared Goff</S></TD><TD>QB</TD><TD>Start (QB1)</TD><TD>Locked in</TD></TR>
              <TR><TD><S>Tyler Shough</S></TD><TD>QB</TD><TD>Start (QB1 stream)</TD><TD>Ceiling play; DET sacked him 4+ times in 4 of 7 starts</TD></TR>
              <TR><TD><S>Alvin Kamara</S></TD><TD>RB</TD><TD>Risky RB3 if active</TD><TD>First practice since 8/18, RB2 on depth chart</TD></TR>
              <TR><TD><S>Jameson Williams</S></TD><TD>WR</TD><TD>Sit (WR3)</TD><TD>New OC Drew Petzing, target tree invisible</TD></TR>
            </TBody>
          </Table>
          <P>
            <strong>Sleeper:</strong> <S>Devaughn Vele</S> (4% rostered) is the No. 3 receiver with Tyson on IR and caught 16 of 19 targets over Weeks 13-15 with Shough. <S>Juwan Johnson</S> is a TE1 in this game environment.
            <strong> D/ST:</strong> Lions are fourth on the board.
            <strong> IDP:</strong> <S>Chase Young</S> (NO edge) had 10 sacks in a 12-game stretch last year.
          </P>

          <H2>Bills at Texans</H2>
          <P>
            BUF &minus;1.5, O/U 44.5. NRG dome. <S>Will Anderson Jr.</S> (HOU) did not practice,
            injury unspecified, no designation. <S>Ray Davis</S> and <S>Ty Johnson</S> (BUF)
            Questionable. <S>Tank Dell</S> (HOU) is on IR.
          </P>
          <Table aria-label="Bills at Texans start/sit">
            <THead>
              <TR><TH scope="col">Player</TH><TH scope="col">Pos</TH><TH scope="col">Call</TH><TH scope="col">Key Factor</TH></TR>
            </THead>
            <TBody>
              <TR><TD><S>Josh Allen</S></TD><TD>QB</TD><TD>Start (QB1)</TD><TD>Not top-three; HOU&apos;s pass rush added Clowney</TD></TR>
              <TR><TD><S>James Cook</S></TD><TD>RB</TD><TD>Start (RB1)</TD><TD>BUF had 30 rushing TDs last year</TD></TR>
              <TR><TD><S>Nico Collins</S></TD><TD>WR</TD><TD>Start (WR1)</TD><TD>Top target in HOU offense</TD></TR>
              <TR><TD><S>David Montgomery</S></TD><TD>RB</TD><TD>Start (RB2)</TD><TD>Woody Marks takes passing downs</TD></TR>
              <TR><TD><S>Khalil Shakir</S></TD><TD>WR</TD><TD>Start (WR3 PPR)</TD><TD>Volume in the slot</TD></TR>
              <TR><TD><S>C.J. Stroud</S></TD><TD>QB</TD><TD>Sit (QB2)</TD><TD>BUF pass defense under new DC Jim Leonhard</TD></TR>
              <TR><TD><S>DJ Moore</S></TD><TD>WR</TD><TD>Sit (WR3)</TD><TD>First game in a new offense</TD></TR>
              <TR><TD><S>Keon Coleman</S></TD><TD>WR</TD><TD>Sit</TD><TD>Bench</TD></TR>
              <TR><TD><S>Dalton Kincaid</S></TD><TD>TE</TD><TD>Sit (TE2)</TD><TD>Modest total; higher target ceiling than Schultz</TD></TR>
            </TBody>
          </Table>
          <P>
            <strong>Sleeper:</strong> <S>Woody Marks</S> in PPR if Buffalo pulls ahead.
            <strong> D/ST:</strong> Texans are playable if Anderson is active; sit them if he is not.
            <strong> IDP:</strong> <S>Azeez Al-Shaair</S> (HOU) is a weekly LB1 in tackle formats.
          </P>

          <H2>Ravens at Colts</H2>
          <P>
            BAL &minus;3.5, O/U 47.5. Lucas Oil dome. <S>Alec Pierce</S> (IND) Questionable (heel),
            trending to play. <S>Zay Flowers</S> is off the report. <S>Nnamdi Madubuike</S> and
            <S> Teddye Buchanan</S> (BAL) Questionable. <S>Devontez Walker</S> (BAL) Questionable.
          </P>
          <Table aria-label="Ravens at Colts start/sit">
            <THead>
              <TR><TH scope="col">Player</TH><TH scope="col">Pos</TH><TH scope="col">Call</TH><TH scope="col">Key Factor</TH></TR>
            </THead>
            <TBody>
              <TR><TD><S>Lamar Jackson</S></TD><TD>QB</TD><TD>Start (QB1)</TD><TD>Rushing capped by top-10 IND run D</TD></TR>
              <TR><TD><S>Jonathan Taylor</S></TD><TD>RB</TD><TD>Start (RB1)</TD><TD>Projects 4+ catches against Weaver&apos;s zone</TD></TR>
              <TR><TD><S>Derrick Henry</S></TD><TD>RB</TD><TD>Start (RB1)</TD><TD>Locked in</TD></TR>
              <TR><TD><S>Zay Flowers</S></TD><TD>WR</TD><TD>Start (WR2)</TD><TD>Healthy; IND added Gardner and Ward</TD></TR>
              <TR><TD><S>Mark Andrews</S></TD><TD>TE</TD><TD>Start (TE1)</TD><TD>Red zone volume pushed inside by new corners</TD></TR>
              <TR><TD><S>Keenan Allen</S></TD><TD>WR</TD><TD>Start (PPR WR3)</TD><TD>Listed WR1 in IND, PPR floor</TD></TR>
              <TR><TD><S>Tyler Warren</S></TD><TD>TE</TD><TD>Start (TE1)</TD><TD>Volume target in BAL</TD></TR>
              <TR><TD><S>Rashod Bateman</S></TD><TD>WR</TD><TD>Sit</TD><TD>Bench against Gardner and Ward</TD></TR>
              <TR><TD><S>Daniel Jones</S></TD><TD>QB</TD><TD>Sit (QB2)</TD><TD>Wait until he shows something</TD></TR>
            </TBody>
          </Table>
          <P>
            <strong>Sleeper:</strong> <S>Josh Downs</S> in PPR: Baltimore allowed the 6th-most points to slot receivers last year. If Pierce sits, <S>Downs</S> and <S>Allen</S> both rise a tier.
            <strong> D/ST:</strong> Neither.
            <strong> IDP:</strong> <S>Sauce Gardner</S> is a DB add in big-play formats.
          </P>

          <H2>Browns at Jaguars</H2>
          <P>
            JAX &minus;7, O/U 40.5. Jacksonville, 88&#176;F, 30% showers after 2 p.m.
            <S> LeQuint Allen</S> (JAX) Questionable (hip). <S>Jakobi Meyers</S> (JAX) Questionable
            (thumb). <S>Carson Schwesinger</S> (CLE) is full go.
          </P>
          <Table aria-label="Browns at Jaguars start/sit">
            <THead>
              <TR><TH scope="col">Player</TH><TH scope="col">Pos</TH><TH scope="col">Call</TH><TH scope="col">Key Factor</TH></TR>
            </THead>
            <TBody>
              <TR><TD><S>Chris Rodriguez Jr.</S></TD><TD>RB</TD><TD>Start (RB2)</TD><TD>Volume RB2 as 7-pt home fav; RB1 volume if Allen sits</TD></TR>
              <TR><TD><S>Brian Thomas Jr.</S></TD><TD>WR</TD><TD>Start (WR2)</TD><TD>Top weapon in JAX offense</TD></TR>
              <TR><TD><S>Brenton Strange</S></TD><TD>TE</TD><TD>Start (TE stream)</TD><TD>CLE leaked to tight ends last year</TD></TR>
              <TR><TD><S>Trevor Lawrence</S></TD><TD>QB</TD><TD>Start (QB2)</TD><TD>Home favorite, clock-control script</TD></TR>
              <TR><TD><S>Quinshon Judkins</S></TD><TD>RB</TD><TD>Sit</TD><TD>JAX allowed 85.6 rush yds/gm (franchise record low)</TD></TR>
              <TR><TD><S>Deshaun Watson</S></TD><TD>QB</TD><TD>Sit</TD><TD>40th in yds/attempt, 7-pt road dog</TD></TR>
              <TR><TD><S>Jerry Jeudy</S></TD><TD>WR</TD><TD>Sit (WR3)</TD><TD>Volume only in a losing script</TD></TR>
              <TR><TD><S>Travis Hunter</S></TD><TD>WR</TD><TD>Sit</TD><TD>Behind Meyers on depth chart, bench until snap share is visible</TD></TR>
            </TBody>
          </Table>
          <P>
            <strong>Sleeper:</strong> <S>Meyers</S> in PPR if his thumb holds.
            <strong> D/ST:</strong> Jaguars are the No. 1 stream of the week, projected around 10.5 points.
            <strong> IDP:</strong> <S>Ventrell Miller</S> (JAX LB) and <S>Schwesinger</S> (CLE LB) in a game where Cleveland will be on the field a lot.
          </P>

          <H2>Falcons at Steelers</H2>
          <P>
            PIT &minus;3 to &minus;6 across books, O/U 41.5-42.5. Pittsburgh, showers 2-5 p.m.,
            storms after 5. <S>Tua Tagovailoa</S> is OUT; <S>Cooper Rush</S> starts. <S>Jawaan
            Taylor</S>, <S>Za&apos;Darius Smith</S>, <S>Kendal Daniels</S>, <S>Billy Bowman</S> (ATL)
            Questionable. <S>Joey Porter Jr.</S> (PIT) Questionable.
          </P>
          <Table aria-label="Falcons at Steelers start/sit">
            <THead>
              <TR><TH scope="col">Player</TH><TH scope="col">Pos</TH><TH scope="col">Call</TH><TH scope="col">Key Factor</TH></TR>
            </THead>
            <TBody>
              <TR><TD><S>Bijan Robinson</S></TD><TD>RB</TD><TD>Start (RB1)</TD><TD>Elite regardless of QB; gains checkdown volume with Rush</TD></TR>
              <TR><TD><S>Jaylen Warren</S></TD><TD>RB</TD><TD>Start (RB2)</TD><TD>Home favorite in weather</TD></TR>
              <TR><TD><S>DK Metcalf</S></TD><TD>WR</TD><TD>Start (WR2)</TD><TD>PIT&apos;s top receiver</TD></TR>
              <TR><TD><S>Drake London</S></TD><TD>WR</TD><TD>Start (WR2)</TD><TD>Lower ceiling under Rush</TD></TR>
              <TR><TD><S>Aaron Rodgers</S></TD><TD>QB</TD><TD>Start (QB2)</TD><TD>Functional floor at home</TD></TR>
              <TR><TD><S>Michael Pittman</S></TD><TD>WR</TD><TD>Start (PPR WR3)</TD><TD>PPR safety valve</TD></TR>
              <TR><TD><S>Kyle Pitts</S></TD><TD>TE</TD><TD>Sit (TE2 dart)</TD><TD>Suppressed by Rush at QB</TD></TR>
              <TR><TD><S>Pat Freiermuth</S></TD><TD>TE</TD><TD>Sit (TE2)</TD><TD>Low total with rain arriving</TD></TR>
            </TBody>
          </Table>
          <P>
            <strong>Sleeper:</strong> None worth chasing in a game trending under.
            <strong> D/ST:</strong> Steelers move to fourth on the board with Rush starting behind a Questionable RT.
            <strong> IDP:</strong> <S>Payton Wilson</S> (PIT) is the top LB add of the week. Drop <S>Kendal Daniels</S>.
          </P>

          <H2>Jets at Titans</H2>
          <P>
            TEN &minus;3, O/U 39.5. Nashville, 94&#176;F, no wind. <S>Cedric Gray</S> (TEN LB) is
            OUT (concussion). <S>D&apos;Angelo Ponds</S> (NYJ CB) Doubtful. <S>Kene Nwangwu</S> (NYJ)
            Doubtful.
          </P>
          <Table aria-label="Jets at Titans start/sit">
            <THead>
              <TR><TH scope="col">Player</TH><TH scope="col">Pos</TH><TH scope="col">Call</TH><TH scope="col">Key Factor</TH></TR>
            </THead>
            <TBody>
              <TR><TD><S>Tony Pollard</S></TD><TD>RB</TD><TD>Start (top-12 RB)</TD><TD>Best play in the game; NYJ allowed 20 RB TDs</TD></TR>
              <TR><TD><S>Breece Hall</S></TD><TD>RB</TD><TD>Start (RB2)</TD><TD>Improves with Gray out of TEN&apos;s middle</TD></TR>
              <TR><TD><S>Garrett Wilson</S></TD><TD>WR</TD><TD>Start (WR1)</TD><TD>Volume target</TD></TR>
              <TR><TD><S>Cam Ward</S></TD><TD>QB</TD><TD>Start (QB2)</TD><TD>Benefits from Jets corner Doubtful</TD></TR>
              <TR><TD><S>Geno Smith</S></TD><TD>QB</TD><TD>Sit (QB2)</TD><TD>52 sacks last year (behind Raiders line, not a Jets projection)</TD></TR>
              <TR><TD><S>Calvin Ridley</S></TD><TD>WR</TD><TD>Sit (WR3)</TD><TD>39.5 total suppresses ceiling</TD></TR>
              <TR><TD><S>Tyjae Spears</S></TD><TD>RB</TD><TD>Sit</TD><TD>Handcuff only</TD></TR>
              <TR><TD><S>Mason Taylor</S></TD><TD>TE</TD><TD>Sit (TE2)</TD><TD>Higher floor than Helm, low ceiling</TD></TR>
            </TBody>
          </Table>
          <P>
            <strong>Sleeper:</strong> <S>Adonai Mitchell</S> as the Jets&apos; WR2 against a bottom-five 2025 pass defense, deep leagues only.
            <strong> D/ST:</strong> Titans slide to fifth. Gray&apos;s absence hurts the run defense.
            <strong> IDP:</strong> <S>David Bailey</S> (NYJ), the No. 2 overall pick, against Tennessee&apos;s leaky tackles. <S>Kevin Winston</S> (TEN S) against Geno&apos;s league-high 2025 INT total.
          </P>
        </>
      )}

      {/* ================================================================ */}
      {/* TAB 1 : LATE WINDOW (4:25 ET)                                    */}
      {/* ================================================================ */}
      {tab === 1 && (
        <>
          <H2>Cardinals at Chargers</H2>
          <P>
            LAC &minus;11.5, O/U 45.5. SoFi, covered stadium. <S>Jeremiyah Love</S> (ARI)
            Questionable (ankle), expected to play. <S>Keaton Mitchell</S> (LAC) Questionable
            (hamstring). <S>Brenen Thompson</S> (LAC) Questionable. The line grew two points since
            the opener.
          </P>
          <Table aria-label="Cardinals at Chargers start/sit">
            <THead>
              <TR><TH scope="col">Player</TH><TH scope="col">Pos</TH><TH scope="col">Call</TH><TH scope="col">Key Factor</TH></TR>
            </THead>
            <TBody>
              <TR><TD><S>Justin Herbert</S></TD><TD>QB</TD><TD>Start (QB1)</TD><TD>Biggest favorite on the slate</TD></TR>
              <TR><TD><S>Ladd McConkey</S></TD><TD>WR</TD><TD>Start (top-10 WR)</TD><TD>Allen gone to IND, target concentration</TD></TR>
              <TR><TD><S>Omarion Hampton</S></TD><TD>RB</TD><TD>Start (RB1)</TD><TD>11.5-pt favorite, run-heavy script</TD></TR>
              <TR><TD><S>Quentin Johnston</S></TD><TD>WR</TD><TD>Start (WR3)</TD><TD>28-pt implied total</TD></TR>
              <TR><TD><S>Trey McBride</S></TD><TD>TE</TD><TD>Start (TE1)</TD><TD>Safety valve regardless of score</TD></TR>
              <TR><TD><S>Charlie Kolar</S></TD><TD>TE</TD><TD>Dart (TE2)</TD><TD>28-pt implied total upside</TD></TR>
              <TR><TD><S>Marvin Harrison Jr.</S></TD><TD>WR</TD><TD>Sit (WR3)</TD><TD>LAC allowed 7 WR TDs all year; Brissett at QB</TD></TR>
              <TR><TD><S>Jacoby Brissett</S></TD><TD>QB</TD><TD>Sit</TD><TD>Not a stream</TD></TR>
              <TR><TD><S>Jeremiyah Love</S></TD><TD>RB</TD><TD>Flex only</TD><TD>Draft capital, bad script; Allgeier volume if Love sits</TD></TR>
            </TBody>
          </Table>
          <P>
            <strong>Sleeper:</strong> <S>Keaton Mitchell</S> on passing downs if active, PPR only.
            <strong> D/ST:</strong> Chargers are the No. 2 stream.
            <strong> IDP:</strong> <S>Walter Nolen</S> (ARI DT, 15.1% pressure rate as a rookie) against rookie C <S>Jake Slaughter</S>. <S>Jack Gibbens</S> (ARI) won the LB2 job and is a tackle-format add.
          </P>

          <H2>Dolphins at Raiders</H2>
          <P>
            LV &minus;3, O/U 41.5. Allegiant dome. <S>Brock Bowers</S> (LV) is OUT (knee).
            <S> Will Kacmarek</S> (MIA TE) Questionable. <S>Ashton Jeanty</S> is off the report.
          </P>
          <Table aria-label="Dolphins at Raiders start/sit">
            <THead>
              <TR><TH scope="col">Player</TH><TH scope="col">Pos</TH><TH scope="col">Call</TH><TH scope="col">Key Factor</TH></TR>
            </THead>
            <TBody>
              <TR><TD><S>Ashton Jeanty</S></TD><TD>RB</TD><TD>Start (RB1)</TD><TD>Bellcow, off the report</TD></TR>
              <TR><TD><S>De&apos;Von Achane</S></TD><TD>RB</TD><TD>Start (RB1)</TD><TD>Volume, only Dolphin to trust</TD></TR>
              <TR><TD><S>Tre Tucker</S></TD><TD>WR</TD><TD>Start (WR3)</TD><TD>Bowers&apos; target beneficiary</TD></TR>
              <TR><TD><S>Kirk Cousins</S></TD><TD>QB</TD><TD>Sit (QB2)</TD><TD>Low ceiling</TD></TR>
              <TR><TD><S>Malik Willis</S></TD><TD>QB</TD><TD>Sit (QB2)</TD><TD>Rushing floor only</TD></TR>
              <TR><TD><S>Greg Dulcich</S></TD><TD>TE</TD><TD>Sit</TD><TD>Deep-league TE streamer only</TD></TR>
            </TBody>
          </Table>
          <P>
            <strong>Sleeper:</strong> <S>Willis</S> as a rushing-floor QB2 stream. <S>Mike Washington Jr.</S> is a stash behind <S>Jeanty</S>.
            <strong> D/ST:</strong> Raiders are a secondary stream against an 18.5 implied total.
            <strong> IDP:</strong> <S>Chop Robinson</S> (MIA edge) against an immobile <S>Cousins</S>. <S>Jacob Rodriguez</S> (MIA LB) won the job outright. <S>Quay Walker</S> (LV LB) is a tackle-format add.
          </P>

          <H2>Packers at Vikings</H2>
          <P>
            MIN &minus;1.5, O/U 44.5. U.S. Bank dome. <S>Josh Jacobs</S> (GB) is OUT
            (Commissioner&apos;s Exempt List). <S>Aaron Banks</S> and <S>Zach Bako-Bewele</S> (GB
            OL) Questionable. <S>Devonte Wyatt</S> and <S>Javon Hargrave</S> (GB DTs) Questionable.
            Total dropped two points.
          </P>
          <Table aria-label="Packers at Vikings start/sit">
            <THead>
              <TR><TH scope="col">Player</TH><TH scope="col">Pos</TH><TH scope="col">Call</TH><TH scope="col">Key Factor</TH></TR>
            </THead>
            <TBody>
              <TR><TD><S>Justin Jefferson</S></TD><TD>WR</TD><TD>Start (WR1)</TD><TD>Locked in</TD></TR>
              <TR><TD><S>T.J. Hockenson</S></TD><TD>TE</TD><TD>Start (TE1)</TD><TD>Locked in</TD></TR>
              <TR><TD><S>Kyler Murray</S></TD><TD>QB</TD><TD>Start (QB1)</TD><TD>Vikings debut, dome, dual-threat</TD></TR>
              <TR><TD><S>Tucker Kraft</S></TD><TD>TE</TD><TD>Start (TE1)</TD><TD>Safest Packer against league&apos;s highest blitz rate</TD></TR>
              <TR><TD><S>Aaron Jones</S></TD><TD>RB</TD><TD>Start (RB2)</TD><TD>MIN lead back</TD></TR>
              <TR><TD><S>Jordan Addison</S></TD><TD>WR</TD><TD>Start (WR2)</TD><TD>Upside in Murray&apos;s debut</TD></TR>
              <TR><TD><S>MarShawn Lloyd</S></TD><TD>RB</TD><TD>Start (RB2)</TD><TD>Lead back with Jacobs out</TD></TR>
              <TR><TD><S>Jordan Love</S></TD><TD>QB</TD><TD>Sit (QB2)</TD><TD>41.6% under pressure; MIN allowed league-low 32 passes of 20+ yds</TD></TR>
              <TR><TD><S>Christian Watson</S></TD><TD>WR</TD><TD>Sit (WR3)</TD><TD>Boom-or-bust behind banged-up line</TD></TR>
            </TBody>
          </Table>
          <P>
            <strong>Sleeper:</strong> <S>Matthew Golden</S> is listed ahead of <S>Jayden Reed</S> on the depth chart and available in most leagues. <S>Kaleb Johnson</S> (GB, 5% rostered) is the waiver claim behind <S>Lloyd</S>. If Banks or Bako-Bewele sit, downgrade every Packer another notch.
            <strong> D/ST:</strong> Vikings are a solid mid-tier play.
            <strong> IDP:</strong> <S>Eric Wilson</S> (MIN LB) on tackles and sacks.
          </P>

          <H2>Commanders at Eagles</H2>
          <P>
            PHI &minus;5.5, O/U 46.5. Philadelphia, 80% rain before 2 p.m., clearing by kickoff,
            damp field possible. <S>Laremy Tunsil</S> (WAS) is on IR; <S>Brandon Coleman</S> starts
            at LT. <S>Odafe Oweh</S>, <S>K&apos;Lavon Chaisson</S>, <S>Daron Payne</S> (WAS)
            Questionable. <S>Jonathan Greenard</S> (PHI) Questionable (pectoral). <S>A.J. Brown</S>
            was traded to New England in June.
          </P>
          <Table aria-label="Commanders at Eagles start/sit">
            <THead>
              <TR><TH scope="col">Player</TH><TH scope="col">Pos</TH><TH scope="col">Call</TH><TH scope="col">Key Factor</TH></TR>
            </THead>
            <TBody>
              <TR><TD><S>Jalen Hurts</S></TD><TD>QB</TD><TD>Start (QB1)</TD><TD>Locked in</TD></TR>
              <TR><TD><S>Saquon Barkley</S></TD><TD>RB</TD><TD>Start (RB1)</TD><TD>Locked in</TD></TR>
              <TR><TD><S>DeVonta Smith</S></TD><TD>WR</TD><TD>Start (WR1)</TD><TD>WR1 with Brown gone</TD></TR>
              <TR><TD><S>Dallas Goedert</S></TD><TD>TE</TD><TD>Start (TE1)</TD><TD>Vacated targets from Brown trade</TD></TR>
              <TR><TD><S>Jayden Daniels</S></TD><TD>QB</TD><TD>Start (QB1)</TD><TD>Downgrade behind patched line</TD></TR>
              <TR><TD><S>Terry McLaurin</S></TD><TD>WR</TD><TD>Start (WR2)</TD><TD>7 catches/110 yds across 2 meetings in 2025, small sample</TD></TR>
              <TR><TD><S>Stefon Diggs</S></TD><TD>WR</TD><TD>Start (PPR WR3)</TD><TD>PPR volume</TD></TR>
              <TR><TD><S>Jacory Croskey-Merritt</S></TD><TD>RB</TD><TD>Sit (RB3)</TD><TD>Underdog, White takes passing downs</TD></TR>
            </TBody>
          </Table>
          <P>
            <strong>Sleeper:</strong> <S>Dontayvion Wicks</S> is the WR3 and a flex with Brown&apos;s vacancy. Rookie <S>Makai Lemon</S> in the slot is a deep-league dart. <S>Chig Okonkwo</S> (11% rostered) is a TE2 streamer.
            <strong> D/ST:</strong> Eagles are the No. 3 stream against a line missing its LT.
            <strong> IDP:</strong> <S>Sonny Styles</S> (WAS), the No. 7 pick, should pile up tackles against a run-heavy Eagles offense.
          </P>
        </>
      )}

      {/* ================================================================ */}
      {/* TAB 2 : PRIMETIME (SNF + MNF)                                    */}
      {/* ================================================================ */}
      {tab === 2 && (
        <>
          <H2>Cowboys at Giants (SNF)</H2>
          <P>
            DAL &minus;2.5, O/U 48.5. MetLife, rain clears well before kickoff, upper 60s, light
            wind. <S>Malik Nabers</S> (NYG) Questionable (knee, ACL return; full practice). <S>Tyler
            Smith</S> (DAL LG) is on IR. <S>Ajani Cornelius</S> (DAL OT) Questionable.
          </P>
          <Table aria-label="Cowboys at Giants start/sit">
            <THead>
              <TR><TH scope="col">Player</TH><TH scope="col">Pos</TH><TH scope="col">Call</TH><TH scope="col">Key Factor</TH></TR>
            </THead>
            <TBody>
              <TR><TD><S>Dak Prescott</S></TD><TD>QB</TD><TD>Start (QB1)</TD><TD>48.5 O/U, elite weapons</TD></TR>
              <TR><TD><S>CeeDee Lamb</S></TD><TD>WR</TD><TD>Start (WR1)</TD><TD>Locked in</TD></TR>
              <TR><TD><S>George Pickens</S></TD><TD>WR</TD><TD>Start (WR2)</TD><TD>DAL&apos;s big-play threat</TD></TR>
              <TR><TD><S>Jake Ferguson</S></TD><TD>TE</TD><TD>Start (TE1)</TD><TD>High-volume target in 48.5 total</TD></TR>
              <TR><TD><S>Jaxson Dart</S></TD><TD>QB</TD><TD>Start (QB1 stream)</TD><TD>20.1 pts/gm, 9 rush TDs, 40 rush yds/gm in 12 starts last yr</TD></TR>
              <TR><TD><S>Malik Nabers</S></TD><TD>WR</TD><TD>Start (WR1 if active)</TD><TD>Full practice, ACL return</TD></TR>
              <TR><TD><S>Cam Skattebo</S></TD><TD>RB</TD><TD>Start (RB2)</TD><TD>NYG lead back</TD></TR>
              <TR><TD><S>Javonte Williams</S></TD><TD>RB</TD><TD>Start (RB2)</TD><TD>Line missing LG Smith</TD></TR>
              <TR><TD><S>Najee Harris</S></TD><TD>RB</TD><TD>Sit</TD><TD>Bench unless Skattebo is limited</TD></TR>
              <TR><TD><S>Darnell Mooney</S></TD><TD>WR</TD><TD>Sit (WR4)</TD><TD>Low target share</TD></TR>
            </TBody>
          </Table>
          <P>
            <strong>Sleeper:</strong> <S>Isaiah Likely</S> is the Giants&apos; TE1 in John Harbaugh&apos;s Ravens-import offense and a TE1 streamer. If <S>Nabers</S> sits, <S>Malachi Fields</S> and <S>Mooney</S> both rise to WR3, and <S>Likely</S> becomes the No. 2 target.
            <strong> D/ST:</strong> Neither.
            <strong> IDP:</strong> Rookie S <S>Caleb Downs</S> (DAL) is a tackle-format add. Sit <S>Tremaine Edmunds</S> (NYG) against the league&apos;s second-highest 2025 pass rate.
          </P>

          <H2>Broncos at Chiefs (MNF)</H2>
          <P>
            KC &minus;2.5, O/U 42.5. Arrowhead, around 70&#176;F at kickoff, light wind, rain not
            until after 1 a.m. <S>Patrick Mahomes</S> is off the report nine months after ACL/LCL
            surgery. <S>Justin Simmons</S> and <S>James Conner</S> (KC) Questionable. Denver has no
            listed injuries.
          </P>
          <Table aria-label="Broncos at Chiefs start/sit">
            <THead>
              <TR><TH scope="col">Player</TH><TH scope="col">Pos</TH><TH scope="col">Call</TH><TH scope="col">Key Factor</TH></TR>
            </THead>
            <TBody>
              <TR><TD><S>Kenneth Walker III</S></TD><TD>RB</TD><TD>Start (RB1)</TD><TD>First Chiefs game, lead-back volume</TD></TR>
              <TR><TD><S>Travis Kelce</S></TD><TD>TE</TD><TD>Start (TE1)</TD><TD>Volume play, not efficiency</TD></TR>
              <TR><TD><S>Rashee Rice</S></TD><TD>WR</TD><TD>Start (WR2)</TD><TD>KC&apos;s top receiving option</TD></TR>
              <TR><TD><S>Bo Nix</S></TD><TD>QB</TD><TD>Start (QB1)</TD><TD>Davis Webb calling plays, rarely takes sacks</TD></TR>
              <TR><TD><S>J.K. Dobbins</S></TD><TD>RB</TD><TD>Start (RB2)</TD><TD>DEN lead back</TD></TR>
              <TR><TD><S>Courtland Sutton</S></TD><TD>WR</TD><TD>Start (WR2)</TD><TD>DEN&apos;s primary outside target</TD></TR>
              <TR><TD><S>Patrick Mahomes</S></TD><TD>QB</TD><TD>Start (mid-QB1)</TD><TD>First game back vs. DEN&apos;s No. 1 fantasy defense</TD></TR>
              <TR><TD><S>Xavier Worthy</S></TD><TD>WR</TD><TD>Sit (WR3)</TD><TD>DEN&apos;s corners</TD></TR>
              <TR><TD><S>R.J. Harvey</S></TD><TD>RB</TD><TD>Sit (flex only)</TD><TD>Limited standalone value</TD></TR>
            </TBody>
          </Table>
          <P>
            <strong>Sleeper:</strong> <S>Jaylen Waddle</S>, traded from Miami in March, is a WR3 with upside in a Payton offense. <S>Evan Engram</S> is a TE2 streamer.
            <strong> D/ST:</strong> Broncos are a fine start against a rusty <S>Mahomes</S> but rostered everywhere (not a stream). Chiefs are an avoid because <S>Nix</S> rarely takes sacks.
          </P>
        </>
      )}

      {/* ================================================================ */}
      {/* TAB 3 : CROSS-GAME BOARDS                                       */}
      {/* ================================================================ */}
      {tab === 3 && (
        <>
          <H2>D/ST Rankings</H2>
          <P>
            Streaming tiers for Week 1. Avoid anything facing Cincinnati or Tampa Bay.
          </P>
          <Table aria-label="D/ST rankings">
            <THead>
              <TR><TH scope="col">Rank</TH><TH scope="col">D/ST</TH><TH scope="col">Opponent</TH><TH scope="col">Note</TH></TR>
            </THead>
            <TBody>
              <TR><TD>1</TD><TD>Jaguars</TD><TD>vs CLE</TD><TD>Projected around 10.5 pts</TD></TR>
              <TR><TD>2</TD><TD>Chargers</TD><TD>vs ARI</TD><TD>11.5-pt favorite, Brissett at QB</TD></TR>
              <TR><TD>3</TD><TD>Eagles</TD><TD>vs WAS</TD><TD>Line missing LT Tunsil</TD></TR>
              <TR><TD>4</TD><TD>Steelers</TD><TD>vs ATL</TD><TD>Rush starting, Questionable RT</TD></TR>
              <TR><TD>5</TD><TD>Lions</TD><TD>vs NO</TD><TD>7-pt favorite, dome</TD></TR>
              <TR><TD>6</TD><TD>Titans</TD><TD>vs NYJ</TD><TD>Gray absence hurts; NBC dissent</TD></TR>
              <TR><TD>7</TD><TD>Vikings</TD><TD>vs GB</TD><TD>Solid mid-tier, banged-up GB line</TD></TR>
              <TR><TD>8</TD><TD>Raiders</TD><TD>vs MIA</TD><TD>18.5 implied total for MIA</TD></TR>
              <TR><TD>9</TD><TD>Texans</TD><TD>vs BUF</TD><TD>Only if Anderson is active</TD></TR>
            </TBody>
          </Table>

          <H2>IDP Board</H2>
          <P>
            Tiered by position for leagues that start individual defensive players.
          </P>
          <Table aria-label="IDP board">
            <THead>
              <TR><TH scope="col">Tier</TH><TH scope="col">Player</TH><TH scope="col">Team</TH><TH scope="col">Why</TH></TR>
            </THead>
            <TBody>
              <TR><TD>Edge</TD><TD><S>Chase Young</S></TD><TD>NO</TD><TD>10 sacks in a 12-game stretch last year</TD></TR>
              <TR><TD>Edge</TD><TD><S>Chop Robinson</S></TD><TD>MIA</TD><TD>Immobile Cousins</TD></TR>
              <TR><TD>Edge</TD><TD><S>Walter Nolen</S></TD><TD>ARI</TD><TD>Interior, 15.1% pressure rate as a rookie</TD></TR>
              <TR><TD>Edge</TD><TD><S>David Bailey</S></TD><TD>NYJ</TD><TD>No. 2 overall pick vs TEN tackles</TD></TR>
              <TR><TD>LB</TD><TD><S>Sonny Styles</S></TD><TD>WAS</TD><TD>No. 7 pick vs run-heavy PHI</TD></TR>
              <TR><TD>LB</TD><TD><S>Jacob Rodriguez</S></TD><TD>MIA</TD><TD>Won the job outright</TD></TR>
              <TR><TD>LB</TD><TD><S>Eric Wilson</S></TD><TD>MIN</TD><TD>Tackles and sacks</TD></TR>
              <TR><TD>LB</TD><TD><S>Azeez Al-Shaair</S></TD><TD>HOU</TD><TD>Weekly LB1 in tackle formats</TD></TR>
              <TR><TD>LB</TD><TD><S>Payton Wilson</S></TD><TD>PIT</TD><TD>Top LB add of the week</TD></TR>
              <TR><TD>LB</TD><TD><S>Ventrell Miller</S></TD><TD>JAX</TD><TD>CLE will be on the field a lot</TD></TR>
              <TR><TD>LB</TD><TD><S>Jack Gibbens</S></TD><TD>ARI</TD><TD>Won LB2 job, tackle-format add</TD></TR>
              <TR><TD>LB</TD><TD><S>Quay Walker</S></TD><TD>LV</TD><TD>Tackle-format add in new home</TD></TR>
              <TR><TD>LB</TD><TD><S>Jaelan Phillips</S></TD><TD>CAR</TD><TD>Waiver edge add</TD></TR>
              <TR><TD>DB</TD><TD><S>Tykee Smith</S></TD><TD>TB</TD><TD>64% pass-rate offense in CIN</TD></TR>
              <TR><TD>DB</TD><TD><S>Kevin Winston</S></TD><TD>TEN</TD><TD>Geno&apos;s league-high INT total</TD></TR>
              <TR><TD>DB</TD><TD><S>Dillon Thieneman</S></TD><TD>CHI</TD><TD>Rookie S, tackle volume</TD></TR>
              <TR><TD>DB</TD><TD><S>Caleb Downs</S></TD><TD>DAL</TD><TD>Rookie S, tackle-format add</TD></TR>
              <TR><TD>DB</TD><TD><S>Andrew Wingard</S></TD><TD>ARI</TD><TD>Tackling safety</TD></TR>
            </TBody>
          </Table>
          <P>
            <strong>Sits:</strong> <S>Tremaine Edmunds</S> (NYG) against the league&apos;s second-highest pass rate. <S>Josh Sweat</S> (ARI) after missing camp.
            <strong> Drop:</strong> <S>Kendal Daniels</S> (ATL).
          </P>

          <H2>Top Sleepers by Roster Rate</H2>
          <Table aria-label="Top sleepers">
            <THead>
              <TR><TH scope="col">Player</TH><TH scope="col">Pos</TH><TH scope="col">Team</TH><TH scope="col">Rostered</TH><TH scope="col">Why</TH></TR>
            </THead>
            <TBody>
              <TR><TD><S>Devaughn Vele</S></TD><TD>WR</TD><TD>NO</TD><TD>4%</TD><TD>No. 3 WR with Tyson on IR; 16/19 targets Wk 13-15 with Shough</TD></TR>
              <TR><TD><S>Kaleb Johnson</S></TD><TD>RB</TD><TD>GB</TD><TD>5%</TD><TD>Waiver claim behind Lloyd with Jacobs out</TD></TR>
              <TR><TD><S>Chig Okonkwo</S></TD><TD>TE</TD><TD>WAS</TD><TD>11%</TD><TD>TE2 streamer in a 46.5 total</TD></TR>
              <TR><TD><S>Tre Tucker</S></TD><TD>WR</TD><TD>LV</TD><TD>15%</TD><TD>Bowers out, target beneficiary</TD></TR>
              <TR><TD><S>Keaton Mitchell</S></TD><TD>RB</TD><TD>LAC</TD><TD>17%</TD><TD>Passing-down work if active</TD></TR>
              <TR><TD><S>Malik Willis</S></TD><TD>QB</TD><TD>MIA</TD><TD>17%</TD><TD>Rushing-floor QB2 stream</TD></TR>
              <TR><TD><S>Tyler Shough</S></TD><TD>QB</TD><TD>NO</TD><TD>23%</TD><TD>QB1 streamer in a dome vs stripped DET secondary</TD></TR>
              <TR><TD><S>Colston Loveland</S></TD><TD>TE</TD><TD>CHI</TD><TD>-</TD><TD>Best TE stream, CAR leaked to TEs</TD></TR>
              <TR><TD><S>Matthew Golden</S></TD><TD>WR</TD><TD>GB</TD><TD>-</TD><TD>Listed ahead of Reed on depth chart</TD></TR>
              <TR><TD><S>Josh Downs</S></TD><TD>WR</TD><TD>IND</TD><TD>-</TD><TD>Slot vs BAL, 6th-most pts to slot WRs</TD></TR>
              <TR><TD><S>Isaiah Likely</S></TD><TD>TE</TD><TD>NYG</TD><TD>-</TD><TD>TE1 in Harbaugh&apos;s offense, TE1 streamer</TD></TR>
              <TR><TD><S>Jaxson Dart</S></TD><TD>QB</TD><TD>NYG</TD><TD>-</TD><TD>QB1 stream: 20.1 pts/gm, 9 rush TDs in 12 starts</TD></TR>
              <TR><TD><S>Cade Otton</S></TD><TD>TE</TD><TD>TB</TD><TD>-</TD><TD>Top-12 TE in highest-total game</TD></TR>
              <TR><TD><S>Brenton Strange</S></TD><TD>TE</TD><TD>JAX</TD><TD>-</TD><TD>CLE leaked to TEs</TD></TR>
            </TBody>
          </Table>

          <H2>Pre-Kickoff Inactives Checklist</H2>
          <P>
            Check these names at 11:30 ET Sunday when inactive lists drop. Each one shifts a start/sit
            call or a D/ST ranking if the status changes.
          </P>
          <UL>
            <LI><S>Alvin Kamara</S> (NO) - if OUT, <S>Etienne</S> locks in as RB2; if active, risky RB3</LI>
            <LI><S>Rome Odunze</S> (CHI) - if OUT, <S>Burden</S> rises to WR2 in Chicago&apos;s offense</LI>
            <LI><S>Alec Pierce</S> (IND) - if OUT, <S>Downs</S> and <S>Allen</S> both rise a tier</LI>
            <LI><S>Jeremiyah Love</S> (ARI) - if OUT, <S>Tyler Allgeier</S> is a volume flex</LI>
            <LI><S>Malik Nabers</S> (NYG) - if OUT, <S>Fields</S> and <S>Mooney</S> rise to WR3, <S>Likely</S> becomes No. 2 target</LI>
            <LI><S>LeQuint Allen</S> (JAX) - if OUT, <S>Rodriguez Jr.</S> has RB1 volume</LI>
            <LI><S>Jakobi Meyers</S> (JAX) - if OUT, <S>Hunter</S> gets a real look</LI>
            <LI><S>Keaton Mitchell</S> (LAC) - if OUT, passing-down work stays committee</LI>
            <LI><S>Aaron Banks</S> and <S>Zach Bako-Bewele</S> (GB OL) - if either sits, downgrade every Packer</LI>
            <LI><S>Will Anderson Jr.</S> (HOU) - if OUT, sit the Texans D/ST</LI>
          </UL>

          <H2>Not Covered</H2>
          <P>
            Kickers were not researched for this article. The only environmental note is that no
            venue has a wind or rain problem at kickoff. Bears coaching staff analysis and Dolphins OC
            assessment rest on single sources. Miami&apos;s 2025 defense-vs-position ranks are
            unverified.
          </P>

          <Quote>
            Set your lineups by time slot, grab the sleepers before Sunday morning waivers lock, and
            check the 11:30 ET inactive lists before you finalize. Good luck in Week 1.
          </Quote>
        </>
      )}
    </>
  );
};

export default Body;
