import React from 'react';
import { Lead, P, H2, UL, LI, Quote } from '../../components/public/kit/Prose';

// Body only: the frontmatter lives in reading-trade-value.meta.js so listings can be built
// without loading this prose; content/articles/index.js loads it on demand.
const Body = () => (
  <>
    <Lead>
      The best traders in your league are not sharks. They are the managers who make deals that help
      both teams, because those are the deals that actually get accepted.
    </Lead>
    <H2>Trade from surplus, not from panic</H2>
    <P>
      Value is contextual. Your fourth good receiver is worth far less to you than a starting tight end,
      even if a ranking list says they are equal. Look at your roster for a position where you have more
      startable players than slots, and shop from that depth to fix a genuine hole.
    </P>
    <UL>
      <LI>Two solid starters for one great one usually helps the team getting the great one.</LI>
      <LI>Buy players coming off a quiet game; sell players coming off their career day.</LI>
      <LI>Bye weeks create fake urgency. Do not sell a season-long asset to patch one week.</LI>
    </UL>
    <H2>Frame the offer honestly</H2>
    <P>
      Lead with why the deal helps the other manager. &quot;You are thin at running back and I am
      overloaded. Here is a starter for your spare receiver&quot; gets a reply. A lopsided lowball just
      teaches the league not to trade with you, which quietly costs you all season.
    </P>
    <Quote>
      A trade you talked someone into regretting is a trade you will not get to make again.
    </Quote>
    <H2>Mind the schedule and the standings</H2>
    <P>
      A contender should pay a premium for a safe weekly floor heading into the playoffs. A team out of
      the race should cash win-now assets for upside and youth if your league carries over. Always sanity-check
      a deal against the playoff weeks: the points that matter are the ones scored in the games that decide it.
    </P>
  </>
);

export default Body;
