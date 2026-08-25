import React from 'react';
import { Box } from '@mui/material';
import {
  Lead, P, H2, H3, Quote,
  Table, THead, TBody, TR, TH, TD,
} from '../../components/public/kit/Prose';

/* ---------- inline hero banner ---------- */
function HeroBanner() {
  return (
    <Box
      component="svg"
      viewBox="0 0 800 220"
      xmlns="http://www.w3.org/2000/svg"
      sx={{
        width: '100%',
        borderRadius: 'var(--radius-md, 12px)',
        overflow: 'hidden',
        mb: 4,
        display: 'block',
      }}
      role="img"
      aria-label="NFL Preseason Week 1 Recap banner"
    >
      {/* field */}
      <rect width="800" height="220" fill="#1a472a" />
      <rect x="0" y="0" width="65" height="220" fill="#0f2d1a" />
      <rect x="735" y="0" width="65" height="220" fill="#0f2d1a" />
      {/* yard lines */}
      {[130, 200, 270, 340, 400, 460, 530, 600, 670].map((x) => (
        <line key={x} x1={x} y1="0" x2={x} y2="220" stroke="rgba(255,255,255,0.12)" strokeWidth="1" />
      ))}
      {/* hash marks */}
      {[130, 200, 270, 340, 400, 460, 530, 600, 670].map((x) => (
        <React.Fragment key={`h-${x}`}>
          <line x1={x} y1="70" x2={x} y2="80" stroke="rgba(255,255,255,0.25)" strokeWidth="2" />
          <line x1={x} y1="140" x2={x} y2="150" stroke="rgba(255,255,255,0.25)" strokeWidth="2" />
        </React.Fragment>
      ))}
      {/* endzone text */}
      <text x="32" y="130" textAnchor="middle" fill="rgba(255,255,255,0.08)" fontFamily="system-ui, sans-serif" fontWeight="900" fontSize="28" transform="rotate(-90 32 130)" letterSpacing="6">ENDZONE</text>
      <text x="768" y="90" textAnchor="middle" fill="rgba(255,255,255,0.08)" fontFamily="system-ui, sans-serif" fontWeight="900" fontSize="28" transform="rotate(90 768 90)" letterSpacing="6">EMPIRE</text>
      {/* 50 yard marker */}
      <circle cx="400" cy="110" r="28" fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="2" />
      <text x="400" y="117" textAnchor="middle" fill="rgba(255,255,255,0.15)" fontFamily="system-ui, sans-serif" fontWeight="800" fontSize="22">50</text>
      {/* football icon */}
      <ellipse cx="400" cy="60" rx="30" ry="18" fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="1.5" />
      <line x1="385" y1="60" x2="415" y2="60" stroke="rgba(255,255,255,0.2)" strokeWidth="1" />
      <line x1="392" y1="50" x2="392" y2="70" stroke="rgba(255,255,255,0.15)" strokeWidth="0.8" />
      <line x1="400" y1="48" x2="400" y2="72" stroke="rgba(255,255,255,0.15)" strokeWidth="0.8" />
      <line x1="408" y1="50" x2="408" y2="70" stroke="rgba(255,255,255,0.15)" strokeWidth="0.8" />
      {/* title */}
      <text x="400" y="145" textAnchor="middle" fill="white" fontFamily="system-ui, sans-serif" fontWeight="800" fontSize="34" letterSpacing="1">PRESEASON WEEK 1</text>
      <text x="400" y="178" textAnchor="middle" fill="rgba(255,255,255,0.7)" fontFamily="system-ui, sans-serif" fontWeight="600" fontSize="16" letterSpacing="3">FANTASY FOOTBALL STOCK WATCH</text>
      {/* accent line */}
      <rect x="310" y="190" width="180" height="3" rx="1.5" fill="rgba(255,255,255,0.3)" />
    </Box>
  );
}

/* ---------- score row helper ---------- */
const W = ({ children }) => <strong>{children}</strong>;

