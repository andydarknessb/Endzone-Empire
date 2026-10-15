import React from 'react';
import { Box } from '@mui/material';
import {
  Lead, P, H2, H3, Quote,
  Table, THead, TBody, TR, TH, TD,
} from '../../components/public/kit/Prose';

// Body only: the frontmatter lives in week6-start-sit-darkness-report.meta.js so listings can be
// built without loading this prose; content/articles/index.js loads it on demand.
//
// Every color below the hero is a theme token, so the board, cards and chips read in light and
// dark. The hero is a dark illustration in both themes, like the Week 3 start/sit banner.
//
// Reading key (also printed in the article): usage lines read wk1/wk2/wk3/wk4/wk5. c = carries,
// t = targets, pa = pass attempts, "--" = did not play that week. Week-1 snap share is unknown
// everywhere. FPA rank: 1 = most points allowed (good matchup for the opposing position), 32 =
// fewest (tough). Weeks 1 to 5. Times are Eastern. Verdicts come from docs/editorial/week6-rulings.md.

const POS_COLOR = {
  QB: 'var(--pos-qb)', RB: 'var(--pos-rb)', WR: 'var(--pos-wr)', TE: 'var(--pos-te)',
  DEF: 'var(--pos-def)', K: 'var(--pos-k)', CB: 'var(--pos-idp)', S: 'var(--pos-idp)', LB: 'var(--pos-idp)', DL: 'var(--pos-idp)',
  DB: 'var(--pos-idp)',
};
// 'CB/DT' takes the color of its first position.
const posColor = (pos) => POS_COLOR[String(pos).split('/')[0]] || 'var(--text-muted)';

const TONE = {
  start: { label: 'Start', color: 'var(--success)' },
  flex: { label: 'Flex', color: 'var(--accent)' },
  sit: { label: 'Sit', color: 'var(--danger)' },
  watch: { label: 'Game-time decisions', color: 'var(--warning)' },
};

function HeroBanner() {
  // Yard lines and hash marks in perspective: each line sits at a depth, hash ticks scale with it.
  const depths = [0.12, 0.26, 0.42, 0.6, 0.8, 1];
  return (
    <Box
      component="svg"
      viewBox="0 0 800 300"
      xmlns="http://www.w3.org/2000/svg"
      sx={{ width: '100%', borderRadius: 'var(--radius-md, 10px)', overflow: 'hidden', mb: 4, display: 'block' }}
      role="img"
      aria-labelledby="wk6ss-hero-title wk6ss-hero-desc"
    >
      <title id="wk6ss-hero-title">Week 6 Start/Sit: The Darkness Report</title>
      <desc id="wk6ss-hero-desc">
        A night football field in perspective, with yard lines, hash marks and goalposts under a
        floodlight, and a glowing football arcing across the sky over the headline Week 6 Start/Sit.
      </desc>
      <defs>
        <linearGradient id="wk6ss-sky" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#060910" />
          <stop offset="0.55" stopColor="#0c1424" />
          <stop offset="1" stopColor="#1a0f24" />
        </linearGradient>
        <radialGradient id="wk6ss-flood" cx="0.5" cy="0.1" r="0.85">
          <stop offset="0" stopColor="#7eaaff" stopOpacity="0.34" />
          <stop offset="1" stopColor="#7eaaff" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="wk6ss-turf" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#0f3a2a" />
          <stop offset="1" stopColor="#06180f" />
        </linearGradient>
        <linearGradient id="wk6ss-trail" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="#2fd97b" stopOpacity="0" />
          <stop offset="1" stopColor="#ffd866" stopOpacity="0.95" />
        </linearGradient>
      </defs>
      <rect width="800" height="300" fill="url(#wk6ss-sky)" />
      <rect width="800" height="300" fill="url(#wk6ss-flood)" />
      <rect x="0" y="150" width="800" height="150" fill="url(#wk6ss-turf)" />
      <line x1="0" y1="150" x2="800" y2="150" stroke="rgba(126,170,255,0.35)" />
      {Array.from({ length: 9 }, (_, i) => (
        <line key={`sl${i}`} x1={400 + (i - 4) * 38} y1="150" x2={400 + (i - 4) * 150} y2="300" stroke="rgba(255,255,255,0.07)" />
      ))}
      {depths.map((d, i) => {
        const y = 150 + d * d * 150;
        const half = 40 + d * 360;
        const tick = 2 + d * 6;
        return (
          <g key={`yd${i}`}>
            <line x1={400 - half * 1.9} y1={y} x2={400 + half * 1.9} y2={y} stroke="rgba(255,255,255,0.16)" />
            {[-0.42, -0.34, 0.34, 0.42].map((k) => (
              <line key={k} x1={400 + half * k * 2} y1={y - tick} x2={400 + half * k * 2} y2={y + tick} stroke="rgba(255,255,255,0.4)" strokeWidth="1.5" />
            ))}
          </g>
        );
      })}
      <g stroke="#ffd866" strokeWidth="3" strokeLinecap="round" fill="none" opacity="0.95">
        <path d="M686 150 L686 118 M662 82 L662 118 L710 118 L710 82" />
      </g>
      <g stroke="#ffd866" strokeWidth="3" strokeLinecap="round" fill="none" opacity="0.5">
        <path d="M96 150 L96 126 M80 98 L80 126 L112 126 L112 98" />
      </g>
      <path d="M96 236 C 190 24, 420 -6, 520 96" fill="none" stroke="url(#wk6ss-trail)" strokeWidth="3" strokeLinecap="round" strokeDasharray="2 9" />
      <g transform="translate(530 104) rotate(32)">
        <ellipse rx="44" ry="25" fill="#ffd866" opacity="0.12" />
        <ellipse rx="34" ry="19" fill="#6b3416" stroke="#ff8c42" strokeWidth="2" />
        <path d="M-13 -19 Q-18 0 -13 19 M13 -19 Q18 0 13 19" fill="none" stroke="#ffffff" strokeWidth="2" opacity="0.8" />
        <line x1="-10" y1="0" x2="10" y2="0" stroke="#ffffff" strokeWidth="2" strokeLinecap="round" />
        {[-6, 0, 6].map((x) => (
          <line key={x} x1={x} y1="-4" x2={x} y2="4" stroke="#ffffff" strokeWidth="1.6" strokeLinecap="round" />
        ))}
      </g>
      <text x="400" y="34" textAnchor="middle" fill="#8badc9" fontFamily="system-ui, sans-serif" fontWeight="700" fontSize="12" letterSpacing="4">THE DARKNESS REPORT</text>
      <rect x="110" y="212" width="580" height="72" rx="14" fill="rgba(3,8,20,0.84)" stroke="rgba(126,170,255,0.25)" />
      <text x="400" y="244" textAnchor="middle" fill="#ffffff" fontFamily="system-ui, sans-serif" fontWeight="850" fontSize="24" letterSpacing="1">WEEK 6 START / SIT</text>
      <text x="400" y="268" textAnchor="middle" fill="#8badc9" fontFamily="system-ui, sans-serif" fontWeight="600" fontSize="12" letterSpacing="2">WEEK 6 | THURSDAY TO MONDAY | 14 GAMES</text>
    </Box>
  );
}

const Pill = ({ children, color }) => (
  <Box
    component="span"
    sx={{
      display: 'inline-block', minWidth: '2.6em', textAlign: 'center', px: 0.75, mr: 0.75,
      borderRadius: 'var(--radius-pill, 999px)', border: '1px solid', borderColor: color, color,
      fontSize: '0.7rem', fontWeight: 800, letterSpacing: '0.04em', lineHeight: 1.7, verticalAlign: 'middle',
    }}
  >
    {children}
  </Box>
);

const Chip = ({ children, tone = 'var(--text-muted)', soft }) => (
  <Box
    component="span"
    sx={{
      display: 'inline-block', px: 1.1, py: 0.2, borderRadius: 'var(--radius-pill, 999px)',
      bgcolor: soft ? 'var(--accent-soft)' : 'var(--surface-sunken)', color: tone, fontWeight: 800,
      fontSize: '0.75rem', letterSpacing: '0.03em',
    }}
  >
    {children}
  </Box>
);

