import React from 'react';
import { Lead, P, H2, UL, LI, Quote } from '../../components/public/kit/Prose';

const article = {
  slug: 'waiver-priority-vs-faab',
  title: 'Winning the Waiver Wire: Priority vs. FAAB',
  category: 'Waivers',
  excerpt: 'Two leagues, two completely different games. Here is how to spend your waiver capital in each without going broke by Week 6.',
  readMinutes: 6,
  date: '2026-07-28',
  Body: () => (
    <>
      <Lead>
        Championships are won in September and October on the waiver wire far more often than in the
        draft. But how you win depends entirely on which system your league runs.
      </Lead>
      <H2>Priority (rolling waivers)</H2>
      <P>
        In a priority system, everyone has a number. Claim a player and you drop to the back of the line.
        The whole game is deciding when a player is worth burning your spot near the front.
      </P>
      <UL>
        <LI>Protect a high priority for a true difference-maker, a lead back who just inherited a job.</LI>
        <LI>Do not spend the #1 slot on a dart-throw you would drop in two weeks.</LI>
        <LI>Late in the week, low-priority managers can still win uncontested add. Check who nobody claimed.</LI>
      </UL>
      <H2>FAAB (free-agent budget)</H2>
      <P>
        FAAB gives everyone a fixed budget (usually $100) for the season and turns every add into a blind
        auction. It rewards nerve and punishes both hoarding and panic.
      </P>
      <Quote>
        The player is worth what he does for your roster, not what he would go for in someone else&apos;s.
      </Quote>
      <P>
        Bid what a player is worth to <em>you</em>. If a starting running back would move you from
        pretender to contender, 40 to 60 percent of your remaining budget is defensible. If he is a bye-week
        patch, bid single digits and move on. The most common FAAB mistake is nibbling $2 and $3 all season
        and finishing with $70 unspent and no title.
      </P>
      <H2>A simple budgeting rule</H2>
      <P>
        Divide your season into thirds. Aim to spend roughly half your budget in the first third when
        breakout roles are still up for grabs, a third in the middle as injuries reshape the league, and
        keep a small reserve for a playoff-run streamer. Adjust for your roster, but never end the regular
        season with a fat, useless budget.
      </P>
    </>
  ),
};

export default article;