// Body only: the frontmatter lives in preseason-week-1-recap.meta.js so listings can be built
// without loading this prose; content/articles/index.js loads it on demand.
const Body = () => (
  <>
    <HeroBanner />

    <Lead>
      Football is back. Sixteen preseason openers hit the field this weekend and, while the
      starters mostly watched from the sideline with clipboards, there was plenty to chew on for
      fantasy managers sharpening their draft boards. Here is the full rundown: every score, every
      riser, every red flag from Week 1 of the 2026 NFL preseason.
    </Lead>

    {/* ---- SCOREBOARD ---- */}
    <H2>The Scoreboard</H2>
    {/* "the-scoreboard" is H2's own auto-slug of this heading's text
        (headingId() in Prose.jsx) rather than an explicit id prop, so it
        must track the heading text above exactly - same pattern already
        used in preseason-week-2-recap.jsx. */}
    <Table aria-labelledby="the-scoreboard">
      <THead>
        <TR><TH>Away</TH><TH>Score</TH><TH>Home</TH><TH>Score</TH></TR>
      </THead>
      <TBody>
        <TR><TD>Panthers</TD><TD>14</TD><TD><W>Bills</W></TD><TD><W>29</W></TD></TR>
        <TR><TD>Browns</TD><TD>10</TD><TD><W>Bears</W></TD><TD><W>34</W></TD></TR>
        <TR><TD><W>Vikings</W></TD><TD><W>13</W></TD><TD>Giants</TD><TD>10</TD></TR>
        <TR><TD><W>Jaguars</W></TD><TD><W>24</W></TD><TD>Saints</TD><TD>20</TD></TR>
        <TR><TD><W>Rams</W></TD><TD><W>20</W></TD><TD>Chiefs</TD><TD>12</TD></TR>
        <TR><TD>Eagles</TD><TD>7</TD><TD><W>Ravens</W></TD><TD><W>24</W></TD></TR>
        <TR><TD><W>Cowboys</W></TD><TD><W>17</W></TD><TD>Seahawks</TD><TD>7</TD></TR>
        <TR><TD><W>Broncos</W></TD><TD><W>27</W></TD><TD>Falcons</TD><TD>7</TD></TR>
        <TR><TD>Dolphins</TD><TD>7</TD><TD><W>Commanders</W></TD><TD><W>20</W></TD></TR>
        <TR><TD><W>Buccaneers</W></TD><TD><W>24</W></TD><TD>Jets</TD><TD>16</TD></TR>
        <TR><TD>Lions</TD><TD>14</TD><TD><W>Bengals</W></TD><TD><W>16</W></TD></TR>
        <TR><TD>Packers</TD><TD>9</TD><TD><W>Steelers</W></TD><TD><W>28</W></TD></TR>
        <TR><TD>Colts</TD><TD>13</TD><TD>Patriots</TD><TD>13</TD></TR>
        <TR><TD><W>Cardinals</W></TD><TD><W>27</W></TD><TD>Raiders</TD><TD>14</TD></TR>
        <TR><TD><W>Chargers</W></TD><TD><W>27</W></TD><TD>Texans</TD><TD>7</TD></TR>
        <TR><TD><W>Titans</W></TD><TD><W>19</W></TD><TD>49ers</TD><TD>13</TD></TR>
      </TBody>
    </Table>
    <P>
      Chicago demolished Cleveland 34-10 in the most lopsided result of the weekend, while
      Baltimore dominated Philly 24-7 and Denver routed Atlanta by 20. The Colts and Patriots
      played to the only tie at 13 apiece. Tennessee handled a depleted San Francisco squad 19-13
      in a game that said more about the 49ers&apos; injury woes than the Titans&apos; offense.
    </P>

    {/* ---- RISERS ---- */}
    <H2>Fantasy Stock Risers</H2>

    <H3>De&apos;Zhaun Stribling, WR, San Francisco 49ers</H3>
    <P>
      Seven catches on eight targets for 63 yards. Those numbers pop even more when you consider
      the 49ers barely played their starters. The second-round rookie out of Ole Miss ran routes
      from both the X and slot, winning contested balls and showing the kind of route precision
      that earns early trust from a coaching staff. With Ricky Pearsall lost for the season,
      Christian Kirk dealing with a calf sprain, and George Kittle on PUP, San Francisco{' '}
      <em>needs</em> someone to step up opposite Deebo Samuel. Stribling looks ready. He jumped
      to WR59 in FantasyPros rankings after Week 1, but that feels low.
    </P>

    <H3>KC Concepcion, WR, Cleveland Browns</H3>
    <P>
      The rookie played with the first-team offense and made the most of it: three catches for 27
      yards plus a 14-yard designed rushing touchdown. He was targeted twice as often as fellow
      rookie Denzel Boston and the coaching staff is clearly scheming touches for him early. With
      Jerry Jeudy&apos;s grip on the WR1 role looking shakier by the day (more on him below),
      Concepcion could be a late-round dart worth throwing. Currently sitting around WR48, worth a
      roster spot in deeper leagues.
    </P>

    <H3>Mike Washington Jr., RB, Las Vegas Raiders</H3>
    <P>
      The fourth-round pick out of Arkansas ripped off a 53-yard run that showcased legit
      top-end speed (4.33 forty) and the ability to navigate traffic at 228 pounds. He finished
      with 6 carries for 63 yards. Washington is the clear RB2 behind Ashton Jeanty, and in an
      offense that wants to run the ball, he is a priority handcuff. If Jeanty misses any time,
      Washington becomes a waiver wire smash.
    </P>

    <H3>Drew Allar, QB, Pittsburgh Steelers</H3>
    <P>
      The third-round pick out of Penn State looked nothing like the inconsistent college passer
      that caused him to slip in the draft. Against Green Bay, Allar was composed in the pocket,
      showed improved accuracy, and executed the short-to-intermediate game without trying to do
      too much. He helped drive the Steelers to a 28-9 blowout win and had the Pittsburgh
      faithful buzzing. No immediate fantasy impact unless you are in a superflex league eyeing
      him as a deep QB3, but this is a name to monitor if the Aaron Rodgers situation shifts.
    </P>

    <H3>Kaden Wetjen, WR, Pittsburgh Steelers</H3>
    <P>
      Two catches, 79 yards, and a touchdown. Wetjen&apos;s speed translated immediately from
      NCAA return-man duties into real offensive production. His TD catch showed understanding of
      rub concepts at the NFL level. A deep sleeper worth tracking in best-ball formats.
    </P>

    <H3>Jonathon Brooks, RB, Carolina Panthers</H3>
    <P>
      Three carries for 5 yards and a catch for 9 will not wow anyone in the box score, but the
      context matters enormously. Brooks had not played a snap since tearing his ACL twice and
      missing the entire 2025 season. He looked healthy, got first-team reps, and appeared fluid
      in pass protection. With Chuba Hubbard nursing a hamstring injury (week-to-week), Brooks
      could be in line for the lead role come Week 1. His ADP is about to climb.
    </P>

    <H3>MarShawn Lloyd, RB, Green Bay Packers</H3>
    <P>
      Lloyd played all nine snaps with the starting offense and looked like a legitimate complement
      to Josh Jacobs. With Jacobs nursing a groin issue, Lloyd is getting extended first-team work.
      A solid RB2 handcuff who could have standalone flex value in the Packers&apos; run-heavy
      scheme.
    </P>

    <H3>Matthew Golden, WR, Green Bay Packers</H3>
    <P>
      The departures of Romeo Doubs and Dontayvion Wicks opened real opportunity in Green Bay&apos;s
      receiver room, and Golden is seizing it. Ranked WR50, just ahead of Jayden Reed (WR51), he
      is a priority target in the middle rounds if you believe in Jordan Love&apos;s passing
      volume.
    </P>

    {/* ---- DUDS ---- */}
    <H2>The Duds</H2>

    <H3>Tony Pollard, RB, Tennessee Titans</H3>
    <P>
      Tennessee&apos;s backfield just got muddier. Pollard played only 9 snaps with the starters
      compared to Tyjae Spears&apos; 12. He has dropped to RB34 in updated rankings, and the
      Titans appear committed to a committee. You are no longer getting a lead back at
      Pollard&apos;s ADP. You are getting a timeshare with a declining floor.
    </P>

    <H3>Cam Ward, QB, Tennessee Titans</H3>
    <P>
      The second-year signal-caller went 5-of-12 for 57 yards against the 49ers&apos; depleted
      defense. That is a rough outing for a player some drafters were targeting as a superflex
      upside play. Ward is a hold in dynasty but has zero redraft appeal right now.
    </P>

    <H3>Jerry Jeudy, WR, Cleveland Browns</H3>
    <P>
      Jeudy is supposed to be the WR1 in Cleveland, but rookies KC Concepcion and Denzel Boston
      are getting first-team burn and eating into his target share before the games even count. He
      has slid to WR62, and the trend line is not his friend. If you drafted him as a WR3/flex,
      you might be stuck with a WR4 who frustrates you weekly.
    </P>

    <H3>Isaiah Likely, TE, New York Giants</H3>
    <P>
      Likely played just 6 of 14 snaps alongside the starters, raising questions about how New
      York plans to deploy him. He remains TE11, but the usage pattern suggests the coaching
      staff may not view him as the every-down tight end fantasy managers are pricing in. Monitor
      closely in Week 2.
    </P>

    <H3>Oronde Gadsden, TE, Los Angeles Chargers</H3>
    <P>
      Gadsden was rested with the other starters while his competitors played. His stock has
      dropped to TE25, and competition for targets behind Ladd McConkey and Quentin Johnston is
      fierce. Gadsden truthers need a strong Week 2 showing.
    </P>

    {/* ---- STANDOUTS ---- */}
    <H2>Preseason Standout Performances</H2>

    <P>
      <strong>Ahmed Hassanein, EDGE, Detroit Lions:</strong> Two sacks and a forced fumble against
      Cincinnati. The sixth-round 2025 pick is back from a season-ending pec injury and looked
      like a different player. IDP leagues, take notice.
    </P>
    <P>
      <strong>Kamari Ramsey, DB, Houston Texans:</strong> The USC fifth-rounder picked off Trey
      Lance and nearly had a second interception. DeMeco Ryans&apos; defense continues to develop
      young talent.
    </P>
    <P>
      <strong>Simi Fehoko, WR, Arizona Cardinals:</strong> Scored a receiving touchdown against
      the Raiders, using his 6-3, 220-pound frame to create separation in tight spaces. He is
      establishing himself as a red-zone weapon. Unlikely to be drafted in most fantasy leagues,
      but worth filing away in deep formats.
    </P>
    <P>
      <strong>Germie Bernard, WR, Pittsburgh Steelers:</strong> Strong showing in a role that
      blurs the line between receiver and tight end. He has not overtaken Roman Wilson for the WR3
      job yet, but he is making the Steelers&apos; final roster decisions interesting.
    </P>

    {/* ---- INJURIES ---- */}
    <H2>The Injury Report</H2>
    <P>
      The preseason giveth and the preseason taketh away. Here are the injuries that matter for
      your draft boards:
    </P>
    <P>
      <strong>Jeremiyah Love, RB, Arizona Cardinals</strong> suffered a high-ankle sprain. The
      Cardinals called it &ldquo;a little sore,&rdquo; but high-ankle sprains are notoriously
      tricky. He had 11 carries for 58 yards and 3 catches for 14 before going down. He has
      slipped from RB13 to RB14 and could fall further if he misses time. Draft with caution.
    </P>
    <P>
      <strong>D.J. Moore, WR, Buffalo Bills</strong> dealt with an ankle injury described as
      &ldquo;more of a scare&rdquo; than anything major. Still, Moore owners should monitor
      practice reports this week. Any missed time would boost Keon Coleman&apos;s already-solid
      value.
    </P>
    <P>
      <strong>Chase Bisontis, OL, Arizona Cardinals</strong> tore his MCL and was carted off.
      He could miss the entire 2026 season. This does not directly affect fantasy, but
      Arizona&apos;s offensive line depth just took a major hit, and that trickles down to
      everyone in that offense: Kyler Murray, Marvin Harrison Jr., and Love included.
    </P>
    <P>
      <strong>Jamal Adams, LB, Minnesota Vikings</strong> suffered a torn quad and has been
      confirmed out for the 2026 season. Minnesota&apos;s defense takes a real step back,
      potentially boosting opposing passing attacks in division matchups.
    </P>
    <P>
      <strong>Chuba Hubbard, RB, Carolina Panthers</strong> is dealing with a hamstring injury,
      week-to-week. As noted above, this opens the door for Jonathon Brooks. If you are drafting
      in the next two weeks, Brooks&apos; ADP is going to be volatile.
    </P>

    <H3>49ers Injury Pile</H3>
    <P>
      San Francisco&apos;s training camp has been brutal. Ricky Pearsall (season-ending PCL
      surgery), Jordan James (fractured rib), Christian Kirk (calf sprain), George Kittle (PUP),
      and Christian McCaffrey (tightness) are all dealing with something. The Titans&apos; 19-13
      win was partly a product of this depleted roster. Proceed with extreme caution on mid-tier
      49ers in fantasy, but the discounts on players like Deebo Samuel and Brock Purdy could be
      worth the risk.
    </P>

    {/* ---- BOTTOM LINE ---- */}
    <H2>The Bottom Line</H2>
    <P>
      Week 1 of the preseason confirmed a few things we suspected and surfaced a few surprises we
      did not. The biggest fantasy takeaways: Stribling is real, the Tennessee backfield is a
      mess, Cleveland&apos;s rookie receivers are coming for Jeudy&apos;s job, and the 49ers&apos;
      injury situation is approaching crisis level. Draft boards should be adjusting accordingly.
    </P>
    <Quote>
      Week 2 kicks off next weekend. We will be back with the full breakdown.
    </Quote>
  </>
);

export default Body;