// A callout the reader should not miss: the lines-as-of note and the legend.
const Note = ({ title, tone = 'var(--warning)', children }) => (
  <Box
    role="note"
    sx={{
      my: 3, p: 2, borderRadius: 'var(--radius-md, 10px)', bgcolor: 'var(--surface-raised)',
      border: '1px solid var(--border-subtle)', borderLeft: '5px solid', borderLeftColor: tone,
      fontSize: '0.97rem', lineHeight: 1.6,
    }}
  >
    <Box sx={{ fontSize: '0.72rem', fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase', color: tone, mb: 0.5 }}>{title}</Box>
    {children}
  </Box>
);

// Implied points for both sides as one split bar: the filled side is the favorite.
function SplitBar({ away, home, awayPts, homePts }) {
  const awayPct = (awayPts / (awayPts + homePts)) * 100;
  return (
    <Box sx={{ mt: 1.75 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-muted)', mb: 0.5, fontVariantNumeric: 'tabular-nums' }}>
        <span>{away} {awayPts}</span>
        <span>implied points</span>
        <span>{homePts} {home}</span>
      </Box>
      <Box aria-hidden="true" sx={{ display: 'flex', height: 10, borderRadius: 'var(--radius-pill, 999px)', overflow: 'hidden', bgcolor: 'var(--surface-sunken)' }}>
        <Box sx={{ width: `${awayPct}%`, bgcolor: awayPts > homePts ? 'var(--accent)' : 'var(--border-strong)' }} />
        <Box sx={{ width: '3px', bgcolor: 'var(--surface-raised)' }} />
        <Box sx={{ flex: 1, bgcolor: homePts > awayPts ? 'var(--accent)' : 'var(--border-strong)' }} />
      </Box>
    </Box>
  );
}

// 'smash' draws a badge; 'C4' links to the matching Darkness Ruling.
function Flag({ flag }) {
  if (flag === 'smash') {
    return <Box component="span" sx={{ ml: 0.75, px: 0.75, borderRadius: '4px', bgcolor: 'var(--pos-k)', color: 'var(--text-inverse)', fontSize: '0.65rem', fontWeight: 900, letterSpacing: '0.08em', verticalAlign: 'middle' }}>SMASH</Box>;
  }
  if (/^C\d+$/.test(flag || '')) {
    return (
      <Box component="a" href={`#ruling-${flag.toLowerCase()}`} sx={{ ml: 0.75, fontSize: '0.72rem', fontWeight: 800, whiteSpace: 'nowrap' }}>
        Ruling {flag}
      </Box>
    );
  }
  return null;
}

// Items are [name, position, why, rank, flag].
function CallList({ tone, items }) {
  if (!items || !items.length) return null;
  const { label, color } = TONE[tone];
  return (
    <Box sx={{ mt: 2.25 }}>
      <Box sx={{ fontSize: '0.72rem', fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase', color, mb: 0.75 }}>
        {label}
      </Box>
      <Box component="ul" sx={{ listStyle: 'none', p: '0 !important', m: '0 !important', display: 'grid', gap: 0.75 }}>
        {items.map(([name, pos, why, rank, flag]) => (
          <Box
            component="li"
            key={name}
            sx={{ m: '0 !important', pl: 1.25, py: 0.4, borderLeft: '3px solid', borderColor: color, fontSize: '0.95rem', lineHeight: 1.5, overflowWrap: 'anywhere' }}
          >
            <Pill color={posColor(pos)}>{pos}</Pill>
            <strong>{name}</strong>
            {rank ? <Box component="span" sx={{ ml: 0.75, fontSize: '0.78rem', fontWeight: 800, color: 'var(--text-muted)' }}>{rank}</Box> : null}
            <Flag flag={flag} />
            {why ? <Box component="span" sx={{ color: 'var(--text-muted)' }}> &middot; {why}</Box> : null}
          </Box>
        ))}
      </Box>
    </Box>
  );
}

function GameCard({ g }) {
  return (
    <Box
      component="section"
      aria-labelledby={`game-${g.id}`}
      sx={{
        my: 3.5, p: { xs: 2, sm: 3 }, borderRadius: 'var(--radius-md, 10px)',
        bgcolor: 'var(--surface-raised)', border: '1px solid var(--border-subtle)', boxShadow: 'var(--shadow-2, none)',
        scrollMarginTop: 92,
      }}
      id={`g-${g.id}`}
    >
      <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', justifyContent: 'space-between', columnGap: 2 }}>
        <Box component="h3" id={`game-${g.id}`} sx={{ m: '0 !important', fontSize: { xs: '1.3rem !important', sm: '1.5rem !important' } }}>
          {g.title}
        </Box>
        <Box sx={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-muted)' }}>{g.when}</Box>
      </Box>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mt: 1.25, alignItems: 'center' }}>
        <Chip soft tone="var(--accent)">{g.line}</Chip>
        <Chip>O/U {g.total}</Chip>
        {g.weather ? <Chip tone={g.rain ? 'var(--warning)' : 'var(--text-muted)'}>{g.weather}</Chip> : null}
      </Box>
      <SplitBar away={g.away} home={g.home} awayPts={g.awayPts} homePts={g.homePts} />
      <Box component="p" sx={{ mt: '16px !important', mb: '0 !important' }}>{g.read}</Box>
      <Box component="p" sx={{ mt: '8px !important', mb: '0 !important', fontSize: '0.8rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
        Matchups (FPA rank, 1 = most allowed): {g.fpa}
      </Box>
      <CallList tone="start" items={g.start} />
      <CallList tone="flex" items={g.flex} />
      <CallList tone="watch" items={g.watch} />
      <CallList tone="sit" items={g.sit} />
      {g.also ? (
        <Box component="p" sx={{ mt: '14px !important', mb: '0 !important', fontSize: '0.85rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
          <strong>Also sit:</strong> {g.also}
        </Box>
      ) : null}
    </Box>
  );
}

// Every game on one board: kickoff, line, total, weather, and both implied totals as bars on a
// shared scale (filled accent is the favorite).
function SlateBoard() {
  const max = 34;
  return (
    <Box sx={{ my: 3, display: 'grid', gap: 1.5, gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' } }}>
      {GAMES.map((g) => (
        <Box
          key={g.id}
          sx={{ p: 1.5, borderRadius: 'var(--radius-md, 10px)', bgcolor: 'var(--surface-raised)', border: '1px solid var(--border-subtle)', minWidth: 0 }}
        >
          <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', justifyContent: 'space-between', columnGap: 1 }}>
            <Box component="a" href={`#g-${g.id}`} sx={{ fontWeight: 800, fontSize: '0.95rem', color: 'var(--text-primary) !important', textDecoration: 'none !important' }}>
              {g.away} @ {g.home}
            </Box>
            <Box sx={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-muted)' }}>{g.kick} ET</Box>
          </Box>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, my: 0.9 }}>
            <Chip soft tone="var(--accent)">{g.line}</Chip>
            <Chip>O/U {g.total}</Chip>
            {g.weather ? <Chip tone={g.rain ? 'var(--warning)' : 'var(--text-muted)'}>{g.weather}</Chip> : null}
          </Box>
          <Box
            role="img"
            aria-label={`Implied points: ${g.away} ${g.awayPts}, ${g.home} ${g.homePts}`}
            sx={{ display: 'grid', rowGap: 0.5 }}
          >
            {[[g.away, g.awayPts, g.awayPts > g.homePts], [g.home, g.homePts, g.homePts > g.awayPts]].map(([team, pts, fav]) => (
              <Box key={team} aria-hidden="true" sx={{ display: 'grid', gridTemplateColumns: '2.8em 1fr 3.4em', alignItems: 'center', gap: 1, fontSize: '0.82rem' }}>
                <Box component="span" sx={{ fontWeight: 800 }}>{team}</Box>
                <Box sx={{ height: 10, borderRadius: 'var(--radius-pill, 999px)', bgcolor: 'var(--surface-sunken)', overflow: 'hidden' }}>
                  <Box sx={{ width: `${(pts / max) * 100}%`, height: '100%', bgcolor: fav ? 'var(--accent)' : 'var(--border-strong)' }} />
                </Box>
                <Box component="span" sx={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--text-muted)' }}>{pts}</Box>
              </Box>
            ))}
          </Box>
        </Box>
      ))}
    </Box>
  );
}

// Jump links to every game card. Plain anchors: the cards sit on this page.
function JumpGrid() {
  return (
    <Box component="nav" aria-label="Jump to a game" sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, my: 3 }}>
      {GAMES.map((g) => (
        <Box
          key={g.id}
          component="a"
          href={`#g-${g.id}`}
          sx={{
            px: 1.25, py: 0.4, borderRadius: 'var(--radius-pill, 999px)', border: '1px solid var(--border-subtle)',
            bgcolor: 'var(--surface-raised)', color: 'var(--text-primary) !important', textDecoration: 'none !important',
            fontSize: '0.8rem', fontWeight: 700, '&:hover': { borderColor: 'var(--accent)' },
          }}
        >
          {g.away} @ {g.home}
        </Box>
      ))}
    </Box>
  );
}

const INJ_TONE = {
  out: { label: 'OUT', color: 'var(--danger)' },
  default: { label: 'TREAT AS OUT', color: 'var(--danger)' },
  gtd: { label: 'GAME-TIME', color: 'var(--warning)' },
  likely: { label: 'LIKELY IN', color: 'var(--success)' },
  sit: { label: 'SIT EITHER WAY', color: 'var(--text-muted)' },
};

// Rows are [name, position, team, status, pivot, tone, ruling].
function InjuryGroup({ title, when, rows }) {
  return (
    <Box sx={{ my: 3 }}>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1, mb: 1 }}>
        <Box component="h3" sx={{ m: '0 !important', fontSize: '1.15rem !important' }}>{title}</Box>
        {when ? <Chip tone="var(--accent)">{when}</Chip> : null}
      </Box>
      <Box sx={{ display: 'grid', gap: 1 }}>
        {rows.map(([name, pos, team, status, pivot, tone, ruling]) => {
          const t = INJ_TONE[tone];
          return (
            <Box
              key={name}
              sx={{
                p: 1.25, borderRadius: 'var(--radius-md, 10px)', bgcolor: 'var(--surface-raised)', border: '1px solid var(--border-subtle)',
                borderLeft: '4px solid', borderLeftColor: t.color, minWidth: 0, overflowWrap: 'anywhere',
              }}
            >
              <Box sx={{ lineHeight: 1.5 }}>
                <Pill color={t.color}>{t.label}</Pill>
                <strong>{name}</strong>
                <Box component="span" sx={{ ml: 0.75, fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{pos}, {team}</Box>
                <Flag flag={ruling} />
              </Box>
              <Box sx={{ fontSize: '0.88rem', color: 'var(--text-muted)', mt: 0.4, lineHeight: 1.5 }}>{status}</Box>
              <Box sx={{ fontSize: '0.92rem', mt: 0.4, lineHeight: 1.5 }}><strong>Pivot:</strong> {pivot}</Box>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}

// One position board in bands that follow the written verdicts. Rows are [rank, name, team, proj,
// note, band]; a player with no ruling is ranked without a call.
const BANDS = [
  { key: 'start', label: 'START', color: 'var(--success)' },
  { key: 'flex', label: 'FLEX', color: 'var(--accent)' },
  { key: 'sit', label: 'SIT', color: 'var(--danger)' },
  { key: 'rank', label: 'RANKED, NO CALL', color: 'var(--text-muted)' },
];
function TierBoard({ pos, rows, projLabel = 'Proj', next }) {
  return (
    <Box sx={{ my: 3 }}>
      {BANDS.map((b) => {
        const inBand = rows.filter((r) => r[5] === b.key);
        if (!inBand.length) return null;
        return (
          <Box key={b.key} sx={{ mb: 1.75, borderLeft: '4px solid', borderLeftColor: b.color, pl: 1.5 }}>
            <Box sx={{ fontSize: '0.72rem', fontWeight: 900, letterSpacing: '0.12em', color: b.color, mb: 0.25 }}>
              {b.label} &middot; {pos} {inBand.map((r) => r[0]).join(', ')}
            </Box>
            {inBand.map(([rk, name, team, proj, note]) => (
              <Box key={`${rk}-${name}`} sx={{ display: 'grid', gridTemplateColumns: '1.9em 1fr auto', columnGap: 1, alignItems: 'baseline', py: 0.5, borderBottom: '1px solid var(--border-subtle)', fontSize: '0.92rem', lineHeight: 1.4 }}>
                <Box component="span" sx={{ fontWeight: 900, color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>{rk}</Box>
                <Box sx={{ minWidth: 0, overflowWrap: 'anywhere' }}>
                  <strong>{name}</strong> <Box component="span" sx={{ color: 'var(--text-muted)', fontSize: '0.8rem', fontWeight: 700 }}>{team}</Box>
                  {note ? <Box sx={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{note}</Box> : null}
                </Box>
                <Box component="span" sx={{ fontVariantNumeric: 'tabular-nums', color: 'var(--text-muted)', fontSize: '0.85rem', textAlign: 'right' }}>
                  <Box component="span" sx={{ fontSize: '0.65rem', display: 'block', letterSpacing: '0.06em' }}>{projLabel}</Box>
                  {proj}
                </Box>
              </Box>
            ))}
          </Box>
        );
      })}
      {next ? (
        <Box component="p" sx={{ mt: '8px !important', mb: '0 !important', fontSize: '0.9rem', lineHeight: 1.55 }}>
          <strong>Next and unranked:</strong> <Box component="span" sx={{ color: 'var(--text-muted)' }}>{next}</Box>
        </Box>
      ) : null}
    </Box>
  );
}

const VERDICT_COLOR = {
  START: 'var(--success)', FLEX: 'var(--accent)', SIT: 'var(--danger)', OUT: 'var(--danger)',
};
const verdictColor = (v) => VERDICT_COLOR[String(v).split(' ')[0]];

// Rulings are [id, lines]; lines are [name, position, team, verdict, reason].
function RulingCard({ r: [id, lines] }) {
  return (
    <Box
      id={`ruling-${id.toLowerCase()}`}
      sx={{ my: 1.5, p: { xs: 1.5, sm: 2 }, borderRadius: 'var(--radius-md, 10px)', bgcolor: 'var(--surface-raised)', border: '1px solid var(--border-subtle)', scrollMarginTop: 92 }}
    >
      <Box sx={{ display: 'grid', gridTemplateColumns: '3.2em 1fr', columnGap: 1, rowGap: 1.1 }}>
        <Box sx={{ fontWeight: 900, color: 'var(--accent)' }}>{id}</Box>
        <Box sx={{ display: 'grid', rowGap: 1.1, minWidth: 0 }}>
          {lines.map(([name, pos, team, verdict, reason]) => (
            <Box key={name} sx={{ pl: 1.25, borderLeft: '3px solid', borderColor: verdictColor(verdict), fontSize: '0.95rem', lineHeight: 1.55, overflowWrap: 'anywhere' }}>
              <Pill color={posColor(pos)}>{pos}</Pill>
              <strong>{name}</strong>
              <Box component="span" sx={{ ml: 0.75, fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-muted)' }}>{team}</Box>
              <Box component="span" sx={{ ml: 0.75, fontSize: '0.78rem', fontWeight: 900, letterSpacing: '0.06em', color: verdictColor(verdict) }}>{verdict.toUpperCase()}</Box>
              <Box sx={{ color: 'var(--text-muted)', fontSize: '0.92rem' }}>{reason}</Box>
            </Box>
          ))}
        </Box>
      </Box>
    </Box>
  );
}

// Plain labelled list: [lead, text] rows with a colored rail.
function RailList({ items, color = 'var(--accent)' }) {
  return (
    <Box component="ul" sx={{ listStyle: 'none', p: '0 !important', m: '16px 0 !important', display: 'grid', gap: 0.9 }}>
      {items.map(([lead, text, pos]) => (
        <Box
          component="li"
          key={lead}
          sx={{ m: '0 !important', pl: 1.25, py: 0.3, borderLeft: '3px solid', borderColor: color, fontSize: '0.95rem', lineHeight: 1.55, overflowWrap: 'anywhere' }}
        >
          {pos ? <Pill color={posColor(pos)}>{pos}</Pill> : null}
          <strong>{lead}</strong>
          <Box component="span" sx={{ color: 'var(--text-muted)' }}> &middot; {text}</Box>
        </Box>
      ))}
    </Box>
  );
}

// One inactive window: [who, what to do] rows with an open box to tick.
function WindowChecklist({ title, time, rows }) {
  return (
    <Box sx={{ my: 3, p: { xs: 1.75, sm: 2.5 }, borderRadius: 'var(--radius-md, 10px)', bgcolor: 'var(--surface-raised)', border: '1px solid var(--border-subtle)' }}>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1, mb: 1 }}>
        <Box component="h3" sx={{ m: '0 !important', fontSize: '1.15rem !important' }}>{title}</Box>
        <Chip tone="var(--accent)">{time}</Chip>
      </Box>
      <Box component="ul" sx={{ listStyle: 'none', p: '0 !important', m: '0 !important', display: 'grid', gap: 0.9 }}>
        {rows.map(([who, what]) => (
          <Box component="li" key={who} sx={{ m: '0 !important', display: 'grid', gridTemplateColumns: '1.1rem 1fr', columnGap: 1.25, fontSize: '0.93rem', lineHeight: 1.5 }}>
            <Box aria-hidden="true" sx={{ width: '0.9rem', height: '0.9rem', mt: '0.3em', borderRadius: '3px', border: '2px solid var(--border-strong)' }} />
            <Box sx={{ overflowWrap: 'anywhere' }}><strong>{who}</strong> <Box component="span" sx={{ color: 'var(--text-muted)' }}>{what}</Box></Box>
          </Box>
        ))}
      </Box>
    </Box>
  );
}


// Items are [name, position, why, rank, flag]. flag is 'smash' or a Darkness Ruling id (C4).
// Usage lines read wk1/wk2/wk3/wk4; snap lines print week 1 as "--" because week-1 snap share is

// Items are [name, position, why, rank, flag]. flag is a Darkness Ruling id (C4). Usage lines read
// wk1/wk2/wk3/wk4/wk5 and "--" means the player did not play that week. Games are in kickoff order.

const GAMES = [
  {
    id: 'sea-den',
    slot: 'thu',
    title: 'Seahawks at Broncos',
    kick: 'Thu 8:15p',
    when: 'Thursday Night · 8:15p ET',
    away: 'SEA',
    home: 'DEN',
    awayPts: 21.5,
    homePts: 19,
    line: 'SEA -2.5',
    total: 40.5,
    weather: '52F, wind 7, partly cloudy',
    rain: false,
    read: 'Thursday night at altitude, 52F, and it locks first. The inactives drop about 6:45p ET and there is no pivot cover: whatever you start is final. Zach Charbonnet was ruled out Wednesday with the knee, so Emanuel Wilson is the lead back against the 7th-most generous run defense in the league. Jaxon Smith-Njigba took a full practice on the ankle and has no designation. Neither quarterback gets a start in a 40.5 total, and the Seattle D/ST is the top defense on the slate.',
    fpa: 'SEA offense vs DEN D: QB 20, RB 7, WR 29, TE 11 · DEN offense vs SEA D: QB 28, RB 15, WR 31, TE 20',
    start: [
      ['Jaxon Smith-Njigba', 'WR', 'Full practice on the ankle, no designation; 36% target share, 28.1 points a game. Wk1-5: t11/11/14/6/8, pts 26.2/42.5/35.4/12.6/23.8, snaps --/67/87/88/84%, proj 21.1 (n=39, medium).', 'WR2', 'C1'],
      ['SEA D/ST', 'DEF', '12.4 points a game, Denver implied for 19. Wk1-5: D/ST points 17/15/5/13/12, proj 12.3.', 'DST1', 'C6'],
    ],
    flex: [
      ['Emanuel Wilson', 'RB', 'Lead back with Charbonnet out; 14.6 carries a game and Denver allows the 7th-most RB points. Wk1-5: c2/21/9/21/20, t0/1/0/4/2, pts 0.3/9.2/1.4/28.0/13.2, snaps --/41/36/60/59%, proj 9.6 (n=39, medium).', 'RB21', 'C2'],
      ['RJ Harvey', 'RB', '17% target share, the passing-down back in a split; low-end flex. Wk1-5: c3/--/2/7/3, t4/--/7/10/1, pts 8.1/--/10.7/19.3/0.7, snaps --/--/36/44/37%, proj 10.5 (n=21, medium).', 'RB22', 'C5'],
    ],
    watch: [],
    sit: [
      ['Zach Charbonnet', 'RB', 'OUT. Ruled out Wednesday with the knee; the engine still projects him 12.4, ignore it.', 'OUT', 'C2'],
      ['Sam Darnold', 'QB', 'Total of 40.5 at altitude, five picks in three games, 12.4 points a game. Wk1-5: pa2/--/45/22/29, pts 0.5/--/27.7/13.3/8.3, proj 12.8 (n=38, medium).', null, 'C3'],
      ['Bo Nix', 'QB', 'Seattle allows the 5th-fewest QB points; 7.9 last week. Wk1-5: pa28/31/34/42/27, pts 5.4/14.1/24.1/13.6/7.9, proj 13.2 (n=39, medium).', null, 'C4'],
      ['J.K. Dobbins', 'RB', 'Early-down half of the split, 1.2 targets a game. Wk1-5: c8/10/17/11/18, t0/0/2/2/2, pts 3.6/3.6/6.3/7.2/15.4, snaps --/34/49/32/52%, proj 8.7 (n=28, medium).', null, 'C5'],
      ['Jaylen Waddle', 'WR', 'Seattle allows the 2nd-fewest WR points; 9.7 a game. Wk1-5: t3/10/7/6/5, pts 1.2/21.8/6.4/14.5/4.8, snaps --/61/73/68/65%, proj 9.1 (n=36, medium).', null, 'C7'],
    ],
    also: 'Talanoa Hufanga (DEN S) is out for multiple weeks with the ankle. There is no pivot cover on Thursday: if a name here is wrong at 6:45p ET, you cannot fix it. Ranked in the tiers without a call: DEN D/ST (DST6).',
  },
  {
    id: 'hou-jax',
    slot: 'london',
    title: 'Texans at Jaguars',
    kick: 'Sun 9:30a',
    when: 'Sun 9:30a ET · London (Wembley)',
    away: 'HOU',
    home: 'JAX',
    awayPts: 20,
    homePts: 22.5,
    line: 'JAX -2.5',
    total: 42.5,
    weather: null,
    rain: false,
    read: 'This one is in London and kicks off at 9:30a ET, ahead of every other Sunday game. The inactives drop about 8:00a ET and nothing has played before it, so any swap has to come from a bench player in a later game. I have no forecast for Wembley. Montgomery did not practice and is Doubtful in our database, which puts Woody Marks in the lead back chair. Jacksonville is a 2.5-point favorite, implied for 22.5 against 20.',
    fpa: 'HOU offense vs JAX D: QB 24, RB 29, WR 9, TE 27 · JAX offense vs HOU D: QB 18, RB 30, WR 3, TE 23',
    start: [
      ['Nico Collins', 'WR', 'Rest day only; 26% target share, Jacksonville allows the 9th-most WR points. Wk1-5: t10/--/--/8/7, pts 21.2/--/--/30.8/10.6, snaps --/--/--/69/71%, proj 17.8 (n=30, medium).', 'WR7', 'C8'],
      ['Woody Marks', 'RB', 'The lead back while Montgomery is out: 15 carries and 4 catches after he left Week 5. Wk1-5: c9/8/5/6/15, t1/6/1/1/4, pts 5.0/8.5/9.1/8.2/12.5, snaps --/48/37/44/85%, proj 8.1 (n=21, medium).', 'RB16', 'C9'],
      ['Parker Washington', 'WR', '25% target share, Houston allows the 3rd-most WR points. Wk1-5: t6/12/5/3/9, pts 19.3/17.8/13.0/2.0/30.4, snaps --/81/81/80/82%, proj 15.9 (n=38, medium).', 'WR10', 'C10'],
      ['Trevor Lawrence', 'QB', 'Houston is middle of the pack against QBs (18th) and Lawrence is 17.4 a game with a 21.7 last week; QB10. Wk1-5: pa23/29/29/23/39, pts 26.1/6.2/19.8/13.1/21.7, proj 18.3 (n=32, high).', 'QB10', 'C11'],
    ],
    flex: [
      ['Bhayshul Tuten', 'RB', '16.4 carries a game and Houston allows the 3rd-fewest RB points; volume flex. Wk1-5: c15/13/15/17/22, t1/2/2/2/3, pts 9.8/14.2/17.0/11.1/11.6, snaps --/51/48/59/68%, proj 9.2 (n=20, medium).', 'RB17', 'C13'],
    ],
    watch: [],
    sit: [
      ['David Montgomery', 'RB', 'OUT. Did not practice, week-to-week groin, Doubtful in our database. Wk1-5: c20/6/11/10/5, t3/2/2/0/0, pts 28.9/4.4/6.8/4.3/1.1, snaps --/52/63/56/14%, proj 7.9 (n=36, low).', 'OUT', 'C9'],
      ['C.J. Stroud', 'QB', '15.4 projected, a 42.5 total in London. Wk1-5: pa38/55/27/31/34, pts 16.5/17.0/11.7/23.1/20.9, proj 15.4 (n=36, medium).', null, 'C12'],
      ['Brian Thomas Jr.', 'WR', '13% target share, 5.3 points a game. Wk1-5: t3/8/1/2/3, pts 7.0/7.0/1.8/9.7/1.0, snaps --/54/37/62/51%, proj 8.0 (n=36, medium).', null, 'C14'],
    ],
    also: 'Jacksonville and Houston D/ST each project 8.7 in London (see the D/ST board). Ranked in the tiers without a call: Jakobi Meyers (WR26), Brenton Strange (TE14), HOU D/ST (DST7).',
  },
  {
    id: 'bal-cle',
    slot: 'one',
    title: 'Ravens at Browns',
    kick: 'Sun 1:00p',
    when: 'Sun 1:00p ET',
    away: 'BAL',
    home: 'CLE',
    awayPts: 24,
    homePts: 18.5,
    line: 'BAL -5.5',
    total: 42.5,
    weather: '58F, wind 9, sunny',
    rain: false,
    read: 'Baltimore is a 5.5-point favorite implied for 24, and the whole game turns on Lamar Jackson\'s ankle. He did not practice Wednesday and is day-to-day. Inactives at about 11:30a ET, and Derrick Henry and Zay Flowers are starts as written. Cleveland has two backs who did not practice and a receiver on a limited foot, so the home side is thin.',
    fpa: 'BAL offense vs CLE D: QB 16, RB 27, WR 7, TE 15 · CLE offense vs BAL D: QB 19, RB 24, WR 10, TE 19',
    start: [
      ['Derrick Henry', 'RB', '22.6 carries a game, Baltimore favored by 5.5. Wk1-5: c24/16/26/23/24, t1/3/1/2/2, pts 35.3/17.7/21.9/15.9/21.0, snaps --/53/67/62/55%, proj 18.0 (n=39, medium).', 'RB4', 'C16'],
      ['Zay Flowers', 'WR', '30% target share, Cleveland allows the 7th-most WR points. Wk1-5: t6/--/6/10/9, pts 26.0/--/15.4/25.8/14.6, snaps --/--/33/73/82%, proj 18.0 (n=38, medium).', 'WR6', 'C17'],
    ],
    flex: [],
    watch: [
      ['Lamar Jackson', 'QB', 'START if active. Did not practice Wednesday on the ankle, day-to-day; 19.8 a game when he plays. Wk1-5: pa25/31/20/20/--, pts 25.0/14.8/20.4/18.9/--, proj 17.6 (n=34, low).', 'QB9', 'C15'],
      ['Denzel Boston', 'WR', 'FLEX if active. Limited on the foot; 20% target share and 92% of snaps, 14.0 a game. Wk1-5: t4/7/4/7/7, pts 13.9/20.5/8.1/13.9/13.6, snaps --/93/89/95/91%.', 'WR18', 'C19'],
    ],
    sit: [
      ['Tyler Huntley', 'QB', 'Starts only if Lamar is out; 24.0 in relief last week makes him a 2QB pivot. Wk1-5: pa--/--/--/9/32, pts --/--/--/4.1/24.0, proj 11.8 (n=12, low).', null, 'C15'],
      ['Quinshon Judkins', 'RB', 'Did not practice on the ankle and Dylan Sampson did not either; do not chase the Cleveland backfield. Wk1-5: c12/12/18/17/14, t2/5/2/7/4, pts 7.0/9.8/9.9/21.6/8.0, snaps --/67/51/66/53%, proj 10.7 (n=19, low).', null, 'C18'],
      ['Mark Andrews', 'TE', '8.7 a game, 4.8 last week. Wk1-5: t6/7/5/6/6, pts 8.9/10.9/5.4/13.7/4.8, snaps --/71/52/58/72%, proj 8.4 (n=39, medium).', null, 'C20'],
    ],
    also: 'Dylan Sampson (CLE RB) did not practice either. Ranked in the tiers without a call: Harold Fannin Jr. (TE12), BAL D/ST (DST8).',
  },
  {
    id: 'car-phi',
    slot: 'one',
    title: 'Panthers at Eagles',
    kick: 'Sun 1:00p',
    when: 'Sun 1:00p ET',
    away: 'CAR',
    home: 'PHI',
    awayPts: 21,
    homePts: 19.5,
    line: 'CAR -1.5',
    total: 40.5,
    weather: '54F, wind 5, sunny',
    rain: false,
    read: 'Carolina is the better side of a 40.5 total, implied for 21 against 19.5, and Philadelphia is short on skill players. Saquon Barkley and DeVonta Smith both did not practice, Shipley is out multiple weeks and Bigsby is on IR. Hurts stays on the bench with no Smith or Barkley. Goedert is the start in that wreckage, and the Carolina trio of McMillan, Young and Hubbard is the play.',
    fpa: 'CAR offense vs PHI D: QB 11, RB 14, WR 5, TE 24 · PHI offense vs CAR D: QB 8, RB 3, WR 22, TE 8',
    start: [
      ['Tetairoa McMillan', 'WR', '27% target share, Philadelphia allows the 5th-most WR points. Wk1-5: t8/10/5/16/--, pts 10.5/15.1/3.7/45.2/--, snaps --/80/95/89/--%, proj 17.0 (n=21, medium).', 'WR8', 'C21'],
      ['Bryce Young', 'QB', '22.7 a game on 41 attempts, full practice on the knee. Wk1-5: pa37/36/48/41/--, pts 31.4/24.1/13.6/21.5/--, proj 19.3 (n=34, medium).', 'QB7', 'C22'],
      ['Chuba Hubbard', 'RB', '78% of snaps, 19.8 a game. Wk1-5: c10/12/19/20/--, t3/2/4/2/--, pts 23.7/14.4/15.0/25.9/--, snaps --/65/84/84/--%, proj 13.9 (n=34, medium).', 'RB11', 'C23'],
      ['Dallas Goedert', 'TE', 'Led the team in targets in his return; Carolina allows the 8th-most TE points. Wk1-5: t5/2/--/--/9, pts 23.7/1.4/--/--/9.8, snaps --/25/--/--/69%, proj 11.9 (n=28, low).', 'TE8', 'C27'],
    ],
    flex: [
      ['Jalen Coker', 'WR', 'Full practice on the quad, 21% target share, Legette on IR. Wk1-5: t9/9/4/--/--, pts 33.8/14.6/3.8/--/--, snaps --/76/36/--/--%, proj 13.4 (n=25, low).', 'WR17', 'C24'],
    ],
    watch: [],
    sit: [
      ['Saquon Barkley', 'RB', 'Did not practice on the hamstring; 5.8 points a game before the injury. Wk1-5: c15/4/15/2/--, t2/2/2/1/--, pts 9.0/3.0/9.0/2.0/--, snaps --/16/72/7/--%.', null, 'C25'],
      ['DeVonta Smith', 'WR', 'Did not practice, missed the last two games; a Friday upgrade would not make him safe. Wk1-5: t6/13/8/--/--, pts 8.3/28.7/12.5/--/--, snaps --/88/100/--/--%, proj 13.1 (n=33, low).', null, 'C26'],
      ['Jalen Hurts', 'QB', '16.0 a game, a 40.5 total and no Smith or Barkley; QB14. Wk1-5: pa25/37/25/27/40, pts 24.7/16.2/12.6/13.5/13.0, proj 17.4 (n=36, high).', 'QB14', 'C28'],
    ],
    also: 'Will Shipley (PHI RB) is out multiple weeks and Tank Bigsby is on IR, which leaves Dameon Pierce as the stash behind Barkley. Xavier Legette (CAR WR) is on IR.',
  },
  {
    id: 'chi-atl',
    slot: 'one',
    title: 'Bears at Falcons',
    kick: 'Sun 1:00p',
    when: 'Sun 1:00p ET',
    away: 'CHI',
    home: 'ATL',
    awayPts: 26.5,
    homePts: 25,
    line: 'CHI -1.5',
    total: 51.5,
    weather: '57F outside, wind 15, sunny, roof status unknown',
    rain: true,
    read: 'The highest total of the 1:00p window at 51.5, and neither side is more than a point and a half better. Caleb Williams took a full practice after missing three games, and Atlanta allows the 9th-most QB points. Bijan Robinson is the RB1 on this slate. Monangai did not practice, which hands Swift the work. The wind is 15 mph outside and I do not know which way the roof is set.',
    fpa: 'CHI offense vs ATL D: QB 9, RB 18, WR 6, TE 14 · ATL offense vs CHI D: QB 14, RB 26, WR 15, TE 31',
    start: [
      ['Bijan Robinson', 'RB', '24.2 a game, the RB1 this week. Wk1-5: c21/16/29/19/17, t10/4/2/2/7, pts 31.3/11.1/35.3/27.7/15.8, snaps --/51/72/60/81%, proj 20.7 (n=39, high).', 'RB1', 'C30'],
      ['D\'Andre Swift', 'RB', 'Monangai did not practice; Swift gets the work. Wk1-5: c18/16/20/15/9, t1/5/3/2/5, pts 32.4/12.9/10.8/7.4/17.3, snaps --/68/69/35/58%, proj 14.2 (n=38, medium).', 'RB12', 'C31'],
      ['Drake London', 'WR', '29% target share with Penix full in practice. Wk1-5: t4/5/10/6/11, pts 5.5/10.4/29.4/14.6/19.8, snaps --/62/93/89/98%, proj 15.4 (n=34, medium).', 'WR13', 'C32'],
    ],
    flex: [
      ['Luther Burden III', 'WR', '22% target share, Atlanta allows the 6th-most WR points. Wk1-5: t5/7/11/6/6, pts 9.5/6.2/19.8/11.4/9.9, snaps --/57/61/56/77%, proj 11.5 (n=20, medium).', 'WR20', 'C33'],
    ],
    watch: [
      ['Caleb Williams', 'QB', 'START if active. Full practice on the hamstring after missing three games; Atlanta allows the 9th-most QB points, 51.5 total. Wk1-5: pa29/26/--/--/--, pts 37.3/7.7/--/--/--, proj 20.4 (n=36, low).', 'QB5', 'C29'],
    ],
    sit: [
      ['Kyle Monangai', 'RB', 'Did not practice on the toe and thumb. Wk1-5: c10/10/10/30/--, t2/2/0/1/--, pts 20.4/7.8/3.1/28.0/--, snaps --/34/31/54/--%, proj 11.7 (n=21, low).', null, 'C31'],
      ['Michael Penix Jr.', 'QB', 'Full practice on the ribs but 13.7 a game on 26 attempts. Wk1-5: pa--/--/25/20/32, pts --/--/14.0/12.7/14.4, proj 13.8 (n=17, low).', null, 'C34'],
      ['Kyle Pitts Sr.', 'TE', 'Chicago allows the 2nd-fewest TE points; 5.5 a game. Wk1-5: t1/3/2/3/6, pts 0.0/3.0/1.5/7.7/15.2, snaps --/38/59/51/67%, proj 7.5 (n=39, medium).', null, 'C35'],
      ['Rome Odunze', 'WR', '18% target share, 8.7 a game, third in line behind Burden and Raymond. Wk1-5: t3/4/6/7/9, pts 7.2/8.3/7.4/15.4/5.0, snaps --/84/85/89/99%, proj 10.1 (n=34, medium).', null, 'C36'],
    ],
    also: 'Ranked in the tiers without a call: Kalif Raymond (WR28).',
  },
  {
    id: 'no-nyg',
    slot: 'one',
    title: 'Saints at Giants',
    kick: 'Sun 1:00p',
    when: 'Sun 1:00p ET',
    away: 'NO',
    home: 'NYG',
    awayPts: 23.5,
    homePts: 22,
    line: 'NO -1.5',
    total: 45.5,
    weather: '54F, wind 7, sunny',
    rain: false,
    read: 'Cam Skattebo gets the best matchup in football: New Orleans allows the most RB points in the league. Nabers has 52.3 points over the last two weeks with Winston, and Likely has a 30% target share. Chris Olave sat Wednesday with an illness, not an injury, and that is the one call to watch at 11:30a ET. Neither quarterback is a start.',
    fpa: 'NO offense vs NYG D: QB 12, RB 16, WR 19, TE 13 · NYG offense vs NO D: QB 15, RB 1, WR 17, TE 9',
    start: [
      ['Cam Skattebo', 'RB', 'New Orleans allows the most RB points in the league. Wk1-5: c18/12/20/18/13, t0/4/4/1/3, pts 14.1/9.5/13.0/7.6/7.1, snaps --/59/77/64/63%, proj 12.8 (n=13, low).', 'RB13', 'C38'],
      ['Malik Nabers', 'WR', '20 targets last week, 52.3 points over the last two with Winston. Wk1-5: t9/4/6/7/20, pts 12.9/1.1/7.6/23.2/29.1, snaps --/74/78/76/90%, proj 14.6 (n=24, low).', 'WR14', 'C39'],
      ['Isaiah Likely', 'TE', '30% target share, full practice on the foot. Wk1-5: t8/10/5/12/13, pts 27.8/8.3/3.3/13.6/32.4, snaps --/69/84/66/80%, proj 13.4 (n=33, medium).', 'TE5', 'C40'],
      ['Juwan Johnson', 'TE', '17% target share, more if Olave is limited. Wk1-5: t7/4/8/8/5, pts 14.4/10.6/26.3/11.9/5.6, snaps --/53/62/78/64%, proj 12.1 (n=39, high).', 'TE7', 'C41'],
    ],
    flex: [
      ['Devaughn Vele', 'WR', 'The WR1 if Olave sits, a flex either way at 20% target share. Wk1-5: t9/7/6/9/6, pts 19.9/11.4/6.9/17.4/6.6, snaps --/96/88/89/96%, proj 10.1 (n=27, medium).', 'WR22', 'C37'],
    ],
    watch: [
      ['Chris Olave', 'WR', 'START if active. Did not practice Wednesday with an illness, not an injury; 28% target share. Wk1-5: t13/10/13/12/6, pts 28.2/22.6/19.7/19.6/9.6, snaps --/84/84/86/91%, proj 17.3 (n=29, low).', 'WR11', 'C37'],
    ],
    sit: [
      ['Jameis Winston', 'QB', '25.7 last week but a streamer at best; QB16. Wk1-5: pa--/27/22/29/54, pts --/2.5/6.1/19.0/25.7, proj 14.1 (n=19, low).', null, 'C42'],
      ['Tyler Shough', 'QB', '0.8 last week, a 45.5 total. Wk1-5: pa56/34/42/48/25, pts 23.2/22.4/23.8/15.9/0.8, proj 17.0 (n=16, medium).', null, 'C43'],
      ['Alvin Kamara', 'RB', 'Limited with a back injury, 32% of snaps. Wk1-5: c--/9/9/7/3, t--/6/1/7/2, pts --/7.2/5.1/22.8/2.6, snaps --/29/32/38/27%, proj 9.2 (n=29, low).', null, 'C44'],
    ],
    also: '',
  },
  {
    id: 'nyj-ne',
    slot: 'one',
    title: 'Jets at Patriots',
    kick: 'Sun 1:00p',
    when: 'Sun 1:00p ET',
    away: 'NYJ',
    home: 'NE',
    awayPts: 18,
    homePts: 25.5,
    line: 'NE -7.5',
    total: 43.5,
    weather: '51F, wind 7, sunny',
    rain: false,
    read: 'New England is a 7.5-point favorite implied for 25.5 and the Jets are implied for 18. Breece Hall has not practiced since Week 3, so Braelon Allen is the Jets back, though the spread caps the script. Garrett Wilson is the one Jets start. Drake Maye, Stevenson and the Patriots D/ST are the other side of the same coin.',
    fpa: 'NYJ offense vs NE D: QB 23, RB 17, WR 13, TE 26 · NE offense vs NYJ D: QB 27, RB 9, WR 24, TE 29',
    start: [
      ['Garrett Wilson', 'WR', '30% target share, 11 targets last week. Wk1-5: t7/7/13/4/11, pts 13.9/16.7/26.7/5.7/23.4, snaps --/88/94/100/93%, proj 15.9 (n=29, low).', 'WR12', 'C46'],
      ['Drake Maye', 'QB', '65.6 points over the last two weeks, the Jets allow the 6th-fewest QB points; QB12. Wk1-5: pa33/22/25/37/34, pts 9.8/8.0/4.8/26.2/39.5, proj 16.9 (n=35, high).', 'QB12', 'C47'],
      ['Rhamondre Stevenson', 'RB', 'Henderson limited with a high ankle sprain; 35.9 over the last two weeks. Wk1-5: c18/6/7/13/13, t6/2/3/5/3, pts 14.5/3.6/6.8/18.4/17.5, snaps --/36/52/66/71%, proj 13.3 (n=34, medium).', 'RB15', 'C48'],
      ['NE D/ST', 'DEF', '7.5-point favorites, the Jets implied for 18. Wk1-5: D/ST points 10/25/0/6/7, proj 9.6.', 'DST2', 'C49'],
    ],
    flex: [
      ['Braelon Allen', 'RB', '18.6 as the lead back last week; New England favored by 7.5 caps the script. Wk1-5: c10/5/4/14/24, t1/1/3/2/4, pts 4.0/8.5/5.7/8.7/18.6, snaps --/31/52/94/86%, proj 8.2 (n=26, low).', 'RB18', 'C45'],
    ],
    watch: [],
    sit: [
      ['Breece Hall', 'RB', 'OUT. Has not practiced since Week 3, week-to-week quad. Wk1-5: c22/16/13/--/--, t2/5/3/--/--, pts 19.8/14.2/8.5/--/--, snaps --/65/48/--/--%, proj 12.9 (n=35, low).', 'OUT', 'C45'],
      ['Geno Smith', 'QB', 'New England allows the 10th-fewest QB points. Wk1-5: pa24/41/37/15/30, pts 9.3/15.6/26.0/8.8/10.0, proj 12.3 (n=37, medium).', null, 'C50'],
      ['A.J. Brown', 'WR', 'Limited on the high ankle sprain coming off IR; wait a week. Wk1-5: t4/--/--/--/--, pts 5.6/--/--/--/--, snaps --/--/--/--/--%, proj 11.0 (n=29, low).', null, 'C51'],
    ],
    also: '',
  },
  {
    id: 'pit-tb',
    slot: 'one',
    title: 'Steelers at Buccaneers',
    kick: 'Sun 1:00p',
    when: 'Sun 1:00p ET',
    away: 'PIT',
    home: 'TB',
    awayPts: 21,
    homePts: 18.5,
    line: 'PIT -2.5',
    total: 39.5,
    weather: '76F, wind 17, mostly sunny',
    rain: true,
    read: 'The lowest total of the week at 39.5, with a 17 mph wind at Raymond James. Baker Mayfield did not practice on the thumb and is Doubtful, and Jalon Daniels is expected to start. In that wind I want rushers and the Pittsburgh defense. Warren, Irving and the Steelers D/ST are the starts.',
    fpa: 'PIT offense vs TB D: QB 25, RB 28, WR 23, TE 10 · TB offense vs PIT D: QB 31, RB 12, WR 28, TE 17',
    start: [
      ['Jaylen Warren', 'RB', '86% of snaps, 36.8 last week; Dowdle\'s return trims him, it does not bench him. Wk1-5: c10/11/17/17/15, t6/4/4/6/6, pts 10.3/9.7/20.6/15.6/36.8, snaps --/71/90/97/87%, proj 14.7 (n=36, high).', 'RB10', 'C52'],
      ['PIT D/ST', 'DEF', 'Against Daniels in the wind, Tampa implied for 18.5. Wk1-5: D/ST points 22/9/5/6/2, proj 9.0.', 'DST3', 'C54'],
      ['Pat Freiermuth', 'TE', '21.5 last week, Pittman on IR and two receivers out. Wk1-5: t5/5/4/5/7, pts 15.6/7.4/5.1/10.7/21.5, snaps --/66/60/75/68%, proj 10.6 (n=37, medium).', 'TE9', 'C55'],
      ['Bucky Irving', 'RB', '31.5 last week, the safest piece of a backup-QB offense. Wk1-5: c8/17/15/16/21, t7/4/4/0/3, pts 20.3/13.0/7.8/6.1/31.5, snaps --/78/52/59/54%, proj 14.6 (n=32, medium).', 'RB14', 'C56'],
    ],
    flex: [
      ['Emeka Egbuka', 'WR', '23% target share, but a backup QB in the wind; WR29. Wk1-5: t6/5/9/4/9, pts 11.3/10.3/11.2/3.3/17.2, snaps --/86/74/94/89%, proj 9.7 (n=22, medium).', 'WR29', 'C57'],
    ],
    watch: [],
    sit: [
      ['Baker Mayfield', 'QB', 'OUT. Did not practice on the thumb, Doubtful; Jalon Daniels expected to start. Wk1-5: pa28/34/34/--/--, pts 11.6/12.2/11.3/--/--, proj 12.3 (n=37, low).', 'OUT', 'C53'],
      ['Jalon Daniels', 'QB', '13.9 last week on 18 attempts; 17 mph wind. Wk1-5: pa--/--/3/27/25, pts --/--/-1.1/12.4/13.9.', null, 'C53'],
      ['DK Metcalf', 'WR', '9.7 a game, 17 mph wind, Tampa allows the 10th-fewest WR points. Wk1-5: t10/9/5/9/4, pts 8.0/6.7/12.1/16.5/5.3, snaps --/97/95/97/92%, proj 10.3 (n=35, medium).', null, 'C58'],
    ],
    also: '',
  },
  {
    id: 'ten-ind',
    slot: 'one',
    title: 'Titans at Colts',
    kick: 'Sun 1:00p',
    when: 'Sun 1:00p ET',
    away: 'TEN',
    home: 'IND',
    awayPts: 18.75,
    homePts: 25.75,
    line: 'IND -7',
    total: 44.5,
    weather: '57F outside, wind 6, sunny, roof status unknown',
    rain: false,
    read: 'Indianapolis is a 7-point favorite implied for 25.75 and Tennessee is implied for 18.75. Jonathan Taylor and Keenan Allen sat Wednesday for rest only, not injury. Tyler Warren is the tight end to start. Pollard is a flex in a 7-point dog script, and Cam Ward is a sit.',
    fpa: 'TEN offense vs IND D: QB 7, RB 5, WR 16, TE 12 · IND offense vs TEN D: QB 21, RB 21, WR 11, TE 21',
    start: [
      ['Jonathan Taylor', 'RB', 'Rest day only, Tennessee is 21st in RB points allowed, so this is a volume start. Wk1-5: c19/24/23/20/15, t4/4/3/4/4, pts 25.1/29.2/9.2/22.7/11.2, snaps --/94/85/71/73%, proj 17.8 (n=36, medium).', 'RB6', 'C59'],
      ['Tyler Warren', 'TE', '21% target share, 21.4 last week. Wk1-5: t5/7/10/5/9, pts 10.3/14.4/14.7/9.1/21.4, snaps --/89/94/85/94%, proj 11.0 (n=22, high).', 'TE6', 'C60'],
    ],
    flex: [
      ['Tony Pollard', 'RB', 'Rest day only; 13.6 carries a game in a 7-point dog script. Wk1-5: c7/14/17/16/14, t2/1/4/4/1, pts 4.4/7.5/13.6/13.0/5.2, snaps --/55/53/53/48%, proj 10.9 (n=38, medium).', 'RB23', 'C61'],
      ['Keenan Allen', 'WR', 'Rest day only, 21% target share with Pierce on IR. Wk1-5: t6/5/9/--/9, pts 9.2/1.5/18.3/--/9.5, snaps --/51/73/--/45%, proj 10.4 (n=36, medium).', 'WR25', 'C63'],
    ],
    watch: [],
    sit: [
      ['Cam Ward', 'QB', '12.3 a game, 5.0 last week. Wk1-5: pa32/20/36/31/36, pts 11.7/20.0/9.4/15.6/5.0, proj 13.5 (n=22, medium).', null, 'C62'],
    ],
    also: 'Alec Pierce (IND WR) is on IR. Ranked in the tiers without a call: Wan\'Dale Robinson (WR24).',
  },
  {
    id: 'ari-lar',
    slot: 'late',
    title: 'Cardinals at Rams',
    kick: 'Sun 4:05p',
    when: 'Sun 4:05p ET',
    away: 'ARI',
    home: 'LAR',
    awayPts: 19.5,
    homePts: 32,
    line: 'LAR -12.5',
    total: 51.5,
    weather: 'Dome',
    rain: false,
    read: 'The biggest favorite on the board: the Rams by 12.5, implied for 32 in a dome. Stafford throws 43 times a game against the 3rd-most generous QB defense, and Nacua has a 34% target share. Arizona trails all afternoon, which is why Trey McBride and Michael Wilson hold their value. Jeremiyah Love did not practice on the ankle, and the Cardinals backfield is a sit either way.',
    fpa: 'ARI offense vs LAR D: QB 13, RB 20, WR 25, TE 32 · LAR offense vs ARI D: QB 3, RB 19, WR 7, TE 6',
    start: [
      ['Puka Nacua', 'WR', '34% target share, the WR1. Wk1-5: t9/--/--/12/24, pts 13.4/--/--/27.7/37.7, snaps --/--/--/90/85%, proj 25.6 (n=30, high).', 'WR1', 'C64'],
      ['Matthew Stafford', 'QB', '43 attempts a game, Arizona allows the 3rd-most QB points, Rams implied for 32. Wk1-5: pa25/31/55/51/54, pts 4.1/27.0/20.9/9.7/27.3, proj 21.1 (n=38, high).', 'QB3', 'C65'],
      ['Kyren Williams', 'RB', '22.1 a game, Rams 12.5-point favorites. Wk1-5: c11/12/15/16/16, t3/2/7/13/8, pts 15.5/15.7/21.8/37.7/19.6, snaps --/55/71/83/73%, proj 18.3 (n=38, high).', 'RB2', 'C66'],
      ['Davante Adams', 'WR', '23% target share, 22.1 last week. Wk1-5: t6/10/13/9/7, pts 5.6/40.5/20.7/7.2/22.1, snaps --/65/83/95/73%, proj 18.2 (n=33, high).', 'WR4', 'C67'],
      ['Trey McBride', 'TE', '30% target share; the Rams allow the fewest TE points but trailing volume carries him. Wk1-5: t13/10/11/12/10, pts 24.5/18.1/16.5/10.1/21.6, snaps --/88/91/97/90%, proj 15.6 (n=38, medium).', 'TE2', 'C68'],
      ['LAR D/ST', 'DEF', 'Arizona implied for 19.5. Wk1-5: D/ST points 2/18/6/12/0, proj 8.5.', 'DST5', 'C71'],
    ],
    flex: [
      ['Michael Wilson', 'WR', '26% target share in a game Arizona trails. Wk1-5: t7/7/17/13/7, pts 10.6/3.8/25.9/16.5/8.3, snaps --/94/93/94/84%, proj 12.7 (n=38, medium).', 'WR19', 'C70'],
    ],
    watch: [],
    sit: [
      ['Jeremiyah Love', 'RB', 'Did not practice on the ankle, the team wants to "get this ankle right". Wk1-5: c11/9/21/14/12, t4/3/5/1/1, pts 13.0/7.5/21.9/6.5/2.2, snaps --/40/64/45/49%.', null, 'C69'],
      ['Tyler Allgeier', 'RB', 'Takes the carries if Love sits, but a 12.5-point dog\'s carries. Wk1-5: c17/5/2/8/3, t2/2/4/2/2, pts 9.0/3.9/4.9/12.9/3.6, snaps --/64/36/55/44%, proj 6.8 (n=39, medium).', null, 'C69'],
    ],
    also: 'Jacoby Brissett is the 2QB sleeper in this game (see Sleepers). Ranked in the tiers without a call: Tyler Higbee (TE13).',
  },
  {
    id: 'buf-lv',
    slot: 'late',
    title: 'Bills at Raiders',
    kick: 'Sun 4:25p',
    when: 'Sun 4:25p ET',
    away: 'BUF',
    home: 'LV',
    awayPts: 29.5,
    homePts: 24,
    line: 'BUF -5.5',
    total: 53.5,
    weather: 'Dome',
    rain: false,
    read: 'A 53.5 total in a dome, Buffalo implied for 29.5 and Las Vegas for 24. Buffalo allows the most WR points in the league and the 4th-most QB and RB points. The Las Vegas skill players all have a matchup: Cousins, Jeanty and Bowers start and Tucker flexes. Bowers is limited on the knee and is the one game-time call. DJ Moore did not practice.',
    fpa: 'BUF offense vs LV D: QB 6, RB 11, WR 14, TE 5 · LV offense vs BUF D: QB 4, RB 4, WR 1, TE 18',
    start: [
      ['Josh Allen', 'QB', 'QB1, Bills implied for 29.5 in a dome. Wk1-5: pa29/31/26/33/19, pts 35.7/40.8/17.5/18.5/30.5, proj 27.6 (n=37, high).', 'QB1', 'C72'],
      ['James Cook III', 'RB', '19.0 carries a game, Las Vegas allows the 11th-most RB points. Wk1-5: c13/21/24/12/25, t4/3/1/2/1, pts 9.9/20.9/19.4/16.3/22.8, snaps --/74/67/59/62%, proj 17.5 (n=38, medium).', 'RB8', 'C73'],
      ['Ashton Jeanty', 'RB', 'Full practice, Buffalo allows the 4th-most RB points. Wk1-5: c23/21/19/15/10, t6/7/3/8/6, pts 32.7/11.3/12.3/18.6/10.7, snaps --/81/84/67/53%, proj 17.3 (n=22, medium).', 'RB7', 'C75'],
      ['Kirk Cousins', 'QB', '53.5 total, Buffalo allows the 4th-most QB points; QB11. Wk1-5: pa30/29/33/52/28, pts 13.8/20.2/22.2/22.6/13.7, proj 17.7 (n=29, medium).', 'QB11', 'C78'],
      ['Dalton Kincaid', 'TE', 'Las Vegas allows the 5th-most TE points; 9.2 over the last three is the risk. Wk1-5: t6/8/3/2/2, pts 18.0/22.5/3.8/1.7/3.7, snaps --/66/67/59/70%, proj 10.0 (n=30, medium).', 'TE11', 'C79'],
    ],
    flex: [
      ['Khalil Shakir', 'WR', '20% target share, more with Moore out, 53.5 total. Wk1-5: t6/6/3/8/3, pts 9.0/6.8/1.6/13.2/11.0, snaps --/49/73/76/69%, proj 9.1 (n=36, medium).', 'WR23', 'C76'],
      ['Tre Tucker', 'WR', 'Buffalo allows the most WR points in the league. Wk1-5: t4/7/4/8/5, pts 4.7/22.9/8.3/8.4/7.5, snaps --/59/57/67/75%, proj 10.7 (n=39, medium).', 'WR21', 'C77'],
    ],
    watch: [
      ['Brock Bowers', 'TE', 'START if active. Limited on the knee; 23.7 a game on a 31% target share. Wk1-5: t--/--/13/11/10, pts --/--/27.6/20.6/23.0, snaps --/--/79/82/70%, proj 18.0 (n=32, low).', 'TE1', 'C74'],
    ],
    sit: [
      ['DJ Moore', 'WR', 'Did not practice on the shoulder, listed Doubtful last week. Wk1-5: t8/0/10/2/--, pts 21.0/-0.1/13.7/2.7/--, snaps --/31/64/39/--%, proj 9.5 (n=38, low).', null, 'C76'],
    ],
    also: 'Ranked in the tiers without a call: Keon Coleman (WR30).',
  },
  {
    id: 'lac-kc',
    slot: 'late',
    title: 'Chargers at Chiefs',
    kick: 'Sun 4:25p',
    when: 'Sun 4:25p ET',
    away: 'LAC',
    home: 'KC',
    awayPts: 17,
    homePts: 25.5,
    line: 'KC -8.5',
    total: 42.5,
    weather: '66F, wind 10, sunny',
    rain: false,
    read: 'Kansas City is an 8.5-point favorite implied for 25.5, and the Chargers are implied for 17. Kansas City allows the fewest WR points in the league and the 3rd-fewest QB points, so the Los Angeles passing game is a sit. Rashee Rice did not practice on the hamstring and knee. Mahomes took a full practice on the knee.',
    fpa: 'LAC offense vs KC D: QB 30, RB 22, WR 32, TE 2 · KC offense vs LAC D: QB 22, RB 13, WR 20, TE 25',
    start: [
      ['Patrick Mahomes', 'QB', 'Full practice on the knee, Chiefs implied for 25.5. Wk1-5: pa27/47/24/30/--, pts 21.7/29.0/15.9/17.0/--, proj 18.7 (n=34, high).', 'QB6', 'C80'],
      ['Kenneth Walker III', 'RB', '27.5 a game, 21.8 carries. Wk1-5: c23/24/18/22/--, t6/10/2/1/--, pts 34.1/23.8/21.3/30.9/--, snaps --/82/73/75/--%, proj 19.6 (n=32, high).', 'RB3', 'C81'],
      ['Travis Kelce', 'TE', 'TE4 on role, not matchup: the Chargers are 25th in TE points allowed. Wk1-5: t5/11/2/4/--, pts 10.1/25.1/13.9/3.5/--, snaps --/85/79/83/--%, proj 10.2 (n=37, medium).', 'TE4', 'C82'],
      ['KC D/ST', 'DEF', 'Chargers implied for 17, Herbert 11.0 a game. Wk1-5: D/ST points 18/2/9/3/--, proj 8.4.', 'DST4', 'C83'],
    ],
    flex: [
      ['Omarion Hampton', 'RB', '14.6 carries a game, the RB19. Wk1-5: c12/23/15/9/14, t0/2/1/2/1, pts 8.3/17.5/5.6/13.3/4.9, snaps --/63/42/35/30%, proj 10.8 (n=14, medium).', 'RB19', 'C86'],
    ],
    watch: [],
    sit: [
      ['Rashee Rice', 'WR', 'Did not practice on the hamstring and knee; Reid would not commit. Wk1-5: t2/6/9/--/--, pts 9.9/12.3/15.8/1.7/--, snaps --/79/77/10/--%, proj 12.3 (n=16, low).', null, 'C84'],
      ['Justin Herbert', 'QB', '11.0 a game, Kansas City allows the 3rd-fewest QB points. Wk1-5: pa27/27/34/31/24, pts 13.3/8.9/12.7/10.1/10.2, proj 12.2 (n=38, medium).', null, 'C85'],
      ['Ladd McConkey', 'WR', 'Limited on the foot, 0.0 in Week 4 and missed Week 5; Kansas City allows the fewest WR points. Wk1-5: t7/3/5/2/--, pts 19.2/6.5/10.6/0.0/--, snaps --/46/88/34/--%, proj 8.3 (n=36, low).', null, 'C87'],
    ],
    also: '',
  },
  {
    id: 'dal-gb',
    slot: 'prime',
    title: 'Cowboys at Packers',
    kick: 'Sun 8:20p',
    when: 'Sunday Night · 8:20p ET',
    away: 'DAL',
    home: 'GB',
    awayPts: 26,
    homePts: 27.5,
    line: 'GB -1.5',
    total: 53.5,
    weather: '57F, wind 10, clear',
    rain: false,
    read: 'Sunday night at Lambeau: a 53.5 total with Green Bay by 1.5, implied 27.5 to 26. Dallas allows the 5th-most QB points and Green Bay the 2nd-most RB points, so Jordan Love and Javonte Williams start, and Green Bay allows the 4th-fewest QB points, so Prescott sits. CeeDee Lamb took a full practice and his 2.9 last week was the outlier. Josh Jacobs is on the Exempt list, which leaves MarShawn Lloyd as the Packers back. Inactives about 6:50p ET.',
    fpa: 'DAL offense vs GB D: QB 29, RB 2, WR 18, TE 22 · GB offense vs DAL D: QB 5, RB 8, WR 12, TE 16',
    start: [
      ['CeeDee Lamb', 'WR', 'Full practice, 27% target share; 2.9 last week was the outlier. Wk1-5: t8/9/8/21/5, pts 15.4/35.3/20.2/41.3/2.9, snaps --/75/82/86/57%, proj 18.3 (n=34, medium).', 'WR3', 'C88'],
      ['Javonte Williams', 'RB', 'Green Bay allows the 2nd-most RB points. Wk1-5: c12/12/19/19/12, t5/4/3/5/3, pts 24.2/8.0/18.3/31.3/14.2, snaps --/80/76/74/85%, proj 18.5 (n=38, medium).', 'RB5', 'C89'],
      ['Jordan Love', 'QB', 'Dallas allows the 5th-most QB points, 53.5 total. Wk1-5: pa42/29/53/30/31, pts 20.5/13.8/18.5/13.1/25.3, proj 19.0 (n=35, high).', 'QB4', 'C90'],
      ['Christian Watson', 'WR', '21.9 a game, 32.3 last week. Wk1-5: t8/11/10/3/8, pts 32.7/14.1/22.6/7.7/32.3, snaps --/90/80/68/80%, proj 18.0 (n=30, medium).', 'WR5', 'C91'],
      ['Matthew Golden', 'WR', '24% target share, 20.3 last week. Wk1-5: t12/6/12/7/7, pts 15.5/9.8/21.0/11.7/20.3, snaps --/86/82/88/77%, proj 11.9 (n=19, medium).', 'WR15', 'C92'],
      ['George Pickens', 'WR', '22% target share, 53.5 total. Wk1-5: t6/8/11/3/13, pts 5.8/10.0/15.2/9.5/28.0, snaps --/76/85/86/88%, proj 14.2 (n=36, medium).', 'WR16', 'C93'],
      ['Tucker Kraft', 'TE', '86% of snaps, the TE10. Wk1-5: t6/3/8/7/5, pts 9.5/3.5/6.6/17.5/11.6, snaps --/98/76/92/77%, proj 10.8 (n=30, low).', 'TE10', 'C94'],
    ],
    flex: [
      ['MarShawn Lloyd', 'RB', 'Jacobs on the Exempt list, Lloyd 16.7 last week; Dallas allows the 8th-most RB points. Wk1-5: c13/6/4/7/10, t1/2/3/5/2, pts 3.7/8.6/3.8/9.9/16.7, snaps --/27/23/55/44%.', 'RB20', 'C95'],
    ],
    watch: [],
    sit: [
      ['Dak Prescott', 'QB', 'Green Bay allows the 4th-fewest QB points; QB13. Wk1-5: pa34/31/40/45/42, pts 14.4/29.8/18.9/18.1/12.6, proj 15.9 (n=30, medium).', 'QB13', 'C96'],
    ],
    also: '',
  },
  {
    id: 'wsh-sf',
    slot: 'prime',
    title: 'Commanders at 49ers',
    kick: 'Mon 8:15p',
    when: 'Monday Night · 8:15p ET',
    away: 'WSH',
    home: 'SF',
    awayPts: 21.5,
    homePts: 29,
    line: 'SF -7.5',
    total: 50.5,
    weather: '65F, wind 12, mostly sunny',
    rain: false,
    read: 'Monday night closes the slate: San Francisco by 7.5, implied for 29, with Washington at 21.5. Washington allows the 2nd-most QB points and the 3rd-most TE points, so Purdy and Kittle are starts. Mike Evans has a 25% target share with Deebo Samuel out. Stefon Diggs has a hamstring and no Washington practice report before Thursday, and Monday night leaves no pivot. Inactives about 6:45p ET Monday.',
    fpa: 'WSH offense vs SF D: QB 26, RB 10, WR 26, TE 28 · SF offense vs WSH D: QB 2, RB 31, WR 4, TE 3',
    start: [
      ['Brock Purdy', 'QB', 'Washington allows the 2nd-most QB points. Wk1-5: pa34/22/27/30/29, pts 21.1/28.5/31.3/19.6/16.2, proj 23.9 (n=29, high).', 'QB2', 'C97'],
      ['Christian McCaffrey', 'RB', '18.3 a game; Washington\'s run defense is stout but the catches hold. Wk1-5: c10/10/15/15/11, t8/4/5/5/3, pts 13.8/22.6/21.6/16.0/17.3, snaps --/52/83/74/82%, proj 17.2 (n=26, medium).', 'RB9', 'C98'],
      ['Mike Evans', 'WR', '25% target share with Deebo Samuel out. Wk1-5: t7/3/6/8/10, pts 16.9/8.4/12.4/12.6/26.3, snaps --/54/33/59/63%, proj 15.1 (n=27, medium).', 'WR9', 'C99'],
      ['George Kittle', 'TE', 'Washington allows the 3rd-most TE points. Wk1-5: t5/4/7/6/6, pts 4.2/18.0/26.2/17.0/7.4, snaps --/48/85/91/92%, proj 15.5 (n=31, medium).', 'TE3', 'C100'],
      ['Jayden Daniels', 'QB', '32.3 in his return, 7 carries a game; QB8. Wk1-5: pa34/17/--/--/25, pts 17.7/14.7/--/--/32.3, proj 17.2 (n=27, low).', 'QB8', 'C101'],
    ],
    flex: [
      ['Terry McLaurin', 'WR', '22% target share, 12.2 in Week 5. Wk1-5: t4/9/9/--/4, pts 3.4/7.0/19.7/--/12.2, snaps --/70/75/--/58%, proj 9.8 (n=31, medium).', 'WR27', 'C102'],
      ['Jacory Croskey-Merritt', 'RB', 'Deep-league flex only: 13.4 carries a game, San Francisco allows the 10th-most RB points, Washington a 7.5-point dog. Wk1-5: c16/12/19/9/11, t1/1/1/4/0, pts 12.6/5.8/5.3/7.0/14.2, snaps --/37/57/45/35%, proj 9.2 (n=22, medium).', 'RB24', 'C104'],
    ],
    watch: [],
    sit: [
      ['Stefon Diggs', 'WR', 'Hamstring, no Washington practice report before Thursday; Monday night leaves no pivot. Wk1-5: t9/6/7/9/--, pts 15.5/21.7/7.3/8.5/--, snaps --/51/59/66/--%, proj 11.1 (n=29, low).', null, 'C103'],
    ],
    also: '',
  },
];

const SLOT = (slot) => GAMES.filter((g) => g.slot === slot).map((g) => <GameCard key={g.id} g={g} />);

// Injury board rows are [name, position, team, status, pivot, tone, ruling].
// Statuses are the Wednesday practice reports; no Thursday report existed for the Sunday teams.

const INJ_OUT = [
  ['Zach Charbonnet', 'RB', 'SEA', 'Knee, ruled out Wednesday. The engine still projects him 12.4; ignore it. Thursday, no pivot cover.', 'Emanuel Wilson (FLEX, RB21).', 'out', 'C2'],
  ['David Montgomery', 'RB', 'HOU', 'Groin, did not practice, week-to-week, Doubtful in our database. London.', 'Woody Marks (START, RB16).', 'out', 'C9'],
  ['Breece Hall', 'RB', 'NYJ', 'Quad, has not practiced since Week 3, week-to-week.', 'Braelon Allen (FLEX, RB18).', 'out', 'C45'],
  ['Baker Mayfield', 'QB', 'TB', 'Thumb, did not practice, Doubtful. Jalon Daniels is expected to start.', 'Daniels is a sit in a 17 mph wind. Bucky Irving is the safe piece (START).', 'out', 'C53'],
];

const INJ_THU = [
  ['Jaxon Smith-Njigba', 'WR', 'SEA', 'Ankle, full practice, no designation.', 'Start him. Thursday has no pivot cover.', 'likely', 'C1'],
];

const INJ_LONDON = [
  ['Nico Collins', 'WR', 'HOU', 'Limited Wednesday, rest only, no injury text.', 'Start him. The inactives are about 8:00a ET and nothing kicks before them.', 'likely', 'C8'],
];

const INJ_ONE = [
  ['Lamar Jackson', 'QB', 'BAL', 'Ankle, did not practice Wednesday, day-to-day. Inactives about 11:30a ET.', 'Tyler Huntley is a sit and a 2QB pivot only (24.0 in relief last week). Henry and Flowers are starts as written.', 'gtd', 'C15'],
  ['Quinshon Judkins', 'RB', 'CLE', 'Ankle, did not practice; Dylan Sampson did not either.', 'None. Do not chase the Cleveland backfield.', 'sit', 'C18'],
  ['Denzel Boston', 'WR', 'CLE', 'Foot, limited Wednesday.', 'Flex only if active. 92% of snaps.', 'gtd', 'C19'],
  ['Saquon Barkley', 'RB', 'PHI', 'Hamstring, did not practice. 5.8 points a game before the injury.', 'Dameon Pierce is the stash (Shipley out multiple weeks, Bigsby on IR). Barkley is a sit.', 'sit', 'C25'],
  ['DeVonta Smith', 'WR', 'PHI', 'Hamstring, did not practice, missed the last two games.', 'Dallas Goedert (START). A Friday upgrade would not make Smith safe.', 'sit', 'C26'],
  ['Caleb Williams', 'QB', 'CHI', 'Hamstring, full practice after missing three games.', 'No Chicago quarterback is called. If he is out, swap to a quarterback who kicks off at 4:05p or later.', 'likely', 'C29'],
  ['Kyle Monangai', 'RB', 'CHI', 'Toe and thumb, did not practice.', 'D\'Andre Swift gets the work (START).', 'sit', 'C31'],
  ['Chris Olave', 'WR', 'NO', 'Illness, did not practice Wednesday. Not an injury.', 'Devaughn Vele is the WR1 if Olave sits and a flex either way. Juwan Johnson gets more.', 'gtd', 'C37'],
  ['Alvin Kamara', 'RB', 'NO', 'Limited with a back injury, 32% of snaps.', 'Sit either way.', 'sit', 'C44'],
  ['TreVeyon Henderson', 'RB', 'NE', 'High ankle sprain, limited Wednesday.', 'Rhamondre Stevenson starts (35.9 over the last two weeks).', 'gtd', 'C48'],
  ['A.J. Brown', 'WR', 'NE', 'High ankle sprain, limited, coming off IR.', 'Wait a week. Sit.', 'sit', 'C51'],
  ['Rico Dowdle', 'RB', 'PIT', 'Toe, limited Wednesday. His return trims Jaylen Warren; it does not bench him.', 'Warren starts (86% of snaps).', 'gtd', 'C52'],
  ['Jonathan Taylor', 'RB', 'IND', 'Rest day only.', 'Start him.', 'likely', 'C59'],
  ['Keenan Allen', 'WR', 'IND', 'Rest day only, did not practice. Pierce is on IR.', 'Flex. If he is inactive there is no Colts receiver pivot on this card.', 'gtd', 'C63'],
  ['Tony Pollard', 'RB', 'TEN', 'Rest day only.', 'Flex in a 7-point dog script.', 'likely', 'C61'],
];

const INJ_LATE = [
  ['Jeremiyah Love', 'RB', 'ARI', 'Ankle, did not practice. The team wants to "get this ankle right".', 'Tyler Allgeier takes the carries if Love sits, but a 12.5-point dog\'s carries. Sit both.', 'sit', 'C69'],
  ['Brock Bowers', 'TE', 'LV', 'Knee, limited Wednesday. 23.7 a game on a 31% target share.', 'Start him if active. Carry a later tight end: Kraft on Sunday night or Kittle on Monday.', 'gtd', 'C74'],
  ['DJ Moore', 'WR', 'BUF', 'Shoulder, did not practice, listed Doubtful last week.', 'Khalil Shakir (FLEX, more with Moore out).', 'sit', 'C76'],
  ['Rashee Rice', 'WR', 'KC', 'Hamstring and knee, did not practice. Reid would not commit.', 'None. Sit.', 'sit', 'C84'],
  ['Ladd McConkey', 'WR', 'LAC', 'Foot, limited. 0.0 in Week 4 and missed Week 5.', 'None. Sit; Kansas City allows the fewest WR points.', 'sit', 'C87'],
  ['Patrick Mahomes', 'QB', 'KC', 'Knee, full practice.', 'Start him.', 'likely', 'C80'],
];

const INJ_NIGHT = [
  ['CeeDee Lamb', 'WR', 'DAL', 'Full practice, 27% target share.', 'Start him. His 2.9 last week was the outlier.', 'likely', 'C88'],
  ['Stefon Diggs', 'WR', 'WSH', 'Hamstring, no Washington practice report before Thursday.', 'None: Monday night leaves no pivot. Sit.', 'sit', 'C103'],
];

const ALREADY_OUT = ['Talanoa Hufanga (DEN S, ankle, multiple weeks)', 'Will Shipley (PHI RB, out multiple weeks)', 'Tank Bigsby (PHI RB, IR)', 'Xavier Legette (CAR WR, IR)', 'Michael Pittman Jr. (PIT WR, IR)', 'Roman Wilson (PIT WR, out)', 'Alec Pierce (IND WR, IR)', 'Deebo Samuel (SF WR, out)', 'Josh Jacobs (GB RB, Exempt list)', 'Jayden Reed (GB WR, IR)', 'Chris Brooks (GB RB, IR)', 'Tyquan Thornton (KC WR, IR)', 'Jaxson Dart (NYG QB, IR)', 'Dillon Gabriel (CLE QB, IR)', 'Marcus Mariota (WSH QB, MCL)', 'Tre\' Harris (LAC WR, Doubtful, hamstring)'];

// Tier rows are [rank, name, team, proj, note, band]. Bands follow the written verdicts.

const QB_ROWS = [
  [1, 'Josh Allen', 'BUF', '27.6', '28.6 a game, BUF implied 29.5', 'start'],
  [2, 'Brock Purdy', 'SF', '23.9', '23.3 a game, SF implied 29.0', 'start'],
  [3, 'Matthew Stafford', 'LAR', '21.1', '17.8 a game, LAR implied 32.0', 'start'],
  [4, 'Jordan Love', 'GB', '19.0', '18.2 a game, GB implied 27.5', 'start'],
  [5, 'Caleb Williams', 'CHI', '20.4', '22.5 a game, CHI implied 26.5; if active', 'start'],
  [6, 'Patrick Mahomes', 'KC', '18.7', '20.9 a game, KC implied 25.5', 'start'],
  [7, 'Bryce Young', 'CAR', '19.3', '22.7 a game, CAR implied 21.0', 'start'],
  [8, 'Jayden Daniels', 'WSH', '17.2', '21.6 a game, WSH implied 21.5', 'start'],
  [9, 'Lamar Jackson', 'BAL', '17.6', '19.8 a game, BAL implied 24.0; if active', 'start'],
  [10, 'Trevor Lawrence', 'JAX', '18.3', '17.4 a game, JAX implied 22.5', 'start'],
  [11, 'Kirk Cousins', 'LV', '17.7', '18.5 a game, LV implied 24.0', 'start'],
  [12, 'Drake Maye', 'NE', '16.9', '17.6 a game, NE implied 25.5', 'start'],
  [13, 'Dak Prescott', 'DAL', '15.9', '18.8 a game, DAL implied 26.0', 'sit'],
  [14, 'Jalen Hurts', 'PHI', '17.4', '16.0 a game, PHI implied 19.5', 'sit'],
];

const QB_NEXT = 'Sits and unranked: Tyler Huntley (a 2QB pivot behind Lamar), Jameis Winston (QB16, a streamer at best), Bo Nix, Sam Darnold, Justin Herbert, Geno Smith, Tyler Shough, Michael Penix Jr., C.J. Stroud, Cam Ward and Jalon Daniels. Baker Mayfield is out. Jacoby Brissett is a 2QB sleeper. The engine projects the n=0 backup quarterbacks at 14.7; ignore them.';

const RB_ROWS = [
  [1, 'Bijan Robinson', 'ATL', '20.7', '20.4 carries a game, ATL implied 25.0', 'start'],
  [2, 'Kyren Williams', 'LAR', '18.3', '14.0 carries a game, LAR implied 32.0', 'start'],
  [3, 'Kenneth Walker III', 'KC', '19.6', '21.8 carries a game, KC implied 25.5', 'start'],
  [4, 'Derrick Henry', 'BAL', '18.0', '22.6 carries a game, BAL implied 24.0', 'start'],
  [5, 'Javonte Williams', 'DAL', '18.5', '14.8 carries a game, DAL implied 26.0', 'start'],
  [6, 'Jonathan Taylor', 'IND', '17.8', '20.2 carries a game, IND implied 25.75', 'start'],
  [7, 'Ashton Jeanty', 'LV', '17.3', '17.6 carries a game, LV implied 24.0', 'start'],
  [8, 'James Cook III', 'BUF', '17.5', '19.0 carries a game, BUF implied 29.5', 'start'],
  [9, 'Christian McCaffrey', 'SF', '17.2', '12.2 carries a game, SF implied 29.0', 'start'],
  [10, 'Jaylen Warren', 'PIT', '14.7', '14.0 carries a game, PIT implied 21.0', 'start'],
  [11, 'Chuba Hubbard', 'CAR', '13.9', '15.3 carries a game, CAR implied 21.0', 'start'],
  [12, 'D\'Andre Swift', 'CHI', '14.2', '15.6 carries a game, CHI implied 26.5', 'start'],
  [13, 'Cam Skattebo', 'NYG', '12.8', '16.2 carries a game, NYG implied 22.0', 'start'],
  [14, 'Bucky Irving', 'TB', '14.6', '15.4 carries a game, TB implied 18.5', 'start'],
  [15, 'Rhamondre Stevenson', 'NE', '13.3', '11.4 carries a game, NE implied 25.5', 'start'],
  [16, 'Woody Marks', 'HOU', '8.1', '8.6 carries a game, HOU implied 20.0', 'start'],
  [17, 'Bhayshul Tuten', 'JAX', '9.2', '16.4 carries a game, JAX implied 22.5', 'flex'],
  [18, 'Braelon Allen', 'NYJ', '8.2', '11.4 carries a game, NYJ implied 18.0', 'flex'],
  [19, 'Omarion Hampton', 'LAC', '10.8', '14.6 carries a game, LAC implied 17.0', 'flex'],
  [20, 'MarShawn Lloyd', 'GB', '8.4', '8.0 carries a game, GB implied 27.5', 'flex'],
  [21, 'Emanuel Wilson', 'SEA', '9.6', '14.6 carries a game, SEA implied 21.5', 'flex'],
  [22, 'RJ Harvey', 'DEN', '10.5', '3.8 carries a game, DEN implied 19.0', 'flex'],
  [23, 'Tony Pollard', 'TEN', '10.9', '13.6 carries a game, TEN implied 18.75', 'flex'],
  [24, 'Jacory Croskey-Merritt', 'WSH', '9.2', '13.4 carries a game, WSH implied 21.5', 'flex'],
];

const RB_NEXT = 'Sits: J.K. Dobbins, Quinshon Judkins, Kyle Monangai, Alvin Kamara, Saquon Barkley, Jeremiyah Love and Tyler Allgeier. Out: Zach Charbonnet, David Montgomery and Breece Hall. Dameon Pierce is a stash behind Barkley and is not ranked. The engine placeholders are ignored: Charbonnet at 12.4 and Barkley at a 10.8 mean.';

const WR_ROWS = [
  [1, 'Puka Nacua', 'LAR', '25.6', '34% target share, LAR implied 32.0', 'start'],
  [2, 'Jaxon Smith-Njigba', 'SEA', '21.1', '36% target share, SEA implied 21.5', 'start'],
  [3, 'CeeDee Lamb', 'DAL', '18.3', '27% target share, DAL implied 26.0', 'start'],
  [4, 'Davante Adams', 'LAR', '18.2', '23% target share, LAR implied 32.0', 'start'],
  [5, 'Christian Watson', 'GB', '18.0', '23% target share, GB implied 27.5', 'start'],
  [6, 'Zay Flowers', 'BAL', '18.0', '30% target share, BAL implied 24.0', 'start'],
  [7, 'Nico Collins', 'HOU', '17.8', '26% target share, HOU implied 20.0', 'start'],
  [8, 'Tetairoa McMillan', 'CAR', '17.0', '27% target share, CAR implied 21.0', 'start'],
  [9, 'Mike Evans', 'SF', '15.1', '25% target share, SF implied 29.0', 'start'],
  [10, 'Parker Washington', 'JAX', '15.9', '25% target share, JAX implied 22.5', 'start'],
  [11, 'Chris Olave', 'NO', '17.3', '28% target share, NO implied 23.5; if active', 'start'],
  [12, 'Garrett Wilson', 'NYJ', '15.9', '30% target share, NYJ implied 18.0', 'start'],
  [13, 'Drake London', 'ATL', '15.4', '29% target share, ATL implied 25.0', 'start'],
  [14, 'Malik Nabers', 'NYG', '14.6', '27% target share, NYG implied 22.0', 'start'],
  [15, 'Matthew Golden', 'GB', '11.9', '24% target share, GB implied 27.5', 'start'],
  [16, 'George Pickens', 'DAL', '14.2', '22% target share, DAL implied 26.0', 'start'],
  [17, 'Jalen Coker', 'CAR', '13.4', '21% target share, CAR implied 21.0', 'flex'],
  [18, 'Denzel Boston', 'CLE', '13.3', '20% target share, CLE implied 18.5; if active', 'flex'],
  [19, 'Michael Wilson', 'ARI', '12.7', '26% target share, ARI implied 19.5', 'flex'],
  [20, 'Luther Burden III', 'CHI', '11.5', '22% target share, CHI implied 26.5', 'flex'],
  [21, 'Tre Tucker', 'LV', '10.7', '16% target share, LV implied 24.0', 'flex'],
  [22, 'Devaughn Vele', 'NO', '10.1', '20% target share, NO implied 23.5', 'flex'],
  [23, 'Khalil Shakir', 'BUF', '9.1', '20% target share, BUF implied 29.5', 'flex'],
  [24, 'Wan\'Dale Robinson', 'TEN', '11.4', '19% target share, TEN implied 18.75', 'rank'],
  [25, 'Keenan Allen', 'IND', '10.4', '21% target share, IND implied 25.75', 'flex'],
  [26, 'Jakobi Meyers', 'JAX', '11.1', '14% target share, JAX implied 22.5', 'rank'],
  [27, 'Terry McLaurin', 'WSH', '9.8', '22% target share, WSH implied 21.5', 'flex'],
  [28, 'Kalif Raymond', 'CHI', '8.6', '18% target share, CHI implied 26.5', 'rank'],
  [29, 'Emeka Egbuka', 'TB', '9.7', '23% target share, TB implied 18.5', 'flex'],
  [30, 'Keon Coleman', 'BUF', '9.0', '13% target share, BUF implied 29.5', 'rank'],
];

const WR_NEXT = 'Sits: Jaylen Waddle, Brian Thomas Jr., DeVonta Smith, Rome Odunze, A.J. Brown, DK Metcalf, DJ Moore, Rashee Rice, Ladd McConkey and Stefon Diggs. Nobody from CIN, DET, MIA or MIN is ranked.';

const TE_ROWS = [
  [1, 'Brock Bowers', 'LV', '18.0', '31% target share, LV implied 24.0; if active', 'start'],
  [2, 'Trey McBride', 'ARI', '15.6', '30% target share, ARI implied 19.5', 'start'],
  [3, 'George Kittle', 'SF', '15.5', '21% target share, SF implied 29.0', 'start'],
  [4, 'Travis Kelce', 'KC', '10.2', '17% target share, KC implied 25.5', 'start'],
  [5, 'Isaiah Likely', 'NYG', '13.4', '30% target share, NYG implied 22.0', 'start'],
  [6, 'Tyler Warren', 'IND', '11.0', '21% target share, IND implied 25.75', 'start'],
  [7, 'Juwan Johnson', 'NO', '12.1', '17% target share, NO implied 23.5', 'start'],
  [8, 'Dallas Goedert', 'PHI', '11.9', '18% target share, PHI implied 19.5', 'start'],
  [9, 'Pat Freiermuth', 'PIT', '10.6', '15% target share, PIT implied 21.0', 'start'],
  [10, 'Tucker Kraft', 'GB', '10.8', '16% target share, GB implied 27.5', 'start'],
  [11, 'Dalton Kincaid', 'BUF', '10.0', '16% target share, BUF implied 29.5', 'start'],
  [12, 'Harold Fannin Jr.', 'CLE', '10.0', '18% target share, CLE implied 18.5', 'rank'],
  [13, 'Tyler Higbee', 'LAR', '11.6', '13% target share, LAR implied 32.0', 'rank'],
  [14, 'Brenton Strange', 'JAX', '8.7', '19% target share, JAX implied 22.5', 'rank'],
];

const TE_NEXT = 'Sits: Mark Andrews and Kyle Pitts Sr. Fannin, Higbee and Strange are ranked without a call.';

const DST_ROWS = [
  [1, 'SEA D/ST', 'SEA', '12.3', 'vs DEN, DEN implied 19.0', 'start'],
  [2, 'NE D/ST', 'NE', '9.6', 'vs NYJ, NYJ implied 18.0', 'start'],
  [3, 'PIT D/ST', 'PIT', '9.0', 'vs TB, TB implied 18.5', 'start'],
  [4, 'KC D/ST', 'KC', '8.4', 'vs LAC, LAC implied 17.0', 'start'],
  [5, 'LAR D/ST', 'LAR', '8.5', 'vs ARI, ARI implied 19.5', 'start'],
  [6, 'DEN D/ST', 'DEN', '10.8', 'vs SEA, SEA implied 21.5', 'rank'],
  [7, 'HOU D/ST', 'HOU', '8.7', 'vs JAX, JAX implied 22.5', 'rank'],
  [8, 'BAL D/ST', 'BAL', '7.8', 'vs CLE, CLE implied 18.5', 'rank'],
];

// Handcuff rows are [team, starter and status, handcuff, verdict].

const HANDCUFFS = [
  ['SEA', 'Zach Charbonnet: knee, ruled out Wednesday.', 'Emanuel Wilson', 'FLEX, RB21. Lead back, 14.6 carries a game; Denver allows the 7th-most RB points.'],
  ['HOU', 'David Montgomery: groin, did not practice, Doubtful in our database.', 'Woody Marks', 'START, RB16. 15 carries and 4 catches after Montgomery left in Week 5.'],
  ['NYJ', 'Breece Hall: quad, week-to-week.', 'Braelon Allen', 'FLEX, RB18. 18.6 as the lead back last week; New England favored by 7.5 caps the script.'],
  ['ARI', 'Jeremiyah Love: ankle, did not practice.', 'Tyler Allgeier', 'SIT. A 12.5-point dog\'s carries.'],
  ['BAL', 'Lamar Jackson: ankle, did not practice Wednesday.', 'Tyler Huntley', 'SIT in 1QB. A 2QB pivot only: 24.0 in relief last week.'],
  ['TB', 'Baker Mayfield: thumb, Doubtful.', 'Jalon Daniels', 'SIT. 13.9 last week on 18 attempts, 17 mph wind.'],
  ['NO', 'Chris Olave: illness, did not practice Wednesday.', 'Devaughn Vele', 'FLEX, WR22. The WR1 if Olave sits, a flex either way at 20% target share.'],
  ['BUF', 'DJ Moore: shoulder, did not practice.', 'Khalil Shakir', 'FLEX, WR23. 20% target share, more with Moore out, 53.5 total.'],
  ['PHI', 'Saquon Barkley: hamstring, did not practice. Shipley out multiple weeks, Bigsby on IR.', 'Dameon Pierce', 'Stash only, no call. Barkley is a sit and Pierce is not ranked.'],
  ['GB', 'Josh Jacobs: Exempt list.', 'MarShawn Lloyd', 'FLEX, RB20. 16.7 last week; Dallas allows the 8th-most RB points.'],
  ['CHI', 'Kyle Monangai: toe and thumb, did not practice.', 'D\'Andre Swift', 'START, RB12. Swift gets the work.'],
  ['DEN', 'J.K. Dobbins: the early-down half of a split, 1.2 targets a game.', 'RJ Harvey', 'FLEX, RB22. 17% target share, the passing-down back; Dobbins is a sit.'],
];

// D/ST rows are [d/st, opponent, opp implied, D/ST points wk1-5, avg, proj, verdict].

const DST_TABLE = [
  ['SEA', 'at DEN', '19.0', '17/15/5/13/12', '12.4', '12.3', 'START (DST1)'],
  ['NE', 'vs NYJ', '18.0', '10/25/0/6/7', '9.6', '9.6', 'START (DST2)'],
  ['PIT', 'at TB', '18.5', '22/9/5/6/2', '8.8', '9.0', 'START (DST3)'],
  ['KC', 'vs LAC', '17.0', '18/2/9/3/--', '8.0', '8.4', 'START (DST4)'],
  ['LAR', 'vs ARI', '19.5', '2/18/6/12/0', '7.6', '8.5', 'START (DST5)'],
  ['DEN', 'vs SEA', '21.5', '3/12/11/2/16', '8.8', '10.8', 'Ranked DST6, no call'],
  ['HOU', 'at JAX', '22.5', '-3/10/12/4/22', '9.0', '8.7', 'Ranked DST7, no call'],
  ['BAL', 'at CLE', '18.5', '10/7/3/10/5', '7.0', '7.8', 'Ranked DST8, no call'],
  ['JAX', 'vs HOU', '20.0', '17/3/16/6/6', '9.6', '8.7', 'Streamer beyond the top eight'],
  ['CHI', 'at ATL', '25.0', '3/11/16/14/0', '8.8', '9.0', 'Deep leagues only'],
  ['DAL', 'at GB', '27.5', '3/3/-1/1/0', '1.2', '2.3', 'Avoid'],
  ['ARI', 'at LAR', '32.0', '14/2/-3/7/-2', '3.6', '3.3', 'Avoid'],
  ['IND', 'vs TEN', '18.75', '-5/-4/8/9/0', '1.6', '3.9', 'Avoid'],
];

const DST_NEXT = 'Houston and Jacksonville project 8.7 each in London; Houston is DST7 and Jacksonville is unranked. Chicago at Atlanta (9.0) only in deep leagues. Avoid Dallas (1.2 a game), Arizona and Indianapolis.';

// IDP rows are [player, team, position, opponent, IDP points wk1-5, note].

const IDP_TABLE = [
  ['Devin Lloyd', 'CAR', 'LB', 'at PHI', '11/34/--/9/--', '18.0 a game, 21.5 over the last two'],
  ['Ernest Jones IV', 'SEA', 'LB', 'at DEN (Thu)', '10.5/6/6.5/20/12', '16.0 over the last two. Thursday, no pivot'],
  ['Arvell Reese', 'NYG', 'LB', 'vs NO', '7/5/13.5/19/10', '14.5 over the last two'],
  ['Elijah Ponder', 'NE', 'LB', 'vs NYJ', '1/19/4.5/10.5/16', '13.3 over the last two'],
  ['David Bailey', 'NYJ', 'LB', 'at NE', '8/8.5/6.5/5/23', 'Three sacks in Week 5'],
  ['Will Anderson Jr.', 'HOU', 'DE', 'at JAX (London)', '4/14/21/11/15.5', '13.1 a game. London, 9:30a ET'],
];

const IDP_AVOID = 'Avoid Talanoa Hufanga (DEN S, Out) and Mason Graham (CLE DT, Doubtful, did not practice).';

const SLEEPERS = [
  ['Woody Marks', 'The lead back while Montgomery is out: 15 carries and 4 catches in Week 5 after Montgomery left. START, RB16, in London.', 'RB'],
  ['Tre Tucker', 'FLEX, WR21. Buffalo allows the most WR points in the league.', 'WR'],
  ['Emanuel Wilson', 'FLEX, RB21. The lead back with Charbonnet out; Denver allows the 7th-most RB points. Thursday.', 'RB'],
  ['Jacoby Brissett', 'A 2QB sleeper: 40 attempts a game and Arizona trails by 12.5 at the Rams.', 'QB'],
];

const FADES = [
  ['Jalen Hurts', '16.0 a game, a 40.5 total and no Smith or Barkley. QB14, a sit.', 'QB'],
  ['Saquon Barkley', 'Did not practice on the hamstring. 5.8 points a game before the injury, and the engine\'s 10.8 mean is a placeholder.', 'RB'],
  ['DK Metcalf', '9.7 a game in a 17 mph wind. Sit.', 'WR'],
  ['Ladd McConkey', 'Limited on the foot, 0.0 in Week 4 and missed Week 5. Kansas City allows the fewest WR points.', 'WR'],
];

const PIVOTS = [
  ['Lamar out', 'Huntley is a 2QB pivot only (24.0 in relief). Henry and Flowers are starts as written. Decide at about 11:30a ET.'],
  ['Caleb Williams out', 'No Chicago quarterback is called. Swap to a quarterback who kicks off at 4:05p or later.'],
  ['Olave out', 'Vele is the WR1 and a flex either way. Juwan Johnson gets more.'],
  ['Bowers out', 'Carry a later tight end: Kincaid or Kelce in the same window, Kraft on Sunday night, Kittle on Monday.'],
  ['Montgomery out (already)', 'Woody Marks is the start, RB16.'],
  ['Hall out (already)', 'Braelon Allen is a flex, RB18.'],
  ['Charbonnet out (already)', 'Emanuel Wilson is a flex, RB21.'],
  ['Mayfield out (already)', 'Daniels is a sit. Irving is the safe piece of the offense and the Steelers D/ST starts.'],
  ['Monangai out (already)', 'Swift is the start, RB12.'],
  ['Moore out', 'Shakir is a flex (WR23) with more targets.'],
  ['Love out', 'Allgeier is a sit regardless. McBride and Michael Wilson carry the Arizona offense.'],
  ['Diggs out', 'McLaurin is a flex (WR27). No other Washington receiver is called, and Monday night leaves no pivot.'],
  ['Barkley and Smith out', 'Both are sits. Goedert is the start and the Carolina trio is the play.'],
];

// Rulings are [id, lines]; lines are [name, position, team, verdict, reason].

const RULINGS = [
  [
    'C1',
    [
      ['Jaxon Smith-Njigba', 'WR', 'SEA', 'START', 'Full practice on the ankle, no designation; 36% target share, 28.1 points a game'],
    ],
  ],
  [
    'C2',
    [
      ['Zach Charbonnet', 'RB', 'SEA', 'OUT', 'Ruled out Wednesday with the knee; the engine still projects him 12.4, ignore it'],
      ['Emanuel Wilson', 'RB', 'SEA', 'FLEX', 'Lead back with Charbonnet out; 14.6 carries a game and Denver allows the 7th-most RB points'],
    ],
  ],
  [
    'C3',
    [
      ['Sam Darnold', 'QB', 'SEA', 'SIT', 'Total of 40.5 at altitude, five picks in three games, 12.4 points a game'],
    ],
  ],
  [
    'C4',
    [
      ['Bo Nix', 'QB', 'DEN', 'SIT', 'Seattle allows the 5th-fewest QB points; 7.9 last week'],
    ],
  ],
  [
    'C5',
    [
      ['RJ Harvey', 'RB', 'DEN', 'FLEX', '17% target share, the passing-down back in a split; low-end flex'],
      ['J.K. Dobbins', 'RB', 'DEN', 'SIT', 'Early-down half of the split, 1.2 targets a game'],
    ],
  ],
  [
    'C6',
    [
      ['SEA D/ST', 'DEF', 'SEA', 'START', '12.4 points a game, Denver implied for 19'],
    ],
  ],
  [
    'C7',
    [
      ['Jaylen Waddle', 'WR', 'DEN', 'SIT', 'Seattle allows the 2nd-fewest WR points; 9.7 a game'],
    ],
  ],
  [
    'C8',
    [
      ['Nico Collins', 'WR', 'HOU', 'START', 'Rest day only; 26% target share, Jacksonville allows the 9th-most WR points'],
    ],
  ],
  [
    'C9',
    [
      ['David Montgomery', 'RB', 'HOU', 'OUT', 'Did not practice, week-to-week groin, Doubtful in our database'],
      ['Woody Marks', 'RB', 'HOU', 'START', 'The lead back while Montgomery is out: 15 carries and 4 catches after he left Week 5'],
    ],
  ],
  [
    'C10',
    [
      ['Parker Washington', 'WR', 'JAX', 'START', '25% target share, Houston allows the 3rd-most WR points'],
    ],
  ],
  [
    'C11',
    [
      ['Trevor Lawrence', 'QB', 'JAX', 'START', 'Houston is middle of the pack against QBs (18th) and Lawrence is 17.4 a game with a 21.7 last week; QB10'],
    ],
  ],
  [
    'C12',
    [
      ['C.J. Stroud', 'QB', 'HOU', 'SIT', '15.4 projected, a 42.5 total in London'],
    ],
  ],
  [
    'C13',
    [
      ['Bhayshul Tuten', 'RB', 'JAX', 'FLEX', '16.4 carries a game and Houston allows the 3rd-fewest RB points; volume flex'],
    ],
  ],
  [
    'C14',
    [
      ['Brian Thomas Jr.', 'WR', 'JAX', 'SIT', '13% target share, 5.3 points a game'],
    ],
  ],
  [
    'C15',
    [
      ['Lamar Jackson', 'QB', 'BAL', 'START if active', 'Did not practice Wednesday on the ankle, day-to-day; 19.8 a game when he plays'],
      ['Tyler Huntley', 'QB', 'BAL', 'SIT', 'Starts only if Lamar is out; 24.0 in relief last week makes him a 2QB pivot'],
    ],
  ],
  [
    'C16',
    [
      ['Derrick Henry', 'RB', 'BAL', 'START', '22.6 carries a game, Baltimore favored by 5.5'],
    ],
  ],
  [
    'C17',
    [
      ['Zay Flowers', 'WR', 'BAL', 'START', '30% target share, Cleveland allows the 7th-most WR points'],
    ],
  ],
  [
    'C18',
    [
      ['Quinshon Judkins', 'RB', 'CLE', 'SIT', 'Did not practice on the ankle and Dylan Sampson did not either; do not chase the Cleveland backfield'],
    ],
  ],
  [
    'C19',
    [
      ['Denzel Boston', 'WR', 'CLE', 'FLEX if active', 'Limited on the foot; 20% target share and 92% of snaps, 14.0 a game'],
    ],
  ],
  [
    'C20',
    [
      ['Mark Andrews', 'TE', 'BAL', 'SIT', '8.7 a game, 4.8 last week'],
    ],
  ],
  [
    'C21',
    [
      ['Tetairoa McMillan', 'WR', 'CAR', 'START', '27% target share, Philadelphia allows the 5th-most WR points'],
    ],
  ],
  [
    'C22',
    [
      ['Bryce Young', 'QB', 'CAR', 'START', '22.7 a game on 41 attempts, full practice on the knee'],
    ],
  ],
  [
    'C23',
    [
      ['Chuba Hubbard', 'RB', 'CAR', 'START', '78% of snaps, 19.8 a game'],
    ],
  ],
  [
    'C24',
    [
      ['Jalen Coker', 'WR', 'CAR', 'FLEX', 'Full practice on the quad, 21% target share, Legette on IR'],
    ],
  ],
  [
    'C25',
    [
      ['Saquon Barkley', 'RB', 'PHI', 'SIT', 'Did not practice on the hamstring; 5.8 points a game before the injury'],
    ],
  ],
  [
    'C26',
    [
      ['DeVonta Smith', 'WR', 'PHI', 'SIT', 'Did not practice, missed the last two games; a Friday upgrade would not make him safe'],
    ],
  ],
  [
    'C27',
    [
      ['Dallas Goedert', 'TE', 'PHI', 'START', 'Led the team in targets in his return; Carolina allows the 8th-most TE points'],
    ],
  ],
  [
    'C28',
    [
      ['Jalen Hurts', 'QB', 'PHI', 'SIT', '16.0 a game, a 40.5 total and no Smith or Barkley; QB14'],
    ],
  ],
  [
    'C29',
    [
      ['Caleb Williams', 'QB', 'CHI', 'START if active', 'Full practice on the hamstring after missing three games; Atlanta allows the 9th-most QB points, 51.5 total'],
    ],
  ],
  [
    'C30',
    [
      ['Bijan Robinson', 'RB', 'ATL', 'START', '24.2 a game, the RB1 this week'],
    ],
  ],
  [
    'C31',
    [
      ['D\'Andre Swift', 'RB', 'CHI', 'START', 'Monangai did not practice; Swift gets the work'],
      ['Kyle Monangai', 'RB', 'CHI', 'SIT', 'Did not practice on the toe and thumb'],
    ],
  ],
  [
    'C32',
    [
      ['Drake London', 'WR', 'ATL', 'START', '29% target share with Penix full in practice'],
    ],
  ],
  [
    'C33',
    [
      ['Luther Burden III', 'WR', 'CHI', 'FLEX', '22% target share, Atlanta allows the 6th-most WR points'],
    ],
  ],
  [
    'C34',
    [
      ['Michael Penix Jr.', 'QB', 'ATL', 'SIT', 'Full practice on the ribs but 13.7 a game on 26 attempts'],
    ],
  ],
  [
    'C35',
    [
      ['Kyle Pitts Sr.', 'TE', 'ATL', 'SIT', 'Chicago allows the 2nd-fewest TE points; 5.5 a game'],
    ],
  ],
  [
    'C36',
    [
      ['Rome Odunze', 'WR', 'CHI', 'SIT', '18% target share, 8.7 a game, third in line behind Burden and Raymond'],
    ],
  ],
  [
    'C37',
    [
      ['Chris Olave', 'WR', 'NO', 'START if active', 'Did not practice Wednesday with an illness, not an injury; 28% target share'],
      ['Devaughn Vele', 'WR', 'NO', 'FLEX', 'The WR1 if Olave sits, a flex either way at 20% target share'],
    ],
  ],
  [
    'C38',
    [
      ['Cam Skattebo', 'RB', 'NYG', 'START', 'New Orleans allows the most RB points in the league'],
    ],
  ],
  [
    'C39',
    [
      ['Malik Nabers', 'WR', 'NYG', 'START', '20 targets last week, 52.3 points over the last two with Winston'],
    ],
  ],
  [
    'C40',
    [
      ['Isaiah Likely', 'TE', 'NYG', 'START', '30% target share, full practice on the foot'],
    ],
  ],
  [
    'C41',
    [
      ['Juwan Johnson', 'TE', 'NO', 'START', '17% target share, more if Olave is limited'],
    ],
  ],
  [
    'C42',
    [
      ['Jameis Winston', 'QB', 'NYG', 'SIT', '25.7 last week but a streamer at best; QB16'],
    ],
  ],
  [
    'C43',
    [
      ['Tyler Shough', 'QB', 'NO', 'SIT', '0.8 last week, a 45.5 total'],
    ],
  ],
  [
    'C44',
    [
      ['Alvin Kamara', 'RB', 'NO', 'SIT', 'Limited with a back injury, 32% of snaps'],
    ],
  ],
  [
    'C45',
    [
      ['Breece Hall', 'RB', 'NYJ', 'OUT', 'Has not practiced since Week 3, week-to-week quad'],
      ['Braelon Allen', 'RB', 'NYJ', 'FLEX', '18.6 as the lead back last week; New England favored by 7.5 caps the script'],
    ],
  ],
  [
    'C46',
    [
      ['Garrett Wilson', 'WR', 'NYJ', 'START', '30% target share, 11 targets last week'],
    ],
  ],
  [
    'C47',
    [
      ['Drake Maye', 'QB', 'NE', 'START', '65.6 points over the last two weeks, the Jets allow the 6th-fewest QB points; QB12'],
    ],
  ],
  [
    'C48',
    [
      ['Rhamondre Stevenson', 'RB', 'NE', 'START', 'Henderson limited with a high ankle sprain; 35.9 over the last two weeks'],
    ],
  ],
  [
    'C49',
    [
      ['NE D/ST', 'DEF', 'NE', 'START', '7.5-point favorites, the Jets implied for 18'],
    ],
  ],
  [
    'C50',
    [
      ['Geno Smith', 'QB', 'NYJ', 'SIT', 'New England allows the 10th-fewest QB points'],
    ],
  ],
  [
    'C51',
    [
      ['A.J. Brown', 'WR', 'NE', 'SIT', 'Limited on the high ankle sprain coming off IR; wait a week'],
    ],
  ],
  [
    'C52',
    [
      ['Jaylen Warren', 'RB', 'PIT', 'START', '86% of snaps, 36.8 last week; Dowdle\'s return trims him, it does not bench him'],
    ],
  ],
  [
    'C53',
    [
      ['Baker Mayfield', 'QB', 'TB', 'OUT', 'Did not practice on the thumb, Doubtful; Jalon Daniels expected to start'],
      ['Jalon Daniels', 'QB', 'TB', 'SIT', '13.9 last week on 18 attempts; 17 mph wind'],
    ],
  ],
  [
    'C54',
    [
      ['PIT D/ST', 'DEF', 'PIT', 'START', 'Against Daniels in the wind, Tampa implied for 18.5'],
    ],
  ],
  [
    'C55',
    [
      ['Pat Freiermuth', 'TE', 'PIT', 'START', '21.5 last week, Pittman on IR and two receivers out'],
    ],
  ],
  [
    'C56',
    [
      ['Bucky Irving', 'RB', 'TB', 'START', '31.5 last week, the safest piece of a backup-QB offense'],
    ],
  ],
  [
    'C57',
    [
      ['Emeka Egbuka', 'WR', 'TB', 'FLEX', '23% target share, but a backup QB in the wind; WR29'],
    ],
  ],
  [
    'C58',
    [
      ['DK Metcalf', 'WR', 'PIT', 'SIT', '9.7 a game, 17 mph wind, Tampa allows the 10th-fewest WR points'],
    ],
  ],
  [
    'C59',
    [
      ['Jonathan Taylor', 'RB', 'IND', 'START', 'Rest day only, Tennessee is 21st in RB points allowed, so this is a volume start'],
    ],
  ],
  [
    'C60',
    [
      ['Tyler Warren', 'TE', 'IND', 'START', '21% target share, 21.4 last week'],
    ],
  ],
  [
    'C61',
    [
      ['Tony Pollard', 'RB', 'TEN', 'FLEX', 'Rest day only; 13.6 carries a game in a 7-point dog script'],
    ],
  ],
  [
    'C62',
    [
      ['Cam Ward', 'QB', 'TEN', 'SIT', '12.3 a game, 5.0 last week'],
    ],
  ],
  [
    'C63',
    [
      ['Keenan Allen', 'WR', 'IND', 'FLEX', 'Rest day only, 21% target share with Pierce on IR'],
    ],
  ],
  [
    'C64',
    [
      ['Puka Nacua', 'WR', 'LAR', 'START', '34% target share, the WR1'],
    ],
  ],
  [
    'C65',
    [
      ['Matthew Stafford', 'QB', 'LAR', 'START', '43 attempts a game, Arizona allows the 3rd-most QB points, Rams implied for 32'],
    ],
  ],
  [
    'C66',
    [
      ['Kyren Williams', 'RB', 'LAR', 'START', '22.1 a game, Rams 12.5-point favorites'],
    ],
  ],
  [
    'C67',
    [
      ['Davante Adams', 'WR', 'LAR', 'START', '23% target share, 22.1 last week'],
    ],
  ],
  [
    'C68',
    [
      ['Trey McBride', 'TE', 'ARI', 'START', '30% target share; the Rams allow the fewest TE points but trailing volume carries him'],
    ],
  ],
  [
    'C69',
    [
      ['Jeremiyah Love', 'RB', 'ARI', 'SIT', 'Did not practice on the ankle, the team wants to "get this ankle right"'],
      ['Tyler Allgeier', 'RB', 'ARI', 'SIT', 'Takes the carries if Love sits, but a 12.5-point dog\'s carries'],
    ],
  ],
  [
    'C70',
    [
      ['Michael Wilson', 'WR', 'ARI', 'FLEX', '26% target share in a game Arizona trails'],
    ],
  ],
  [
    'C71',
    [
      ['LAR D/ST', 'DEF', 'LAR', 'START', 'Arizona implied for 19.5'],
    ],
  ],
  [
    'C72',
    [
      ['Josh Allen', 'QB', 'BUF', 'START', 'QB1, Bills implied for 29.5 in a dome'],
    ],
  ],
  [
    'C73',
    [
      ['James Cook III', 'RB', 'BUF', 'START', '19.0 carries a game, Las Vegas allows the 11th-most RB points'],
    ],
  ],
  [
    'C74',
    [
      ['Brock Bowers', 'TE', 'LV', 'START if active', 'Limited on the knee; 23.7 a game on a 31% target share'],
    ],
  ],
  [
    'C75',
    [
      ['Ashton Jeanty', 'RB', 'LV', 'START', 'Full practice, Buffalo allows the 4th-most RB points'],
    ],
  ],
  [
    'C76',
    [
      ['DJ Moore', 'WR', 'BUF', 'SIT', 'Did not practice on the shoulder, listed Doubtful last week'],
      ['Khalil Shakir', 'WR', 'BUF', 'FLEX', '20% target share, more with Moore out, 53.5 total'],
    ],
  ],
  [
    'C77',
    [
      ['Tre Tucker', 'WR', 'LV', 'FLEX', 'Buffalo allows the most WR points in the league'],
    ],
  ],
  [
    'C78',
    [
      ['Kirk Cousins', 'QB', 'LV', 'START', '53.5 total, Buffalo allows the 4th-most QB points; QB11'],
    ],
  ],
  [
    'C79',
    [
      ['Dalton Kincaid', 'TE', 'BUF', 'START', 'Las Vegas allows the 5th-most TE points; 9.2 over the last three is the risk'],
    ],
  ],
  [
    'C80',
    [
      ['Patrick Mahomes', 'QB', 'KC', 'START', 'Full practice on the knee, Chiefs implied for 25.5'],
    ],
  ],
  [
    'C81',
    [
      ['Kenneth Walker III', 'RB', 'KC', 'START', '27.5 a game, 21.8 carries'],
    ],
  ],
  [
    'C82',
    [
      ['Travis Kelce', 'TE', 'KC', 'START', 'TE4 on role, not matchup: the Chargers are 25th in TE points allowed'],
    ],
  ],
  [
    'C83',
    [
      ['KC D/ST', 'DEF', 'KC', 'START', 'Chargers implied for 17, Herbert 11.0 a game'],
    ],
  ],
  [
    'C84',
    [
      ['Rashee Rice', 'WR', 'KC', 'SIT', 'Did not practice on the hamstring and knee; Reid would not commit'],
    ],
  ],
  [
    'C85',
    [
      ['Justin Herbert', 'QB', 'LAC', 'SIT', '11.0 a game, Kansas City allows the 3rd-fewest QB points'],
    ],
  ],
  [
    'C86',
    [
      ['Omarion Hampton', 'RB', 'LAC', 'FLEX', '14.6 carries a game, the RB19'],
    ],
  ],
  [
    'C87',
    [
      ['Ladd McConkey', 'WR', 'LAC', 'SIT', 'Limited on the foot, 0.0 in Week 4 and missed Week 5; Kansas City allows the fewest WR points'],
    ],
  ],
  [
    'C88',
    [
      ['CeeDee Lamb', 'WR', 'DAL', 'START', 'Full practice, 27% target share; 2.9 last week was the outlier'],
    ],
  ],
  [
    'C89',
    [
      ['Javonte Williams', 'RB', 'DAL', 'START', 'Green Bay allows the 2nd-most RB points'],
    ],
  ],
  [
    'C90',
    [
      ['Jordan Love', 'QB', 'GB', 'START', 'Dallas allows the 5th-most QB points, 53.5 total'],
    ],
  ],
  [
    'C91',
    [
      ['Christian Watson', 'WR', 'GB', 'START', '21.9 a game, 32.3 last week'],
    ],
  ],
  [
    'C92',
    [
      ['Matthew Golden', 'WR', 'GB', 'START', '24% target share, 20.3 last week'],
    ],
  ],
  [
    'C93',
    [
      ['George Pickens', 'WR', 'DAL', 'START', '22% target share, 53.5 total'],
    ],
  ],
  [
    'C94',
    [
      ['Tucker Kraft', 'TE', 'GB', 'START', '86% of snaps, the TE10'],
    ],
  ],
  [
    'C95',
    [
      ['MarShawn Lloyd', 'RB', 'GB', 'FLEX', 'Jacobs on the Exempt list, Lloyd 16.7 last week; Dallas allows the 8th-most RB points'],
    ],
  ],
  [
    'C96',
    [
      ['Dak Prescott', 'QB', 'DAL', 'SIT', 'Green Bay allows the 4th-fewest QB points; QB13'],
    ],
  ],
  [
    'C97',
    [
      ['Brock Purdy', 'QB', 'SF', 'START', 'Washington allows the 2nd-most QB points'],
    ],
  ],
  [
    'C98',
    [
      ['Christian McCaffrey', 'RB', 'SF', 'START', '18.3 a game; Washington\'s run defense is stout but the catches hold'],
    ],
  ],
  [
    'C99',
    [
      ['Mike Evans', 'WR', 'SF', 'START', '25% target share with Deebo Samuel out'],
    ],
  ],
  [
    'C100',
    [
      ['George Kittle', 'TE', 'SF', 'START', 'Washington allows the 3rd-most TE points'],
    ],
  ],
  [
    'C101',
    [
      ['Jayden Daniels', 'QB', 'WSH', 'START', '32.3 in his return, 7 carries a game; QB8'],
    ],
  ],
  [
    'C102',
    [
      ['Terry McLaurin', 'WR', 'WSH', 'FLEX', '22% target share, 12.2 in Week 5'],
    ],
  ],
  [
    'C103',
    [
      ['Stefon Diggs', 'WR', 'WSH', 'SIT', 'Hamstring, no Washington practice report before Thursday; Monday night leaves no pivot'],
    ],
  ],
  [
    'C104',
    [
      ['Jacory Croskey-Merritt', 'RB', 'WSH', 'FLEX', 'Deep-league flex only: 13.4 carries a game, San Francisco allows the 10th-most RB points, Washington a 7.5-point dog'],
    ],
  ],
];

const CHECK_THU = [
  ['Zach Charbonnet (SEA RB).', 'Out. Emanuel Wilson is the FLEX.'],
  ['Jaxon Smith-Njigba (SEA WR).', 'Full practice, no designation. Start him.'],
  ['Everyone else on the card.', 'No pivot cover on Thursday: set the lineup before the 6:45p ET inactives.'],
];

const CHECK_LONDON = [
  ['David Montgomery (HOU RB).', 'Doubtful in our database. Marks is the START.'],
  ['Nico Collins (HOU WR).', 'Rest only. Start him.'],
  ['Everyone on the card.', 'London locks first and nothing has played before it. Check about 8:00a ET.'],
];

const CHECK_ONE = [
  ['Lamar Jackson (BAL QB), about 11:30a ET.', 'Active: START. Out: Huntley is a 2QB pivot only.'],
  ['Caleb Williams (CHI QB).', 'Active: START. Full practice.'],
  ['Chris Olave (NO WR).', 'Active: START. Out: Vele is the WR1.'],
  ['Denzel Boston (CLE WR).', 'Active: FLEX. Limited on the foot.'],
  ['Jonathan Taylor (IND RB) and Keenan Allen (IND WR).', 'Rest days only. Taylor starts, Allen flexes.'],
  ['Tony Pollard (TEN RB).', 'Rest day only. Flex.'],
  ['Saquon Barkley and DeVonta Smith (PHI).', 'Sits either way. If both are inactive, Goedert is still the start.'],
  ['Hall, Judkins and Monangai.', 'Already printed OUT or SIT. Swift is the START in Chicago.'],
];

const CHECK_LATE = [
  ['Brock Bowers (LV TE), about 2:55p ET.', 'Active: START. Out: swap to a later tight end.'],
  ['DJ Moore (BUF WR).', 'A sit either way. Shakir is the FLEX.'],
  ['Rashee Rice (KC WR) and Ladd McConkey (LAC WR).', 'Sits either way.'],
  ['Jeremiyah Love (ARI RB).', 'A sit either way. Allgeier is a sit too.'],
];

const CHECK_SNF = [
  ['CeeDee Lamb (DAL WR), about 6:50p ET.', 'Full practice. Start him.'],
  ['Josh Jacobs (GB RB).', 'On the Exempt list. Lloyd is the FLEX.'],
];

const CHECK_MNF = [
  ['Stefon Diggs (WSH WR), about 6:45p ET Monday.', 'A sit. No Washington practice report before Thursday, and Monday night leaves no pivot.'],
  ['Everyone on the card.', 'Monday is the last window, so there is no later swap.'],
];

const Body = () => (
  <>
    <HeroBanner />

    <Lead>
      Fourteen games, Thursday through Monday, and four teams on bye. Seattle at Denver kicks off
      Thursday night, Houston at Jacksonville kicks off Sunday at 9:30 a.m. ET in London, and
      Washington at San Francisco closes it Monday night. Lamar Jackson did not practice Wednesday,
      Saquon Barkley did not either, and Zach Charbonnet is out. Every call is here. Set your
      Thursday lineup first, and set your pivots before you go to bed Saturday.
    </Lead>

    <Note title="Read this first">
      <strong>Lines and weather are our database as of Oct 15, 14:02Z. Injury notes are the
      Wednesday practice reports, and no Thursday report existed for the Sunday teams when I wrote
      this.</strong>{' '}
      Friday&apos;s reports can change any of it. The lines can differ from the Tuesday numbers in
      the waiver report. Fox and bet365 agree with the database except Baltimore (-4.5 there, -5.5
      here) and Chicago (-3 at a 49.5 total there, -1.5 at 51.5 here); I use the database. Re-check
      the Friday reports and the inactives before you lock anything. Every window below says when
      the inactives drop, and every time on this page is Eastern.
    </Note>

    <P>
      Scoring is PPR. &quot;Proj&quot; is our Week 6 PPR projection from the scheduled capture on
      Oct 15 at 00:19Z. Where the projection is a placeholder or a number that cannot be trusted, I
      say so and lean on usage. Cincinnati, Detroit, Miami and Minnesota are on bye, so 28 teams
      play, and nobody from those four is ranked or called.
    </P>
    <RailList
      items={[
        ['Usage lines', 'read wk1/wk2/wk3/wk4/wk5. c = carries, t = targets, pa = pass attempts, pts = PPR points by week. "--" means the player did not play that week. Week-1 snap share is unknown everywhere.'],
        ['FPA rank', '1 means the defense allows the most points to that position (a good matchup), 32 the fewest (tough). Weeks 1 to 5, garbage time included.'],
        ['Verdicts', 'START, FLEX, SIT and OUT are the rulings. "If active" calls are void if the player does not appear, and they sit in the game-time group of each card.'],
        ['Tiers', 'QB 14, RB 24, WR 30, TE 14 and D/ST 8, in the order I rank them. A written reason beats the projection column. A player ranked without a ruling says so.'],
        ['Ruling links', 'Every call on a card links to its Darkness Ruling (C1 to C104) with the reason.'],
      ]}
    />

    <JumpGrid />

    <H2>The Slate Board</H2>
    <P>
      Every game, in kickoff order with Thursday first: line, total, weather and both implied totals
      on one scale. Filled bars are the favorites. Buffalo at Las Vegas and Dallas at Green Bay
      (53.5 each) are the shootouts, and the Rams are implied for 32.0 against Arizona, the biggest
      number on the board. Pittsburgh at Tampa Bay (39.5) is the lowest total, and the Chargers
      (17.0) are the lowest implied team. The Rams (-12.5), Kansas City (-8.5), New England (-7.5),
      San Francisco (-7.5) and Indianapolis (-7) are the big favorites.
    </P>
    <SlateBoard />
    <P>
      Wind is the weather story. Pittsburgh at Tampa Bay has 17 mph, Chicago at Atlanta has 15 mph
      outside and I do not know whether the roof is open, and Washington at San Francisco has 12
      mph. No outdoor game with a forecast has more than a 5% chance of precipitation. Arizona at
      the Rams and Buffalo at Las Vegas are in domes, and Seattle at Denver is 52F on Thursday
      night. I have no forecast for London. I have no number for what wind does to a stat line, so
      there are no point adjustments, only a tiebreak toward rushers.
    </P>

    <H2>The Injury Board</H2>
    <P>
      Practice reports are Wednesday. The decision rules are simple, and I apply them the same way
      to every name on this page.
    </P>
    <RailList
      color="var(--warning)"
      items={[
        ['Rest days', 'Collins, Taylor, Keenan Allen and Pollard sat for rest only. They get no downgrade.'],
        ['"If active" calls', 'are void if the player does not appear. Every call that turns on a practice report, his or his teammate\'s, carries the injury on its card.'],
        ['Engine placeholders', 'never rank anyone. Charbonnet projects 12.4 and is out. Barkley\'s 10.8 mean is 5.8 a game in reality.'],
        ['A swap only works', 'if your bench player kicks off at or after the player he replaces. Thursday and London players have no cover at all.'],
        ['Byes', 'Cincinnati, Detroit, Miami and Minnesota: nobody is ranked or called.'],
      ]}
    />
    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, my: 2 }}>
      <Chip tone="var(--accent)">Thursday: about 6:45p ET</Chip>
      <Chip tone="var(--accent)">London: about 8:00a ET</Chip>
      <Chip tone="var(--accent)">1:00p games: about 11:30a ET</Chip>
      <Chip tone="var(--accent)">4:05p / 4:25p: about 2:35p / 2:55p ET</Chip>
      <Chip tone="var(--accent)">SNF: about 6:50p ET</Chip>
      <Chip tone="var(--accent)">MNF: about 6:45p ET Monday</Chip>
    </Box>

    <InjuryGroup title="Out, or treat as out" when="Thursday and London players have no pivot cover." rows={INJ_OUT} />
    <InjuryGroup title="Thursday" when="Inactives about 6:45p ET; no pivot cover" rows={INJ_THU} />
    <InjuryGroup title="London" when="Inactives about 8:00a ET" rows={INJ_LONDON} />
    <InjuryGroup title="1:00p games" when="Inactives about 11:30a ET" rows={INJ_ONE} />
    <InjuryGroup title="Late window" when="Inactives about 2:35p / 2:55p ET" rows={INJ_LATE} />
    <InjuryGroup title="Sunday and Monday night" when="Inactives about 6:50p ET / 6:45p ET Monday" rows={INJ_NIGHT} />
    <Box component="h3" sx={{ m: '24px 0 8px !important', fontSize: '1.15rem !important' }}>Already out for the week or longer</Box>
    <Box component="p" sx={{ mt: '0 !important', fontSize: '0.92rem', color: 'var(--text-muted)', lineHeight: 1.6 }}>
      {ALREADY_OUT.join('; ')}.
    </Box>

    <H2>Thursday Night</H2>
    <P>
      One game, and it locks first. The inactives drop about 6:45p ET and there is no pivot cover:
      whoever you start Thursday night is locked, and a late scratch cannot be fixed. Set the
      lineup before you do anything else on Thursday.
    </P>
    {SLOT('thu')}

    <H2>London</H2>
    <P>
      Houston at Jacksonville is at Wembley and kicks off at 9:30a ET Sunday morning, before every
      other Sunday game. The inactives drop about 8:00a ET. Nothing has played before it, so a swap
      has to come from a bench player in a later game.
    </P>
    {SLOT('london')}

    <H2>The 1:00p Window</H2>
    <P>
      Seven games at 1:00p ET. Nothing kicks between 1:00p and 4:05p, so a 1:00p decision needs a
      4:05p-or-later swap on your bench. Inactives about 11:30a ET.
    </P>
    {SLOT('one')}

    <H2>Late Window</H2>
    <P>
      Three games at 4:05p and 4:25p. These are pivot-safe after the early slate: you can see the
      1:00p inactives and the early scores before you decide.
    </P>
    {SLOT('late')}

    <H2>Prime Time</H2>
    <P>
      Sunday night is Dallas at Green Bay at 8:20p ET. Monday night is Washington at San
      Francisco at 8:15p ET, and my Monday injury data is Wednesday-only, so hold it loosely.
    </P>
    {SLOT('prime')}

    <H2>Position Tiers</H2>
    <P>
      The rankings for the Thursday through Monday slate, blended from projection, weeks 1 to 5
      usage, FPA rank and game total. The bands follow my written verdict on each player: START,
      FLEX or SIT. A player I ranked without a ruling is listed under his own band. The rank order
      and the projection column do not always agree: the context is the point.
    </P>
    <H3>Quarterback, top 14</H3>
    <TierBoard pos="QB" rows={QB_ROWS} next={QB_NEXT} />
    <H3>Running back, top 24</H3>
    <TierBoard pos="RB" rows={RB_ROWS} next={RB_NEXT} />
    <H3>Wide receiver, top 30</H3>
    <TierBoard pos="WR" rows={WR_ROWS} next={WR_NEXT} />
    <H3>Tight end, top 14</H3>
    <TierBoard pos="TE" rows={TE_ROWS} next={TE_NEXT} />
    <H3>D/ST, top 8</H3>
    <TierBoard pos="DST" rows={DST_ROWS} />

    <H2>Handcuff Board</H2>
    <P>
      The starter&apos;s report decides the handcuff, so read this beside the Injury Board. The
      verdict is for Week 6 and nothing else.
    </P>
    <Table aria-label="Week 6 handcuff board">
      <THead>
        <TR>
          <TH scope="col">Team</TH><TH scope="col">Starter and status</TH><TH scope="col">Handcuff</TH><TH scope="col">Verdict</TH>
        </TR>
      </THead>
      <TBody>
        {HANDCUFFS.map(([team, starter, cuff, verdict]) => (
          <TR key={team}><TD><strong>{team}</strong></TD><TD>{starter}</TD><TD><strong>{cuff}</strong></TD><TD>{verdict}</TD></TR>
        ))}
      </TBody>
    </Table>

    <H2>D/ST Streaming Board</H2>
    <P>
      The top eight, with the streamers beyond them. &quot;Opp implied&quot; is the points the
      opposing offense is expected to score. D/ST points are the weekly totals from our database,
      weeks 1 to 5. Seattle at Denver is the top number on the board: Seattle averages 12.4 a game
      and Denver is implied for 19.0. Minnesota projects 13.1 on a bye, which is the engine talking
      to itself.
    </P>
    <Table aria-label="Week 6 D/ST streaming board">
      <THead>
        <TR>
          <TH scope="col">D/ST</TH><TH scope="col">Opponent</TH><TH scope="col">Opp implied</TH><TH scope="col">D/ST pts wk1-5</TH><TH scope="col">Avg</TH><TH scope="col">Proj</TH><TH scope="col">Verdict</TH>
        </TR>
      </THead>
      <TBody>
        {DST_TABLE.map(([team, opp, imp, wk, av, pj, verdict]) => (
          <TR key={team}><TD><strong>{team}</strong></TD><TD>{opp}</TD><TD>{imp}</TD><TD>{wk}</TD><TD>{av}</TD><TD>{pj}</TD><TD>{verdict}</TD></TR>
        ))}
      </TBody>
    </Table>
    <P>{DST_NEXT}</P>

    <H2>IDP Streamers</H2>
    <P>
      IDP points by week from our database, weeks 1 to 5. Tackle volume is the currency at
      linebacker and safety; pressure is the currency on the line. Rostered percentages are not
      tracked for IDP, so check your own wire.
    </P>
    <Table aria-label="IDP streamers">
      <THead>
        <TR>
          <TH scope="col">Player</TH><TH scope="col">Team</TH><TH scope="col">Pos</TH><TH scope="col">Opp</TH><TH scope="col">IDP pts wk1-5</TH><TH scope="col">Note</TH>
        </TR>
      </THead>
      <TBody>
        {IDP_TABLE.map(([name, team, pos, opp, wk, note]) => (
          <TR key={name}><TD><strong>{name}</strong></TD><TD>{team}</TD><TD>{pos}</TD><TD>{opp}</TD><TD>{wk}</TD><TD>{note}</TD></TR>
        ))}
      </TBody>
    </Table>
    <P>{IDP_AVOID}</P>

    <H2>Sleepers, Fades and Pivots</H2>
    <H3>Sleepers</H3>
    <P>Low-profile usage plays. I do not have ownership percentages, so check your own wire.</P>
    <RailList color="var(--success)" items={SLEEPERS} />
    <H3>Busts and fades</H3>
    <RailList color="var(--danger)" items={FADES} />
    <H3>If he is out, pivot to</H3>
    <P>
      The whole contingency list in one place. If the first name is out at his inactive window, this
      is your next move.
    </P>
    <RailList color="var(--warning)" items={PIVOTS} />

    <H2>The Darkness Rulings</H2>
    <P>
      One hundred and four rulings, C1 to C104, and 114 calls inside them. Each one is here with
      its reason, in the order the games kick off.
    </P>
    {RULINGS.map((r) => <RulingCard key={r[0]} r={r} />)}

    <H2>Inactives Checklist</H2>
    <P>
      Inactives drop about 90 minutes before each kickoff. Windows are Eastern time. Thursday and
      London are the first two windows and the only ones with no cover, so start there.
    </P>
    <WindowChecklist title="Thursday inactives" time="about 6:45p ET" rows={CHECK_THU} />
    <WindowChecklist title="London inactives" time="about 8:00a ET" rows={CHECK_LONDON} />
    <WindowChecklist title="1:00p inactives" time="about 11:30a ET" rows={CHECK_ONE} />
    <WindowChecklist title="4:05p and 4:25p inactives" time="about 2:35p and 2:55p ET" rows={CHECK_LATE} />
    <WindowChecklist title="Sunday night inactives" time="about 6:50p ET" rows={CHECK_SNF} />
    <WindowChecklist title="Monday night inactives" time="about 6:45p ET Monday" rows={CHECK_MNF} />

    <Quote>
      Start your studs, trust the usage over the name, and set your pivots before you go to bed
      Saturday. Friday&apos;s reports can change any of this, and I will not pretend they cannot.
    </Quote>
  </>
);

export default Body;
