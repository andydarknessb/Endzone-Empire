import React from 'react';
import { Box } from '@mui/material';
import {
  Frame, LiveChip, PixelArrow, PixelHeading, PixelWarn, Tag, TeamMark,
} from '../../../shared/ui/playselect';
import { PsAction } from '../../../shared/ui/playselect/LineupParts';
import PickWeek from '../../../features/pick-week';

// The page's own pieces, drawn from the approved boards (docs/design/league: Lineup, LineupLive, LineupPhone,
// LineupStates). Each is a presenter: LineupPage owns every read and decision.

/**
 * The page head: the dim "Lineup · {league}" line, the team avatar and the team-name pixel h1 (with the Best
 * ball and Live chips on its row), "Times in {zone}", the "League" select when the viewer has more than one
 * league, and the week picker at the right. A plain layout row, not a header element: a top-level header maps
 * to the banner landmark the app bar owns.
 */
export function LineupHead({
  leagueName, teamName, avatarUrl, avatarStaticUrl, bestBall, live, zone, compact, leagues, selectedLeagueId, onSelectLeague, weeks, week, onWeek,
}) {
  return (
    <Box
      data-testid="lineup-head"
      sx={{
        display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', gap: '16px 24px',
      }}
    >
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: { xs: '10px', sm: '12px' }, minWidth: 0, flex: { xs: '1 1 100%', md: '1 1 auto' } }}>
        <Box data-testid="lineup-league-line" sx={{ fontSize: { xs: '14px', sm: '15px' }, fontWeight: 600, color: 'var(--ps-dim)' }}>
          {leagueName ? `Lineup · ${leagueName}` : 'Lineup'}
        </Box>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: { xs: '12px', sm: '12px 16px' } }}>
          <Box data-testid="lineup-team-avatar" sx={{ display: 'inline-flex' }}>
            <TeamMark name={teamName || 'My Team'} avatarUrl={avatarUrl} avatarStaticUrl={avatarStaticUrl} size={compact ? 40 : 48} />
          </Box>
          <PixelHeading level={1}>{teamName || 'Lineup'}</PixelHeading>
          {bestBall && <Tag>Best ball</Tag>}
          {live && <LiveChip>Live</LiveChip>}
        </Box>
        <Box component="p" sx={{ m: 0, fontSize: { xs: '15px', sm: '17px' }, color: 'var(--ps-dim)' }}>{`Times in ${zone}`}</Box>
      </Box>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: '12px 16px', minWidth: 0, width: { xs: '100%', md: 'auto' } }}>
        {leagues.length > 1 && (
          <LeagueSelect leagues={leagues} value={selectedLeagueId} onChange={onSelectLeague} />
        )}
        {week != null && (
          <Box sx={{ minWidth: 0, maxWidth: '100%', width: { xs: '100%', md: '460px' }, flex: { xs: '1 1 100%', md: 'none' } }}>
            <PickWeek weeks={weeks} value={week} onChange={onWeek} fill={compact} look="playselect" allWeeks={false} />
          </Box>
        )}
      </Box>
    </Box>
  );
}

// The "League" select: a native 44px select in the kit's look (label above, a pixel chevron in a 44px cell).
function LeagueSelect({ leagues, value, onChange }) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: '6px', minWidth: 0, width: { xs: '100%', md: '240px' } }}>
      <Box component="label" htmlFor="lineup-league-select" sx={{ fontSize: '13px', fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--ps-dim)' }}>
        League
      </Box>
      <Box sx={{ position: 'relative' }}>
        <Box
          component="select"
          id="lineup-league-select"
          value={value ?? ''}
          onChange={(event) => onChange(Number(event.target.value))}
          sx={{
            boxSizing: 'border-box',
            height: '44px',
            width: '100%',
            appearance: 'none',
            borderRadius: 0,
            backgroundColor: 'var(--ps-field)',
            color: 'var(--ps-ink)',
            border: '2px solid var(--ps-dim)',
            fontFamily: 'inherit',
            fontSize: '15px',
            fontWeight: 600,
            padding: '0 56px 0 12px',
            cursor: 'pointer',
          }}
        >
          {leagues.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </Box>
        <Box
          component="span"
          aria-hidden="true"
          sx={{
            position: 'absolute', right: 0, top: 0, width: '44px', height: '44px', display: 'grid', placeItems: 'center', pointerEvents: 'none', borderLeft: '2px solid var(--ps-dim)', boxSizing: 'border-box',
          }}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M1 2h10v2H9v2H7v2H5V6H3V4H1z" fill="currentColor" /></svg>
        </Box>
      </Box>
    </Box>
  );
}

/**
 * A failed read: the 2px Danger edge, the warning pictogram and one sentence ("We could not load ...") in the
 * alert, then a ghost Retry OUTSIDE the alert's role element (a live region holds text only). `children` is
 * the server's own message when it has one, shown under the sentence.
 */
export function ErrorRow({
  testId, children, onRetry,
}) {
  return (
    <Box
      data-testid={testId}
      sx={{
        border: '2px solid var(--ps-danger)', backgroundColor: 'var(--ps-panel)', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px 12px', p: '8px 8px 8px 16px', boxSizing: 'border-box', fontSize: '15px',
      }}
    >
      <Box role="alert" sx={{ flex: '1 1 260px', display: 'flex', alignItems: 'flex-start', gap: '10px', minWidth: 0 }}>
        <PixelWarn color="var(--ps-danger)" />
        <Box component="span" sx={{ textWrap: 'pretty' }}>{children}</Box>
      </Box>
      {onRetry && <PsAction onClick={onRetry}>Retry</PsAction>}
    </Box>
  );
}

