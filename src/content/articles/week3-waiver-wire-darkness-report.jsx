import React from 'react';
import {
  Lead, P, H2, H3, UL, OL, LI, Quote,
  Table, THead, TBody, TR, TH, TD,
} from '../../components/public/kit/Prose';

// Body only: the frontmatter lives in week3-waiver-wire-darkness-report.meta.js so listings can be
// built without loading this prose; content/articles/index.js loads it on demand.
const Body = () => (
  <>
    <Lead>
      Two weeks in and the league is already bleeding. Four starting quarterbacks went down, two
      Chargers tight ends broke bones on the same afternoon, and a Cleveland rookie nobody drafted has
      scored in every game he has played. Your bench is not a museum. Let&apos;s go shopping.
    </Lead>
    <P>
      Every bid below is a percentage of a $100 FAAB budget in a 12-team league. Rostered figures are
      from Yahoo and ESPN as of Wednesday morning. Waivers clear Wednesday night. Thursday is Green Bay
      hosting Atlanta.
    </P>

    <H2>The Big Five</H2>
    <H3>1. Denzel Boston, WR, Cleveland (31% rostered)</H3>
    <P>
      This is not an injury fill-in. The rookie is playing over 90% of snaps, owns 52% of
      Cleveland&apos;s air yards, and has scored in both games. He is the WR14 in PPR and he is going to
      be a WR2 all season. Everyone else on this list has a return date hanging over them. Boston does
      not. Pay up: <strong>18&ndash;25%</strong>.
    </P>
    <H3>2. Jonah Coleman, RB, Denver (26&ndash;32% rostered)</H3>
    <P>
      Dobbins pulled a hamstring, Harvey is banged up, and Coleman walked into 42% of the snaps, 13
      touches and a score. He is the best one-week play on the wire. The catch: Dobbins is only
      questionable with a mild strain. You may be buying one game. Bid like it, not like he&apos;s a
      season-long RB1: <strong>15&ndash;22%</strong>.
    </P>
    <H3>3. Dalton Schultz, TE, Houston (41&ndash;56% rostered)</H3>
    <P>
      Fourteen targets. Twelve catches. 140 yards. With Nico Collins out two weeks, Schultz became the
      entire Houston passing game and finished as the TE1. Indianapolis has been generous to tight ends.
      If you streamed a tight end last week, stop: <strong>10&ndash;15%</strong>.
    </P>
    <H3>4. Adonai Mitchell, WR, New York Jets (16% rostered)</H3>
    <P>
      Twelve targets, 178 air yards, 82% of snaps, and he split looks evenly with Garrett Wilson.
      That&apos;s not a fluke week, that&apos;s a role. At 16% rostered he is sitting there in most
      leagues. Go get him: <strong>10&ndash;14%</strong>.
    </P>
    <H3>5. Devaughn Vele, WR, New Orleans (39&ndash;51% rostered)</H3>
    <P>
      Sixteen targets through two games, 90%+ snaps, double digits both weeks. Tyler Shough is throwing
      it around and Vele is the clear second option. Boring, durable, startable. The kind of pickup
      that wins Week 11: <strong>8&ndash;12%</strong>.
    </P>

    <H2>The Full Board</H2>
    <P>
      Window is how long the role should last. Season means no return date hanging over it. A week
      with a question mark means a Friday injury report decides it.
    </P>
    <Table aria-labelledby="the-full-board">
      <THead>
        <TR>
          <TH scope="col">#</TH><TH scope="col">Player</TH><TH scope="col">Pos</TH><TH scope="col">Team</TH><TH scope="col">The case</TH><TH scope="col">Window</TH><TH scope="col">FAAB</TH><TH scope="col">Rostered</TH>
        </TR>
      </THead>
      <TBody>
        <TR><TD>1</TD><TD><strong>Denzel Boston</strong></TD><TD>WR</TD><TD>CLE</TD><TD>90%+ snaps, 52% of team air yards, TD in both games, WR14 PPR. Season-long role.</TD><TD>Season</TD><TD>18&ndash;25%</TD><TD>31%</TD></TR>
        <TR><TD>2</TD><TD><strong>Jonah Coleman</strong></TD><TD>RB</TD><TD>DEN</TD><TD>Dobbins and Harvey hurt. 42% snaps, 13 touches, TD. Dobbins questionable, mild strain.</TD><TD>1&ndash;2 wks</TD><TD>15&ndash;22%</TD><TD>26&ndash;32%</TD></TR>
        <TR><TD>3</TD><TD><strong>Dalton Schultz</strong></TD><TD>TE</TD><TD>HOU</TD><TD>14 targets, 12 for 140. Collins out two weeks. TE1 both weeks.</TD><TD>2 wks+</TD><TD>10&ndash;15%</TD><TD>41&ndash;56%</TD></TR>
        <TR><TD>4</TD><TD><strong>Adonai Mitchell</strong></TD><TD>WR</TD><TD>NYJ</TD><TD>82% snaps, 12 targets (29% share), 178 air yards. Tied Garrett Wilson in targets.</TD><TD>Season</TD><TD>10&ndash;14%</TD><TD>16%</TD></TR>
        <TR><TD>5</TD><TD><strong>Devaughn Vele</strong></TD><TD>WR</TD><TD>NO</TD><TD>90%+ snaps, 16 targets in two games, double digits both weeks. Clear WR2.</TD><TD>Season</TD><TD>8&ndash;12%</TD><TD>39&ndash;51%</TD></TR>
        <TR><TD>6</TD><TD><strong>Bryce Young</strong></TD><TD>QB</TD><TD>CAR</TD><TD>QB2 overall through two weeks, behind only Josh Allen. Gets Cleveland in Week 3.</TD><TD>Season</TD><TD>8&ndash;12%</TD><TD>30&ndash;32%</TD></TR>
        <TR><TD>7</TD><TD><strong>Oronde Gadsden II</strong></TD><TD>TE</TD><TD>LAC</TD><TD>Njoku (fibula) and Kolar (forearm) both on IR. Only TE left. 13.6 YPR, TD in Week 2.</TD><TD>Season</TD><TD>8&ndash;10%</TD><TD>6&ndash;14%</TD></TR>
        <TR><TD>8</TD><TD><strong>Tre Tucker</strong></TD><TD>WR</TD><TD>LV</TD><TD>5 for 119 and a TD as the WR1 with Bowers out. Bowers is targeting a return this week, so the window may already be closing.</TD><TD>Closing</TD><TD>3&ndash;5%</TD><TD>28%</TD></TR>
        <TR><TD>9</TD><TD><strong>Dontayvion Wicks</strong></TD><TD>WR</TD><TD>PHI</TD><TD>98% route rate, WR18 at 13.9 PPR, double digits both weeks.</TD><TD>Season</TD><TD>6&ndash;8%</TD><TD>28%</TD></TR>
        <TR><TD>10</TD><TD><strong>Emanuel Wilson</strong></TD><TD>RB</TD><TD>SEA</TD><TD>21 carries for 92 after Price (shoulder) left. Price only questionable.</TD><TD>1 wk?</TD><TD>5&ndash;8%</TD><TD>1%</TD></TR>
        <TR><TD>11</TD><TD><strong>Tank Bigsby</strong></TD><TD>RB</TD><TD>PHI</TD><TD>Barkley stinger, questionable. Out-touched Shipley 15 to 9. Pure handcuff bet.</TD><TD>1 wk?</TD><TD>5&ndash;8%</TD><TD>29%</TD></TR>
        <TR><TD>12</TD><TD><strong>Rashod Bateman</strong></TD><TD>WR</TD><TD>BAL</TD><TD>7 for 88 and a TD on 9 targets with Flowers (hamstring) out.</TD><TD>1&ndash;2 wks</TD><TD>4&ndash;6%</TD><TD>16%</TD></TR>
        <TR><TD>13</TD><TD><strong>Tyler Shough</strong></TD><TD>QB</TD><TD>NO</TD><TD>QB5 to QB8 both weeks, rushing floor, zero picks.</TD><TD>Season</TD><TD>3&ndash;5%</TD><TD>48%</TD></TR>
        <TR><TD>14</TD><TD><strong>Keon Coleman</strong></TD><TD>WR</TD><TD>BUF</TD><TD>74% snaps, led Buffalo WRs with DJ Moore (AC sprain) out. Moore questionable.</TD><TD>1 wk?</TD><TD>3&ndash;5%</TD><TD>51%</TD></TR>
        <TR><TD>15</TD><TD><strong>Parker Washington</strong></TD><TD>WR</TD><TD>JAX</TD><TD>41% target share on 80% snaps, 12 targets. Probably rostered. Check anyway.</TD><TD>Season</TD><TD>5&ndash;8%</TD><TD>n/a</TD></TR>
        <TR><TD>16</TD><TD><strong>Emmett Johnson</strong></TD><TD>RB</TD><TD>KC</TD><TD>Reid said out loud he wants to manage Walker&apos;s load. Believe him.</TD><TD>Role</TD><TD>3&ndash;5%</TD><TD>n/a</TD></TR>
        <TR><TD>17</TD><TD><strong>Keaton Mitchell</strong></TD><TD>RB</TD><TD>LAC</TD><TD>Hampton put two on the ground and has an 8% target share. Mitchell out-snapped Vidal 17 to 7 and is the pass-down back.</TD><TD>Role</TD><TD>3&ndash;5%</TD><TD>n/a</TD></TR>
        <TR><TD>18</TD><TD><strong>Woody Marks</strong></TD><TD>RB</TD><TD>HOU</TD><TD>47% snaps, 8 carries plus 6 targets. Near even split with Montgomery.</TD><TD>Role</TD><TD>3&ndash;4%</TD><TD>n/a</TD></TR>
        <TR><TD>19</TD><TD><strong>Jalen Coker</strong></TD><TD>WR</TD><TD>CAR</TD><TD>138 yards, 2 TD, 24% target share in the hottest offense nobody saw coming.</TD><TD>Role</TD><TD>3&ndash;4%</TD><TD>n/a</TD></TR>
        <TR><TD>20</TD><TD><strong>Malik Washington</strong></TD><TD>WR</TD><TD>MIA</TD><TD>13 targets, about 28% share. Miami is the lowest-scoring offense in football.</TD><TD>Role</TD><TD>2&ndash;3%</TD><TD>67%</TD></TR>
        <TR><TD>21</TD><TD><strong>Michael Mayer</strong></TD><TD>TE</TD><TD>LV</TD><TD>Bowers replacement, but Bowers is targeting this week. Void if he is active.</TD><TD>Closing</TD><TD>$1</TD><TD>n/a</TD></TR>
        <TR><TD>22</TD><TD><strong>Braelon Allen</strong></TD><TD>RB</TD><TD>NYJ</TD><TD>31% snaps, TD, passing-down work behind Hall.</TD><TD>Handcuff</TD><TD>1&ndash;2%</TD><TD>16%</TD></TR>
        <TR><TD>23</TD><TD><strong>Kaleb Johnson</strong></TD><TD>RB</TD><TD>GB</TD><TD>Led Green Bay in carries in a three-man committee.</TD><TD>Handcuff</TD><TD>1&ndash;2%</TD><TD>27%</TD></TR>
        <TR><TD>24</TD><TD><strong>Kalif Raymond</strong></TD><TD>WR</TD><TD>CHI</TD><TD>35% target share with Odunze hurt, but Caleb Williams is now out 2 to 4 weeks.</TD><TD>Capped</TD><TD>1&ndash;2%</TD><TD>n/a</TD></TR>
        <TR><TD>25</TD><TD><strong>Tyjae Spears</strong></TD><TD>RB</TD><TD>TEN</TD><TD>9 touches, more efficient than Pollard.</TD><TD>Handcuff</TD><TD>1%</TD><TD>33%</TD></TR>
        <TR><TD>26</TD><TD><strong>Alvin Kamara</strong></TD><TD>RB</TD><TD>NO</TD><TD>Six targets. PPR only.</TD><TD>PPR</TD><TD>1%</TD><TD>29%</TD></TR>
        <TR><TD>27</TD><TD><strong>Darren Waller</strong></TD><TD>TE</TD><TD>CAR</TD><TD>Two scores, 18.3 PPR. Boom or bust.</TD><TD>Stream</TD><TD>1%</TD><TD>n/a</TD></TR>
        <TR><TD>28</TD><TD><strong>Pat Freiermuth</strong></TD><TD>TE</TD><TD>PIT</TD><TD>TE11, 86% route rate, Cincinnati on deck.</TD><TD>Stream</TD><TD>1%</TD><TD>n/a</TD></TR>
        <TR><TD>29</TD><TD><strong>Marcus Mariota</strong></TD><TD>QB</TD><TD>WAS</TD><TD>Daniels (elbow) out multiple weeks. Two-QB leagues only.</TD><TD>2QB</TD><TD>0&ndash;1%</TD><TD>n/a</TD></TR>
        <TR><TD>30</TD><TD><strong>Jameis Winston</strong></TD><TD>QB</TD><TD>NYG</TD><TD>Dart (MCL) out multiple weeks. Two-QB leagues only. Bring popcorn.</TD><TD>2QB</TD><TD>0&ndash;1%</TD><TD>n/a</TD></TR>
      </TBody>
    </Table>

    <H2>D/ST Streaming Board</H2>
    <P>
      The recipe never changes: a backup quarterback, a bad offensive line, and a low implied total.
      Week 3 serves up four backups and Deshaun Watson. Seattle is the best unit but 99% rostered, so
      the real wire prize is Carolina at 7%.
    </P>
    <Table aria-labelledby="d-st-streaming-board">
      <THead>
        <TR>
          <TH scope="col">#</TH><TH scope="col">Defense</TH><TH scope="col">Proj</TH><TH scope="col">Rostered</TH><TH scope="col">Why</TH>
        </TR>
      </THead>
      <TBody>
        <TR><TD>1</TD><TD><strong>Seattle</strong> at WAS</TD><TD>7.03</TD><TD>99%</TD><TD>Mariota under center. Elite unit, turns backups into turnovers. You likely can&apos;t get them.</TD></TR>
        <TR><TD>2</TD><TD><strong>Carolina</strong> at CLE</TD><TD>6.94</TD><TD>7%</TD><TD>Five takeaways and a defensive score last week. Watson behind that line. The pickup of the week at this position.</TD></TR>
        <TR><TD>3</TD><TD><strong>Green Bay</strong> vs ATL</TD><TD>6.73</TD><TD>24%</TD><TD>Thursday night at Lambeau. Penix limping back from a knee, and the Falcons backups were a disaster last week.</TD></TR>
        <TR><TD>4</TD><TD><strong>Cincinnati</strong> at PIT</TD><TD>6.73</TD><TD>6%</TD><TD>League-leading 8 sacks through two weeks. Rodgers ate four last Sunday.</TD></TR>
        <TR><TD>5</TD><TD><strong>Kansas City</strong> at MIA</TD><TD>6.72</TD><TD>34%</TD><TD>Willis carries a league-high 13.9% sack rate. Miami&apos;s 17.5 implied total is second-lowest on the slate.</TD></TR>
        <TR><TD>6</TD><TD><strong>Detroit</strong> vs NYJ</TD><TD>6.62</TD><TD>33%</TD><TD>Geno at Ford Field. Fine, not thrilling.</TD></TR>
        <TR><TD>7</TD><TD><strong>Jacksonville</strong> vs NE</TD><TD>6.49</TD><TD>82%</TD><TD>Maye without A.J. Brown. Mostly rostered already.</TD></TR>
        <TR><TD>8</TD><TD><strong>Tennessee</strong> at NYG</TD><TD>6.42</TD><TD>4%</TD><TD>Winston starting for Dart. Chaos is a floor and a ceiling.</TD></TR>
        <TR><TD>9</TD><TD><strong>Las Vegas</strong> at NO</TD><TD>6.32</TD><TD>5%</TD><TD>Shough has been clean so far. Deep-league option only.</TD></TR>
        <TR><TD>10</TD><TD><strong>NY Giants</strong> vs TEN</TD><TD>6.32</TD><TD>4%</TD><TD>Favored by six-plus at home against a Titans quarterback situation that is not good.</TD></TR>
      </TBody>
    </Table>
    <P>
      Look-ahead: Carolina and Cincinnati both keep soft schedules into Week 4, so hold the one you win
      rather than re-streaming.
    </P>

    <H2>IDP Waiver Board</H2>
    <P>
      IDP is the last place in your league where roles are still lying around at 1% rostered. Tackle
      volume is the currency at linebacker and safety. Pressures are the currency on the line. Sacks
      are the coin flip. Draft accordingly.
    </P>
    <H3>Defensive line and edge</H3>
    <Table aria-labelledby="idp-waiver-board">
      <THead>
        <TR>
          <TH scope="col">#</TH><TH scope="col">Player</TH><TH scope="col">Pos</TH><TH scope="col">Team</TH><TH scope="col">The case</TH><TH scope="col">Week 3</TH><TH scope="col">FAAB</TH><TH scope="col">Rostered</TH>
        </TR>
      </THead>
      <TBody>
        <TR><TD>1</TD><TD><strong>David Bailey</strong></TD><TD>EDGE</TD><TD>NYJ</TD><TD>Sack in both games, forced fumble, snaps climbing past 55%. The most chased edge on the wire.</TD><TD>vs DET</TD><TD>8&ndash;10%</TD><TD>5%</TD></TR>
        <TR><TD>2</TD><TD><strong>Lukas Van Ness</strong></TD><TD>EDGE</TD><TD>GB</TD><TD>1.5 sacks, 9 pressures, 3 TFL on 70% snaps. Contract year, back-to-back sack games.</TD><TD>vs ATL</TD><TD>6&ndash;8%</TD><TD>1%</TD></TR>
        <TR><TD>3</TD><TD><strong>Jaelan Phillips</strong></TD><TD>EDGE</TD><TD>CAR</TD><TD>Sack in back-to-back weeks. DL2 with DL1 upside against Watson.</TD><TD>at CLE</TD><TD>5&ndash;7%</TD><TD>4%</TD></TR>
        <TR><TD>4</TD><TD><strong>Boye Mafe</strong></TD><TD>EDGE</TD><TD>CIN</TD><TD>7 pressures on 72% snaps. Pressure rate is the leading indicator, sacks follow.</TD><TD>at PIT</TD><TD>4&ndash;6%</TD><TD>n/a</TD></TR>
        <TR><TD>5</TD><TD><strong>Kingsley Enagbare</strong></TD><TD>EDGE</TD><TD>NYJ</TD><TD>Sack in consecutive games, 66%+ snaps. DET, CHI, CLE all allow 5+ sacks a game.</TD><TD>vs DET</TD><TD>4&ndash;6%</TD><TD>n/a</TD></TR>
        <TR><TD>6</TD><TD><strong>Mason Graham</strong></TD><TD>DT</TD><TD>CLE</TD><TD>Sack in back-to-back games. Must-add where DT is a required slot.</TD><TD>vs CAR</TD><TD>4&ndash;6%</TD><TD>3%</TD></TR>
        <TR><TD>7</TD><TD><strong>Gabe Jacas</strong></TD><TD>EDGE</TD><TD>NE</TD><TD>6 tackles, sack, INT. Snaps jumped 38% to 70%. Second-round rookie taking the job.</TD><TD>at JAX</TD><TD>3&ndash;5%</TD><TD>n/a</TD></TR>
        <TR><TD>8</TD><TD><strong>Bradley Chubb</strong></TD><TD>EDGE</TD><TD>BUF</TD><TD>Sack and TFL on managed 61% snaps. DL2 when the snaps go back up.</TD><TD>vs LAC</TD><TD>2&ndash;4%</TD><TD>1%</TD></TR>
      </TBody>
    </Table>
    <H3>Linebacker</H3>
    <Table aria-labelledby="linebacker">
      <THead>
        <TR>
          <TH scope="col">#</TH><TH scope="col">Player</TH><TH scope="col">Team</TH><TH scope="col">The case</TH><TH scope="col">Week 3</TH><TH scope="col">FAAB</TH><TH scope="col">Rostered</TH>
        </TR>
      </THead>
      <TBody>
        <TR><TD>1</TD><TD><strong>Akeem Davis-Gaither</strong></TD><TD>IND</TD><TD>22 tackles in two games despite a crowded room. LB2 with top-15 upside.</TD><TD>vs HOU</TD><TD>8&ndash;10%</TD><TD>3%</TD></TR>
        <TR><TD>2</TD><TD><strong>Derrick Barnes</strong></TD><TD>DET</TD><TD>100% snaps, sack, TFL, 6 tackles. Every-down and rushing. Add everywhere.</TD><TD>vs NYJ</TD><TD>6&ndash;8%</TD><TD>3%</TD></TR>
        <TR><TD>3</TD><TD><strong>Dee Winters</strong></TD><TD>DAL</TD><TD>11 solos, TFL, fumble recovery through two. Solid LB2.</TD><TD>vs BAL</TD><TD>5&ndash;7%</TD><TD>4%</TD></TR>
        <TR><TD>4</TD><TD><strong>Pete Werner</strong></TD><TD>NO</TD><TD>9 tackles, sack, TFL on only 53% snaps. Efficient enough to flex now.</TD><TD>vs LV</TD><TD>4&ndash;6%</TD><TD>1%</TD></TR>
        <TR><TD>5</TD><TD><strong>Christian Elliss</strong></TD><TD>NE</TD><TD>12 tackles, sack, forced fumble. Every-down next to Spillane.</TD><TD>at JAX</TD><TD>3&ndash;5%</TD><TD>1%</TD></TR>
        <TR><TD>6</TD><TD><strong>Trenton Simpson</strong></TD><TD>BAL</TD><TD>Career-high 61% snaps beside Roquan. LB29 last week in a thin market.</TD><TD>at DAL</TD><TD>3&ndash;5%</TD><TD>n/a</TD></TR>
        <TR><TD>7</TD><TD><strong>Troy Dye</strong></TD><TD>LAC</TD><TD>Double digits both weeks on part-time snaps. Bye-week filler.</TD><TD>at BUF</TD><TD>1&ndash;3%</TD><TD>n/a</TD></TR>
      </TBody>
    </Table>
    <H3>Defensive back</H3>
    <Table aria-labelledby="defensive-back">
      <THead>
        <TR>
          <TH scope="col">#</TH><TH scope="col">Player</TH><TH scope="col">Pos</TH><TH scope="col">Team</TH><TH scope="col">The case</TH><TH scope="col">Week 3</TH><TH scope="col">FAAB</TH><TH scope="col">Rostered</TH>
        </TR>
      </THead>
      <TBody>
        <TR><TD>1</TD><TD><strong>Dax Hill</strong></TD><TD>CB</TD><TD>CIN</TD><TD>10 tackles, 4 pass breakups in Week 2. DB1 production through two weeks.</TD><TD>at PIT</TD><TD>6&ndash;8%</TD><TD>4%</TD></TR>
        <TR><TD>2</TD><TD><strong>Evan Williams</strong></TD><TD>S</TD><TD>GB</TD><TD>13 solos, TFL, 2 PD through two games. Add everywhere.</TD><TD>vs ATL</TD><TD>5&ndash;7%</TD><TD>3%</TD></TR>
        <TR><TD>3</TD><TD><strong>Marques Sigle</strong></TD><TD>S</TD><TD>SF</TD><TD>15 tackles, sack, TFL. Box safety volume.</TD><TD>vs ARI</TD><TD>4&ndash;6%</TD><TD>1%</TD></TR>
        <TR><TD>4</TD><TD><strong>Jaden Hicks</strong></TD><TD>S</TD><TD>KC</TD><TD>Every-down since Week 1, age 24. The dynasty add of the week at the position.</TD><TD>at MIA</TD><TD>3&ndash;5%</TD><TD>n/a</TD></TR>
        <TR><TD>5</TD><TD><strong>Andrew Wingard</strong></TD><TD>S</TD><TD>ARI</TD><TD>8 tackles, TFL last week. DB3 with DB2 upside during byes.</TD><TD>at SF</TD><TD>2&ndash;4%</TD><TD>1%</TD></TR>
        <TR><TD>6</TD><TD><strong>Amani Hooker</strong></TD><TD>S</TD><TD>TEN</TD><TD>6 tackles, INT, PD. Gets Winston, who throws to both teams.</TD><TD>at NYG</TD><TD>2&ndash;4%</TD><TD>2%</TD></TR>
        <TR><TD>7</TD><TD><strong>Cam Lewis</strong></TD><TD>S</TD><TD>CHI</TD><TD>11 tackles, steadiest role of his career.</TD><TD>vs PHI (Mon)</TD><TD>1&ndash;3%</TD><TD>n/a</TD></TR>
      </TBody>
    </Table>
    <P>
      Tackle-heavy scoring: bump Davis-Gaither, Barnes and Sigle a tier. Big-play scoring: bump Bailey,
      Van Ness and Hill.
    </P>

    <H2>Kickers</H2>
    <UL>
      <LI><strong>Tyler Bass</strong> (BUF): 3 of 3 on field goals, 8 of 9 on extra points. Buffalo scores every drive.</LI>
      <LI><strong>Trey Smack</strong> (GB): 5 of 5 with a 59-yarder. Home, Thursday, quiet wind.</LI>
      <LI><strong>Dominic Zvada</strong> (NYG): Hasn&apos;t missed. Home and favored vs Tennessee.</LI>
    </UL>

    <H2>The Injury Ledger</H2>
    <H3>Out multiple weeks or IR</H3>
    <UL>
      <LI><strong>Caleb Williams</strong> (CHI): Grade II hamstring, 2 to 4 weeks. Raymond&apos;s ceiling just dropped.</LI>
      <LI><strong>Jayden Daniels</strong> (WAS): repeat elbow dislocation. Mariota starts.</LI>
      <LI><strong>Jaxson Dart</strong> (NYG): MCL sprain. Winston starts.</LI>
      <LI><strong>Jordan Mason</strong> (MIN): thumb, IR four weeks. Aaron Jones jumped to 81% of snaps.</LI>
      <LI><strong>Dylan Sampson</strong> (CLE): knee, IR.</LI>
      <LI><strong>Jonathon Brooks</strong> (CAR): groin, out Weeks 3 and 4. Hubbard owns the backfield.</LI>
      <LI><strong>A.J. Brown</strong> (NE): high ankle, IR 4+ weeks. Hollins and Douglas pick up the slack.</LI>
      <LI><strong>Nico Collins</strong> (HOU): Grade 1 hamstring, two weeks. Schultz feast continues.</LI>
      <LI><strong>Alec Pierce</strong> (IND) and <strong>Jayden Reed</strong> (GB): both likely IR.</LI>
      <LI><strong>Dallas Goedert</strong> (PHI): MCL, 2 to 4 weeks.</LI>
      <LI><strong>David Njoku</strong> and <strong>Charlie Kolar</strong> (LAC): fibula and forearm. Gadsden is the room.</LI>
      <LI><strong>Brock Bowers</strong> (LV): meniscus trim. Targeting a return this week at New Orleans. Tucker and Mayer go back to the bench if he suits up.</LI>
    </UL>
    <H3>Questionable for Week 3</H3>
    <UL>
      <LI><strong>J.K. Dobbins</strong> (DEN): mild hamstring. Decides Coleman&apos;s window.</LI>
      <LI><strong>Saquon Barkley</strong> (PHI): stinger. Decides Bigsby&apos;s week.</LI>
      <LI><strong>Jadarian Price</strong> (SEA): shoulder. Decides Wilson&apos;s week.</LI>
      <LI><strong>DJ Moore</strong> (BUF): Grade I AC sprain, optimistic reports.</LI>
      <LI><strong>Malik Nabers</strong> (NYG): repeat shoulder dislocation, may play in a harness.</LI>
      <LI><strong>Sam Darnold</strong> (SEA): hip, no timeline.</LI>
      <LI><strong>Mike Evans</strong> (SF): hip, expected to go.</LI>
      <LI><strong>Kyler Murray</strong> (MIN): cleared concussion protocol. Starts Week 3 vs Tampa Bay.</LI>
    </UL>

    <H2>The Darkness Doctrine</H2>
    <P>
      Every September I watch the same manager drop 40% of their budget on a running back who starts
      one game, then lose the league in December because they can&apos;t afford the tight end who
      actually matters. Waivers are not about who scored last week. They are about who will be playing
      in Week 14. Three rules, no exceptions.
    </P>
    <H3>Rule 1: Bid on roles, not box scores</H3>
    <P>
      A touchdown is a coin flip. A snap share is a contract. Boston at 90% of snaps and Gadsden as the
      last tight end standing are roles. Waller&apos;s two scores are a coin that landed heads twice. Pay
      for the contract.
    </P>
    <H3>Rule 2: Spend early, spend hard</H3>
    <P>
      FAAB is worth more in September than December. The pool of unclaimed talent shrinks every week
      and your bench needs the depth now, while byes and injuries are still ahead of you. A dollar
      unspent in Week 3 is worth about sixty cents in Week 10.
    </P>
    <H3>Rule 3: A handcuff is a lottery ticket</H3>
    <P>
      Wilson, Bigsby and Keon Coleman are all hostage to a Friday injury report. They are worth a
      ticket, never the rent. Cap those bids and let someone else overpay for one start.
    </P>

    <H2>The Budget Ladder</H2>
    <Table aria-labelledby="the-budget-ladder">
      <THead>
        <TR>
          <TH scope="col">Of remaining FAAB</TH><TH scope="col">What it buys</TH><TH scope="col">Who</TH>
        </TR>
      </THead>
      <TBody>
        <TR><TD><strong>25%</strong></TD><TD>Season-long WR2</TD><TD>Boston. This is the ceiling bid of the week and it is justified.</TD></TR>
        <TR><TD><strong>20%</strong></TD><TD>Short-window RB1</TD><TD>Coleman. Big touches, but Dobbins could be back in a week.</TD></TR>
        <TR><TD><strong>12%</strong></TD><TD>Positional edge</TD><TD>Schultz, Gadsden, Mitchell, Vele, Young. Real roles at thin positions.</TD></TR>
        <TR><TD><strong>6%</strong></TD><TD>Short rental</TD><TD>Bateman and Wicks. Tucker only if Bowers is ruled out Friday.</TD></TR>
        <TR><TD><strong>5%</strong></TD><TD>Lottery ticket</TD><TD>Wilson, Bigsby, Keon Coleman, Marks, Emmett Johnson, Keaton Mitchell.</TD></TR>
        <TR><TD><strong>$1</strong></TD><TD>Free square</TD><TD>Everything from 22 down. If you win it, fine.</TD></TR>
      </TBody>
    </Table>

    <H2>Three Kinds of Pickup</H2>
    <H3>Roles for the season</H3>
    <P>
      Boston, Mitchell, Vele, Gadsden, Wicks and Young. These are the pickups you don&apos;t drop when a
      shinier name shows up next Tuesday.
    </P>
    <H3>Injury windows</H3>
    <P>
      Coleman until Dobbins is healthy. Schultz until Collins returns, and still a TE1 in a good
      offense after that. Bateman until Flowers&apos; hamstring is right. Tucker and Mayer until Bowers
      returns, and Bowers is targeting this week, so that is the shortest window on the board. Start
      them while the window is open. Trade them the week before it closes.
    </P>
    <H3>Friday coin flips</H3>
    <P>
      Wilson if Price sits. Bigsby if Barkley sits. Keon Coleman if DJ Moore sits. Put in a conditional
      claim, cap it at 5%, and check the Friday report before you set lineups. If the starter practices
      in full, the ticket is void.
    </P>

    <H2>Who to Cut</H2>
    <H3>Drop now</H3>
    <UL>
      <LI><strong>Ray Davis</strong> (BUF): eight snaps, zero carries, zero targets. He is not the handcuff you think he is.</LI>
      <LI><strong>Caleb Douglas</strong> (MIA) and <strong>Demarcus Robinson</strong> (SF): high ankle sprains, multiple weeks, no IR slot worth spending.</LI>
      <LI><strong>Ja&apos;Kobi Lane</strong> (BAL): wrist surgery, IR.</LI>
      <LI><strong>Alec Pierce</strong> (IND) and <strong>Jayden Reed</strong> (GB): if you have no IR slot, they go. If you do, park them.</LI>
      <LI>Any kicker or defense you are not starting this week. Those are streams, not assets.</LI>
    </UL>
    <H3>Hold, do not panic</H3>
    <UL>
      <LI><strong>Omarion Hampton</strong> (LAC): two fumbles and an 8% target share is ugly. Draft capital buys him three more weeks. Keaton Mitchell is the sell-high if anyone bites.</LI>
      <LI><strong>Rashee Rice</strong> (KC): a 9% target share is a real problem. It is also the best buy-low window you will get. Send an offer.</LI>
      <LI><strong>Colston Loveland</strong> (CHI): led the tight ends in snaps and routes, three targets. The quarterback is out. Hold through the backup and re-evaluate.</LI>
      <LI><strong>Sione Vaki</strong> (DET): solidifying as the number two. Handcuff only.</LI>
    </UL>

    <H2>The Trade Angle</H2>
    <P>
      The injury-window players are worth more to your league mates than to you the week before the
      starter comes back. Bateman&apos;s line with Flowers out looks like a WR2. It is not. Tucker&apos;s
      119 yards with Bowers out looks like a breakout. It is a placeholder, and Bowers may be back this
      week. Package them now, while the box score is fresh, for something with a season-long role.
    </P>
    <P>
      On the other side, the market is punishing Rashee Rice and Omarion Hampton for two bad weeks.
      Draft capital and Andy Reid are patient. You should be too. Offer a Tier 2 pickup plus a bench
      piece and see who flinches.
    </P>
    <Quote>
      The manager who wins your league in December is the one who bought Rice in September and sold
      Bateman the same afternoon.
    </Quote>

    <H2>The Week 3 Bid Sheet</H2>
    <P>Set your claims in this sequence.</P>
    <OL>
      <LI><strong>Boston</strong> at 25%. If you miss, roll the same money to <strong>Mitchell</strong> at 14%.</LI>
      <LI><strong>Coleman</strong> at 20%. If you miss, do not chase. Take <strong>Wilson</strong> at 6% as the consolation.</LI>
      <LI><strong>Schultz</strong> at 15% if your tight end is not a top-eight name. Otherwise <strong>Gadsden</strong> at 10% as the cheaper season-long version.</LI>
      <LI><strong>Vele</strong> at 12% and <strong>Wicks</strong> at 8%. Take both if you have a bye-week hole coming.</LI>
      <LI><strong>Bryce Young</strong> at 10% only if your QB is outside the top twelve. He is a starter, not a backup.</LI>
      <LI><strong>Bateman</strong> at 6%. <strong>Tucker</strong> at 3%, and only if Bowers is ruled out Friday. Rentals. Circle the sell date.</LI>
      <LI>Conditional 5% tickets on <strong>Bigsby</strong>, <strong>Wilson</strong> and <strong>Keon Coleman</strong>, voided by a full Friday practice.</LI>
      <LI>Defense: <strong>Carolina</strong> at 3% if Seattle is gone, which it is. Fall back to Cincinnati, then Kansas City. Never more than 3% on a stream.</LI>
      <LI>IDP: <strong>Davis-Gaither</strong> and <strong>Bailey</strong> at 8% in tackle and big-play formats respectively. <strong>Barnes</strong>, <strong>Hill</strong> and <strong>Van Ness</strong> at 5%. Everything else at $1.</LI>
      <LI>$1 claims down the rest of the board.</LI>
    </OL>
    <P>
      Injury statuses are as of Wednesday. Friday&apos;s practice report decides the handcuffs. Check it
      before kickoff. Andy Darkness is a pen name and has no rooting interest, allegedly.
    </P>
  </>
);

export default Body;
