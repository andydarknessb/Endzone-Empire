import React from 'react';
import {
  Lead, P, H2, H3, UL, LI,
  Table, THead, TBody, TR, TH, TD,
} from '../../components/public/kit/Prose';

// Body only: the frontmatter lives in week2-waiver-wire-priority-board.meta.js so listings can be
// built without loading this prose; content/articles/index.js loads it on demand.
const Body = () => (
  <>
    <Lead>
      Week 1 is in the books. Some of you watched Jalen Coker torch Atlanta for 138 yards and two
      touchdowns and thought, &quot;I should&apos;ve had him.&quot; Some of you watched A.J. Brown crumple into
      a high-ankle sprain and thought worse things. Both of those reactions lead to the same place: the
      waiver wire, Wednesday morning, with a budget that doesn&apos;t replenish.
    </Lead>
    <P>Here&apos;s how to spend it. Every bid below is a percentage of a $100 FAAB budget.</P>

    <H2>The Board</H2>
    <Table aria-labelledby="the-board">
      <THead>
        <TR>
          <TH scope="col">#</TH><TH scope="col">Player</TH><TH scope="col">Pos</TH><TH scope="col">Team</TH><TH scope="col">Why now</TH><TH scope="col">FAAB</TH>
        </TR>
      </THead>
      <TBody>
        <TR><TD>1</TD><TD><strong>Jalen Coker</strong></TD><TD>WR</TD><TD>CAR</TD><TD>8/9 for 138 and 2 TD. Bryce Young&apos;s clear WR1. Schedule: ATL, CLE, DET.</TD><TD>25&ndash;35%</TD></TR>
        <TR><TD>2</TD><TD><strong>Isaiah Likely</strong></TD><TD>TE</TD><TD>NYG</TD><TD>8/8 for 78 and 2 TD as Jaxon Dart&apos;s top target. MNF at LAR next.</TD><TD>15&ndash;25%</TD></TR>
        <TR><TD>3</TD><TD><strong>Romeo Doubs</strong></TD><TD>WR</TD><TD>NE</TD><TD>A.J. Brown (high-ankle sprain) on IR, out 4+ games. 76% route share. vs PIT.</TD><TD>15&ndash;25%</TD></TR>
        <TR><TD>4</TD><TD><strong>Devaughn Vele</strong></TD><TD>WR</TD><TD>NO</TD><TD>7/9 for 69 and a TD on 82 of 90 snaps. Jordyn Tyson on IR. at BAL.</TD><TD>10&ndash;15%</TD></TR>
        <TR><TD>5</TD><TD><strong>Caleb Douglas</strong></TD><TD>WR</TD><TD>MIA</TD><TD>Rookie. 5/7 for 94, 86% routes, 26% target share. at SF is tough.</TD><TD>10&ndash;15%</TD></TR>
        <TR><TD>6</TD><TD><strong>Bryce Young</strong></TD><TD>QB</TD><TD>CAR</TD><TD>361 yds, 4 total TD. ATL lost three pass rushers. Best 3-week QB schedule.</TD><TD>8&ndash;12%</TD></TR>
        <TR><TD>7</TD><TD><strong>Tyler Allgeier</strong></TD><TD>RB</TD><TD>ARI</TD><TD>17 carries to Love&apos;s 11. Love (ankle) did play, scored. vs SEA.</TD><TD>8&ndash;12%</TD></TR>
        <TR><TD>8</TD><TD><strong>Kaelon Black</strong></TD><TD>RB</TD><TD>SF</TD><TD>14 for 65, 44% snaps behind McCaffrey. Best handcuff on the wire. vs MIA.</TD><TD>5&ndash;15%</TD></TR>
        <TR><TD>9</TD><TD><strong>Kendre Miller</strong></TD><TD>RB</TD><TD>NO</TD><TD>9 for 30 and a TD with Kamara out. Kamara expected back Wk2 &mdash; stash only.</TD><TD>3&ndash;5%</TD></TR>
        <TR><TD>10</TD><TD><strong>Woody Marks</strong></TD><TD>RB</TD><TD>HOU</TD><TD>9 for 42, snaps split 40/39 with Montgomery. More standalone than a pure cuff.</TD><TD>5&ndash;8%</TD></TR>
      </TBody>
    </Table>
    <P>
      <strong>Rhamondre Stevenson check:</strong> if he&apos;s somehow unrostered in your league, slot him at
      rank 4. He handled 18 carries and 6 targets with TreVeyon Henderson (ankle) out and gets Pittsburgh
      at home.
    </P>

    <H2>Running Back</H2>
    <P>
      The wire is thin at the top. Black and Allgeier are the only two with weekly flex paths, and both
      live inside committees. Beyond the board:
    </P>
    <H3>Speculative stash</H3>
    <P>
      <strong>Sione Vaki</strong> (DET) &mdash; RB2 behind Gibbs with Pacheco on IR roughly 12 weeks, but only
      3 touches so far. <strong>Kyle Monangai</strong> (CHI) &mdash; 10 for 100 and a TD, but Swift also
      topped 100. Real committee. <strong>Mike Washington Jr.</strong> (LV) &mdash; 7 for 41 behind Jeanty,
      39% rostered.
    </P>
    <H3>Deep league only</H3>
    <P>
      <strong>Emari Demercado</strong> (DAL) &mdash; handcuff to Javonte Williams after Malik Davis went on
      IR. <strong>Raheim Sanders</strong> (CLE) &mdash; cuff to Judkins with Dylan Sampson out with a knee.{' '}
      <strong>Kaytron Allen</strong> (WAS) &mdash; 4 late carries; Croskey-Merritt kept the job.
    </P>
    <H3>Do not add</H3>
    <P>
      <strong>Jonathon Brooks</strong> (CAR) &mdash; 13 snaps to Hubbard&apos;s 48. That&apos;s not a path.
    </P>
    <P>
      <strong>Named elsewhere, not researched in depth:</strong> Jordan Mason (MIN) and Samaje Perine
      (CIN). Check their snap counts before bidding blind.
    </P>

    <H2>Wide Receiver</H2>
    <P>
      Deepest position this week. Coker, Doubs, Vele, and Douglas are on the board. Below the cut:
    </P>
    <UL>
      <LI>
        <strong>New England&apos;s secondary Brown beneficiaries:</strong> Mack Hollins (4/5 for 51) and
        DeMario Douglas (team-high route share, PPR slot value). Prioritize Doubs first, Hollins second.
      </LI>
      <LI>
        <strong>Deebo Samuel</strong> (SF) &mdash; 6 for 48 and a TD plus rush work. Floor play if somehow
        available in your league. Rostered 49&ndash;68% depending on platform.
      </LI>
      <LI>
        <strong>Dontayvion Wicks</strong> (PHI) &mdash; 2/4 for 73 and a TD. Classic boom-bust profile as
        Hurts&apos; field-stretcher. Gets Tennessee next.
      </LI>
      <LI>
        <strong>Rashod Bateman</strong> (BAL) &mdash; led Ravens WRs in snaps but drew only 1 target. The
        volume case: Zay Flowers left with a hamstring after going 5 for 150, and Ja&apos;Kobi Lane is out
        several weeks with a wrist injury. Bateman is a bet, not a proven asset.
      </LI>
      <LI>
        <strong>Deep:</strong> Kalif Raymond (CHI, 8/9 for 84, but Odunze returns), Antonio Williams (WAS,
        4/4 for 64 and a TD), Malik Washington (MIA, 3/8 for 53), Tre&apos; Harris (LAC, only if
        McConkey&apos;s ribs keep him out).
      </LI>
    </UL>

    <H2>Tight End</H2>
    <P>
      Isaiah Likely is the one must-add at the position. He went 8/8 for 78 and 2 touchdowns in his
      Giants debut and is clearly Jaxon Dart&apos;s security blanket. Spend accordingly.
    </P>
    <H3>Week 2 streamers</H3>
    <UL>
      <LI><strong>Dalton Schultz</strong> (HOU) &mdash; 8 targets. Gets Cincinnati, which allowed the most TE fantasy points in 2025.</LI>
      <LI><strong>Mike Gesicki</strong> (CIN) &mdash; 5/7 for 78 and a TD. However, his snap-count data conflicts with a route-share report, so treat him as TD-dependent rather than volume-safe.</LI>
      <LI><strong>Michael Mayer</strong> (LV) &mdash; 6/7 for 32. Brock Bowers (meniscus) is hoped back for Week 2, so bid low.</LI>
      <LI><strong>Single-column mentions:</strong> Juwan Johnson (NO, 7 targets, at BAL) and Pat Freiermuth (PIT, 5/5 for 46 and a TD, at NE).</LI>
    </UL>

    <H2>Quarterback</H2>
    <P>
      Bryce Young is the priority add. Beyond the board: <strong>Tyler Shough</strong> (NO) threw for 410
      but draws Baltimore next, which just hung 41 on the Colts. The matchup is not soft.{' '}
      <strong>Jordan Love</strong> (GB, 387 yds) at NYJ is a fine one-week stream.
    </P>
    <P>
      <strong>Superflex:</strong> Carson Wentz (MIN) likely starts vs. Chicago with Kyler Murray still in
      concussion protocol and no update as of today. Drew Lock (SEA) may start at Arizona with Sam
      Darnold (glute) expected out. Cooper Rush started for Atlanta in Week 1 with Tua (oblique) out; the
      Week 2 starter there is unconfirmed.
    </P>

    <H2>Defense &amp; Kicker</H2>
    <H3>D/ST, in priority order</H3>
    <P>
      <strong>SF vs MIA</strong> (10% rostered, Malik Willis at QB) &mdash; best unit on the wire.{' '}
      <strong>CIN at HOU</strong> (4 sacks, 4 forced fumbles in the opener). <strong>TB vs CLE</strong>{' '}
      (Browns were shut out for 37 minutes). <strong>KC vs IND</strong> (&minus;6.5 spread, Daniel Jones threw
      for 166 with a pick).
    </P>
    <H3>Kickers</H3>
    <P>
      Tyler Bass (BUF vs DET, total 53.5), Eddy Pineiro (SF vs MIA), Cam Little (JAX at DEN), Spencer
      Shrader (IND at KC), Matt Gay (LV at LAC).
    </P>
  </>
);

export default Body;