/** A one-sentence state card (draft in progress, empty roster, no leagues) with its one action, a tertiary frame. */
export function MessageCard({
  testId, text, actionLabel, to,
}) {
  return (
    <Frame component="div" tier="rule" data-testid={testId} sx={{ p: '20px', display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '14px', boxSizing: 'border-box' }}>
      <Box component="p" sx={{ m: 0, fontSize: '16px', textWrap: 'pretty' }}>{text}</Box>
      <PsAction variant="fill" to={to}>{actionLabel}</PsAction>
    </Frame>
  );
}

/** The best-ball notice: the product's sentence in a tertiary frame. */
export function BestBallNotice() {
  return (
    <Frame component="div" tier="rule" data-testid="best-ball-notice" sx={{ p: '14px 20px', fontSize: '16px', boxSizing: 'border-box' }}>
      Best ball: your best legal lineup is set automatically each week.
    </Frame>
  );
}

/** The Bench what-if offer (`?swapOut=&swapIn=`): the sentence and two ghost actions. */
export function SwapOffer({
  inName, outName, onSwap, onDismiss,
}) {
  return (
    <Box
      data-testid="lineup-swap-offer"
      role="group"
      aria-label="Bench what-if swap"
      sx={{ border: '2px solid var(--ps-frame-2)', backgroundColor: 'var(--ps-panel)', p: '8px 8px 8px 16px', display: 'flex', gap: '8px 12px', alignItems: 'center', flexWrap: 'wrap', boxSizing: 'border-box' }}
    >
      <Box sx={{ flex: '1 1 260px', fontSize: '15px', fontWeight: 600 }}>
        {`Bench what-if · Start ${inName} over ${outName}`}
      </Box>
      <PsAction onClick={onSwap}>Swap</PsAction>
      <PsAction onClick={onDismiss}>Dismiss</PsAction>
    </Box>
  );
}

/**
 * The lineup note the cursor row carries (`lineupNote`'s view, `entities/roster`): the warning pictogram, the
 * sentence with its Danger run when under an hour from the lock, and, when no bench player can fill the slot,
 * a ghost "Free agents" link. A slot a bench player CAN fill gets no link: "Set lineup" would point at this
 * page. No cursor of its own and no filled action: the row it sits in carries the page's one cursor.
 */
export function CursorNote({ view, leagueId }) {
  if (!view) return null;
  const free = view.link === 'free-agents';
  return (
    <Box
      component="section"
      data-testid="lineup-note"
      data-kind={view.kind}
      aria-label={`Lineup note: ${view.plain}`}
      sx={{
        border: '2px solid var(--ps-frame-2)', backgroundColor: 'var(--ps-panel)', color: 'var(--ps-dim)', boxSizing: 'border-box', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px 16px', p: '10px 14px', fontSize: '14px', minWidth: 0,
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: '8px', flex: '1 1 260px', minWidth: 0 }}>
        <Box component="span" sx={{ mt: '2px', display: 'inline-flex', color: view.danger ? 'var(--ps-danger)' : 'var(--ps-ink)' }}><PixelWarn /></Box>
        <Box component="span">
          {view.segments.map((seg) => (
            <Box
              key={seg.text}
              component={seg.strong ? 'b' : 'span'}
              sx={{
                ...(seg.strong ? { fontWeight: 600, color: 'var(--ps-ink)' } : null),
                ...(seg.danger ? { fontWeight: 700, color: 'var(--ps-danger)', whiteSpace: 'nowrap' } : null),
              }}
            >
              {seg.text}
            </Box>
          ))}
        </Box>
      </Box>
      {free && <PsAction to={`/league/${leagueId}/waivers`}>Free agents</PsAction>}
    </Box>
  );
}

/**
 * The phone footer's three section toggles: plain toggle buttons with `aria-pressed` (not `role="tab"`: the
 * ARIA tabs pattern is a keyboard contract this bar does not implement), in the Play-select segmented look,
 * the pressed one Play blue with the pixel arrow. `tabs` are `{ key, label, name }`; `buttonRefs` receives
 * each button for the page's focus hand-off (#1425).
 */
export function SectionToggles({
  tabs, pressed, onPress, buttonRefs,
}) {
  return (
    <Box
      role="group"
      aria-label="Lineup section"
      data-testid="lineup-mobile-tabs"
      sx={{ display: { xs: 'flex', sm: 'none' }, gap: '8px' }}
    >
      {tabs.map((tab) => {
        const on = pressed === tab.key;
        return (
          <Box
            key={tab.key}
            component="button"
            type="button"
            ref={(el) => { buttonRefs.current[tab.key] = el; }}
            aria-label={tab.name}
            aria-pressed={on}
            onClick={() => onPress(tab.key)}
            sx={{
              flex: '1 1 0',
              minHeight: '44px',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
              p: '0 8px',
              boxSizing: 'border-box',
              borderRadius: 0,
              fontFamily: 'inherit',
              fontSize: '14px',
              fontWeight: 600,
              border: `2px solid ${on ? 'var(--ps-play)' : 'var(--ps-ink)'}`,
              backgroundColor: on ? 'var(--ps-play)' : 'transparent',
              color: on ? 'var(--ps-play-ink)' : 'var(--ps-ink)',
              cursor: 'pointer',
            }}
          >
            {on ? <PixelArrow /> : null}
            {tab.label}
          </Box>
        );
      })}
    </Box>
  );
}
