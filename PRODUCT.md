# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Primary: public visitors who arrive without an account to use the free tools (rankings, player profiles, the mock draft simulator, strategy guides, NFL recaps, the Weekly Darkness Report, the Waiver Wire column). The main job of the product toward them is to be useful immediately and to turn them into league creators. (Confirmed by the owner, 2026-10-14.)

Other audiences, confirmed in the repo:

- **Commissioners**: create a private league, invite a friend group, and run it with commissioner tools (`CONTEXT.md`, Commissioner; `README.md`).
- **Managers**: league members who draft, set weekly lineups, claim waivers, trade, and chat. One person may manage teams in several leagues (`CONTEXT.md`, Membership).

Users must be 13 or older (`src/components/public/pages/LegalPage.jsx`).

## Product Purpose

A free web app for running private fantasy football and NFL pick'em leagues with friends: create a league, run a live draft, manage rosters, and play weekly head-to-head matchups scored from real NFL statistics (`CONTEXT.md`, `README.md`, `public/llms.txt`). The public tools and editorial content exist so a visitor finds value before signing up.

Success is a visitor who becomes a commissioner and has friends drafting the same day ("Create a league in minutes and have your friends drafting by tonight", landing CTA).

## Positioning

Four things, all confirmed by the owner as worth protecting:

1. **Free, no paid tier.** Free to play, with no paid-entry contests, wagering, wallets, or prizes.
2. **Fantasy and pick'em together.** A league is fantasy, NFL pick'em, or both. Pick'em needs no draft and no rosters.
3. **Editorial voice.** The Weekly Darkness Report and the Waiver Wire column make opinionated, named calls that are scored afterwards.
4. **Endzone Forecast.** Its own projection engine, with written explanations of each projection and matchup.

## Operating Context

- The NFL season runs on a weekly rhythm: lineups lock at each game's Kickoff, waivers process, the Darkness Report publishes before kickoff and is scored on Tuesday, and the waiver column runs on Tuesday.
- Draft night is a live, synchronous event (snake, auction, autopick, or offline draft) with a pick clock.
- Stats come from ESPN, Tank01, and nflverse; weather from NWS.
- Push alerts reach managers outside the app.
- Installable as a lightweight PWA (`public/manifest.json`). There is no native wrapper.

## Capabilities and Constraints

- League type (fantasy, pick'em, or both) is chosen at creation and never changes.
- Waivers run by priority or FAAB. Trades are proposed, reviewed, and can be vetoed by the league. Best ball is a league mode; keepers are supported.
- Pick'em scoring is straight-up or Confidence; picks lock at each game's Kickoff.
- AI-written narratives (Recap, Matchup narrative, Projection explanation) rewrite stored templates. A Narrative never computes a number and is never a Projection; nothing a manager types is input to one (ADR 0063).
- Terminology is fixed by `CONTEXT.md`, and product copy must follow it. Key rules: shared surfaces show Team identity only, never account identifiers; "Endzone Forecast" in user copy, never "the model"; in pick'em, "Pick", never "bet", "selection", or "choice"; "Slate", not "schedule"; an Editorial call is a judgment, not a Projection and not Start/sit advice; "Locked" is not a synonym for "Draft-frozen".
- Must never claim: wagering, betting, prizes, or paid entry; NFL affiliation or endorsement; that projections, rankings, or injury information are guaranteed or real-time.
- Data retention follows `docs/production/retention-policy.md` (chat 730 days, notifications 365 days).
- Open: the operator privacy contact must be published before public launch (`LegalPage.jsx`).
- Open: the landing CTA says "build your dynasty", but there is no dynasty league type.

## Brand Commitments

- Name: "Endzone Empire" (two words, both capitalized). Domain: endzoneempire.gg.
- Assets: `public/logo180.png`, `public/logo192.png`, `public/logo512.png`, `public/favicon.ico`, `public/og-brand-gradient.png` and `.svg`, `public/endzone.jpeg`.
- Voice: no em dashes in user-visible copy (ADR 0016).
- Design tokens live in `src/theme/tokens.js`, the single source of truth for the visual system.

## Evidence on Hand

- Real content: the Weekly Darkness Report and its scored calls (`docs/editorial/`), weekly waiver targets, public rankings and player profiles, and 2026 preseason research (`docs/research/`).
- Absent, and must not be invented: testimonials, user or league counts, press quotes, customer logos, and product screenshots for marketing.

## Product Principles

1. **Value before signup.** A visitor gets something useful (a ranking, a mock draft, a call) without an account, and the path to creating a league is always one step away.
2. **One league, two games.** Fantasy and pick'em are equals. Never present pick'em as a lesser mode.
3. **Opinions are labeled and accountable.** Editorial calls are clearly judgments, kept separate from Endzone Forecast numbers, and scored in public.
4. **Free means free.** No surface implies money changes hands, nothing is ever upsold, and nothing reads like gambling.
5. **The glossary is the contract.** Copy uses `CONTEXT.md` terms exactly.

## Accessibility & Inclusion

No formal WCAG conformance target has been set (owner decision, 2026-10-14). Existing rules stay binding: token contrast tests (`src/theme/contrast.test.js`, `src/theme/tokens.contrast.test.js`), the shared reduced-motion decision, polite live regions (ADR 0028), explicit heading levels (ADR 0021), and the Draft room accessibility acceptance tests (`tests/e2e/draft-accessibility.spec.ts`).
