import React from 'react';
import { Lead, P, H2, UL, LI, Quote } from '../../components/public/kit/Prose';

// Body only: the frontmatter lives in draft-by-tiers.meta.js so listings can be built
// without loading this prose; content/articles/index.js loads it on demand.
const Body = () => (
  <>
    <Lead>
      The single biggest upgrade to your draft is not a better ranking list. It is grouping those
      rankings into tiers so you can see where the real drop-offs are.
    </Lead>
    <P>
      A flat top-200 list quietly lies to you. It implies the gap between the 18th and 19th player is
      the same as the gap between the 6th and 7th. It almost never is. Talent clusters. There might be
      four running backs you would be thrilled to roster and then a steep drop to the next group.
    </P>
    <H2>How to build tiers</H2>
    <P>
      Go position by position and draw a line every time you feel a meaningful drop in comfort. Do not
      overthink the number of tiers. Three to six per position is plenty. The lines matter more than
      the order inside each tier.
    </P>
    <UL>
      <LI>Players in the same tier are roughly interchangeable. Take the one with the safer role.</LI>
      <LI>When a tier has only one player left, that player just got more valuable, and a mini-run is coming.</LI>
      <LI>If two positions have a full tier available, take the scarcer position and wait on the deep one.</LI>
    </UL>
    <H2>Using tiers live</H2>
    <P>
      On the clock, ignore the raw rank for a moment and ask a simpler question: how many players are
      left in this tier, and will any survive to my next pick? If a tier is about to empty and it is
      your last realistic shot at it, that is your reach signal. If the tier is deep, you can address a
      different need and circle back.
    </P>
    <Quote>
      Reach for the last player in a tier, never for the first player in the next one.
    </Quote>
    <P>
      This is also the antidote to panic. When someone two picks ahead of you grabs a running back, a
      flat list screams that you are falling behind. Your tier sheet calmly shows three more backs of
      the same quality still on the board. You make a better pick because you are reacting to scarcity,
      not to other people&apos;s nerves.
    </P>
  </>
);

export default Body;
