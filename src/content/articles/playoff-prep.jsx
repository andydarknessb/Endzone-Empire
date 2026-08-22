import React from 'react';
import { Lead, P, H2, UL, LI, Quote } from '../../components/public/kit/Prose';

// Body only: the frontmatter lives in playoff-prep.meta.js so listings can be built
// without loading this prose; content/articles/index.js loads it on demand.
const Body = () => (
  <>
    <Lead>
      Making the playoffs and winning them are different projects. The teams that peak in December are
      usually the ones that started planning for it in November.
    </Lead>
    <H2>Read the playoff schedule early</H2>
    <P>
      Around Week 10, look ahead to your league&apos;s championship weeks and check the real NFL matchups
      your key players will face. A stud in a great Week 16 matchup is worth holding through a rough
      stretch; a borderline starter facing three elite defenses in the fantasy playoffs is a sell candidate
      while his value is still high.
    </P>
    <UL>
      <LI>Prioritize players whose Week 15–17 opponents are weak against their position.</LI>
      <LI>Beware players on teams likely to rest starters if they clinch a bye. That is a real Week 17 risk.</LI>
      <LI>Handcuff your league-winning running back before the playoffs, not after he gets hurt.</LI>
    </UL>
    <H2>Bench depth becomes king</H2>
    <P>
      One injury in Week 15 can end your season if your bench is full of dart-throws. In the weeks before
      the playoffs, trade fragile upside for boring, reliable floor at the positions you start most. You
      want starters you can trust and a bench that can survive a scratch.
    </P>
    <Quote>
      In the playoffs, the highest ceiling loses to the safest floor more often than anyone admits.
    </Quote>
    <H2>Do not over-manage the last week in</H2>
    <P>
      Once you have clinched, resist the urge to churn your roster for tiny weekly edges. Lock in your core,
      keep one flexible bench spot for a matchup-based streamer, and go into the playoffs with the team that
      got you there, a little sharper at the edges.
    </P>
  </>
);

export default Body;
