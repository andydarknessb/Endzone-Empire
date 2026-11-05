import React from 'react';
import { Box } from '@mui/material';
import {
  Lead, P, H2, H3, Quote,
  Table, THead, TBody, TR, TH, TD,
} from '../../components/public/kit/Prose';
import { Note, Pill, Chip } from '../../components/public/kit/ArticleBits';
import { positionColorVar } from '../../components/public/kit/positionColor';

// Body only: the frontmatter lives in week9-start-sit-darkness-report.meta.js so listings can be
// built without loading this prose; content/articles/index.js loads it on demand.
//
// Every color below the hero is a theme token, so the board, cards and chips read in light and
// dark. The hero is a dark illustration in both themes, like the Week 3 start/sit banner.
//
// Reading key (also printed in the article): FPA rank: 1 = most points allowed (good matchup for the
// opposing position), 32 = fewest (tough). Weeks 1 to 8. Times are Eastern. Verdicts come from docs/editorial/week9-rulings.md.

const TONE = {
  start: { label: 'Start', color: 'var(--success)' },
  flex: { label: 'Flex', color: 'var(--accent)' },
  sit: { label: 'Sit', color: 'var(--danger)' },
  watch: { label: 'Game-time decisions', color: 'var(--warning)' },
};

function HeroBanner() {
  // Yard lines in perspective: t runs from 0 at the near edge to 1 at the far end line.
  const rows = [190, 222, 258, 296];
  return (
    <Box
      component="svg"
      viewBox="0 0 800 300"
      xmlns="http://www.w3.org/2000/svg"
      sx={{ width: '100%', borderRadius: 'var(--radius-md, 10px)', overflow: 'hidden', mb: 4, display: 'block' }}
      role="img"
      aria-labelledby="wk9ss-hero-title wk9ss-hero-desc"
    >
      <title id="wk9ss-hero-title">Week 9 Start/Sit: The Darkness Report</title>
      <desc id="wk9ss-hero-desc">
        A night stadium seen from one end: floodlight towers on both sides throw cones of light onto a
        field with yard lines that narrows to a far end line, with a goalpost in the middle. A football
        sits on the turf, and a dotted kick path rises toward the uprights. The headline Week 9
        Start/Sit sits in a panel across the bottom.
      </desc>
      <defs>
        <linearGradient id="wk9ss-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#04060c" />
          <stop offset="1" stopColor="#101a2c" />
        </linearGradient>
        <linearGradient id="wk9ss-beam" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#dbe7ff" stopOpacity="0.5" />
          <stop offset="1" stopColor="#dbe7ff" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="wk9ss-turf" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#123f2e" />
          <stop offset="1" stopColor="#07190f" />
        </linearGradient>
        <linearGradient id="wk9ss-kick" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="#ffd866" stopOpacity="0" />
          <stop offset="1" stopColor="#ffd866" stopOpacity="0.95" />
        </linearGradient>
      </defs>
      <rect width="800" height="300" fill="url(#wk9ss-sky)" />
      <rect x="0" y="150" width="800" height="150" fill="url(#wk9ss-turf)" />
      <path d="M60 300 L300 150 L500 150 L740 300" fill="none" stroke="#ffffff" strokeOpacity="0.22" />
      <path d="M300 150 L500 150" stroke="#ffffff" strokeOpacity="0.4" strokeWidth="2" />
      {rows.map((y) => {
        const t = (300 - y) / 150;
        return <line key={y} x1={60 + 240 * t} y1={y} x2={740 - 240 * t} y2={y} stroke="#ffffff" strokeOpacity="0.16" />;
      })}
      <path d="M110 36 L60 300 L340 300 Z M690 36 L460 300 L740 300 Z" fill="url(#wk9ss-beam)" />
      <path d="M110 150 L110 34 M690 150 L690 34" stroke="#3b4a66" strokeWidth="4" strokeLinecap="round" />
      <circle cx="110" cy="30" r="18" fill="#7eaaff" fillOpacity="0.3" />
      <circle cx="690" cy="30" r="18" fill="#7eaaff" fillOpacity="0.3" />
      <rect x="98" y="24" width="24" height="10" rx="2" fill="#dbe7ff" />
      <rect x="678" y="24" width="24" height="10" rx="2" fill="#dbe7ff" />
      <path d="M400 150 L400 112 M372 112 L428 112 M372 112 L372 58 M428 112 L428 58" fill="none" stroke="#ffd866" strokeWidth="3" strokeLinecap="round" />
      <path d="M150 196 C 210 40, 330 20, 400 84" fill="none" stroke="url(#wk9ss-kick)" strokeWidth="3" strokeLinecap="round" strokeDasharray="2 9" />
      <g transform="translate(150 196) rotate(-28) scale(0.7)">
        <ellipse rx="34" ry="19" fill="#6b3416" stroke="#ff8c42" strokeWidth="2" />
        <path d="M-13 -19 Q-18 0 -13 19 M13 -19 Q18 0 13 19" fill="none" stroke="#ffffff" strokeWidth="2" opacity="0.8" />
        <line x1="-10" y1="0" x2="10" y2="0" stroke="#ffffff" strokeWidth="2" strokeLinecap="round" />
        {[-6, 0, 6].map((x) => (
          <line key={x} x1={x} y1="-4" x2={x} y2="4" stroke="#ffffff" strokeWidth="1.6" strokeLinecap="round" />
        ))}
      </g>
      <text x="400" y="34" textAnchor="middle" fill="#8badc9" fontFamily="system-ui, sans-serif" fontWeight="700" fontSize="12" letterSpacing="4">THE DARKNESS REPORT</text>
      <rect x="110" y="216" width="580" height="68" rx="14" fill="#030814" fillOpacity="0.84" stroke="#7eaaff" strokeOpacity="0.25" />
      <text x="400" y="246" textAnchor="middle" fill="#ffffff" fontFamily="system-ui, sans-serif" fontWeight="850" fontSize="24" letterSpacing="1">WEEK 9 START/SIT</text>
      <text x="400" y="270" textAnchor="middle" fill="#8badc9" fontFamily="system-ui, sans-serif" fontWeight="600" fontSize="12" letterSpacing="2">WEEK 9 | THURSDAY TO MONDAY | 15 GAMES</text>
    </Box>
  );
}

// Implied points for both sides as one split bar: the filled side is the favorite.
function SplitBar({ away, home, awayPts, homePts }) {
  const awayPct = (awayPts / (awayPts + homePts)) * 100;
  return (
    <Box sx={{ mt: 1.75 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8125rem', fontWeight: 700, color: 'var(--text-muted)', mb: 0.5, fontVariantNumeric: 'tabular-nums' }}>
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
    return <Box component="span" sx={{ ml: 0.75, px: 0.75, borderRadius: '4px', bgcolor: 'var(--pos-k)', color: 'var(--text-inverse)', fontSize: '0.8125rem', fontWeight: 900, letterSpacing: '0.08em', verticalAlign: 'middle' }}>SMASH</Box>;
  }
  if (/^C\d+$/.test(flag || '')) {
    return (
      <Box component="a" href={`#ruling-${flag.toLowerCase()}`} sx={{ ml: 0.75, fontSize: '0.8125rem', fontWeight: 800, whiteSpace: 'nowrap' }}>
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
      <Box sx={{ fontSize: '0.8125rem', fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase', color, mb: 0.75 }}>
        {label}
      </Box>
      <Box component="ul" sx={{ listStyle: 'none', p: '0 !important', m: '0 !important', display: 'grid', gap: 0.75 }}>
        {items.map(([name, pos, why, rank, flag]) => (
          <Box
            component="li"
            key={name}
            sx={{ m: '0 !important', pl: 1.25, py: 0.4, borderLeft: '3px solid', borderColor: color, fontSize: '0.95rem', lineHeight: 1.5, overflowWrap: 'anywhere' }}
          >
            <Pill color={positionColorVar(String(pos).split('/')[0])}>{pos}</Pill>
            <strong>{name}</strong>
            {rank ? <Box component="span" sx={{ ml: 0.75, fontSize: '0.8125rem', fontWeight: 800, color: 'var(--text-muted)' }}>{rank}</Box> : null}
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
        <Box sx={{ fontSize: '0.8125rem', fontWeight: 700, color: 'var(--text-muted)' }}>{g.when}</Box>
      </Box>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mt: 1.25, alignItems: 'center' }}>
        <Chip soft tone="var(--accent)">{g.line}</Chip>
        <Chip>O/U {g.total}</Chip>
        {g.weather ? <Chip tone={g.rain ? 'var(--warning)' : 'var(--text-muted)'}>{g.weather}</Chip> : null}
      </Box>
      <SplitBar away={g.away} home={g.home} awayPts={g.awayPts} homePts={g.homePts} />
      <Box component="p" sx={{ mt: '16px !important', mb: '0 !important' }}>{g.read}</Box>
      <Box component="p" sx={{ mt: '8px !important', mb: '0 !important', fontSize: '0.8125rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
        Matchups (FPA rank, 1 = most allowed): {g.fpa}
      </Box>
      <CallList tone="start" items={g.start} />
      <CallList tone="flex" items={g.flex} />
      <CallList tone="watch" items={g.watch} />
      <CallList tone="sit" items={g.sit} />
      {g.also ? (
        <Box component="p" sx={{ mt: '14px !important', mb: '0 !important', fontSize: '0.85rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
          <strong>Also:</strong> {g.also}
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
            <Box sx={{ fontSize: '0.8125rem', fontWeight: 700, color: 'var(--text-muted)' }}>{g.kick} ET</Box>
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
            fontSize: '0.8125rem', fontWeight: 700, '&:hover': { borderColor: 'var(--accent)' },
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
                <Box component="span" sx={{ ml: 0.75, fontSize: '0.8125rem', fontWeight: 700, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{pos}, {team}</Box>
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

// One position board in bands that follow the written verdicts. Rows are [rank, name, team, note,
// band]; a player with no ruling is ranked without a call.
const BANDS = [
  { key: 'start', label: 'START', color: 'var(--success)' },
  { key: 'flex', label: 'FLEX', color: 'var(--accent)' },
  { key: 'sit', label: 'SIT', color: 'var(--danger)' },
  { key: 'rank', label: 'RANKED, NO CALL', color: 'var(--text-muted)' },
];
function TierBoard({ pos, rows, next }) {
  return (
    <Box sx={{ my: 3 }}>
      {BANDS.map((b) => {
        const inBand = rows.filter((r) => r[4] === b.key);
        if (!inBand.length) return null;
        return (
          <Box key={b.key} sx={{ mb: 1.75, borderLeft: '4px solid', borderLeftColor: b.color, pl: 1.5 }}>
            <Box sx={{ fontSize: '0.8125rem', fontWeight: 900, letterSpacing: '0.12em', color: b.color, mb: 0.25 }}>
              {b.label} &middot; {pos} {inBand.map((r) => r[0]).join(', ')}
            </Box>
            {inBand.map(([rk, name, team, note]) => (
              <Box key={`${rk}-${name}`} sx={{ display: 'grid', gridTemplateColumns: '1.9em 1fr', columnGap: 1, alignItems: 'baseline', py: 0.5, borderBottom: '1px solid var(--border-subtle)', fontSize: '0.92rem', lineHeight: 1.4 }}>
                <Box component="span" sx={{ fontWeight: 900, color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>{rk}</Box>
                <Box sx={{ minWidth: 0, overflowWrap: 'anywhere' }}>
                  <strong>{name}</strong> <Box component="span" sx={{ color: 'var(--text-muted)', fontSize: '0.8125rem', fontWeight: 700 }}>{team}</Box>
                  {note ? <Box sx={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>{note}</Box> : null}
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
              <Pill color={positionColorVar(String(pos).split('/')[0])}>{pos}</Pill>
              <strong>{name}</strong>
              <Box component="span" sx={{ ml: 0.75, fontSize: '0.8125rem', fontWeight: 700, color: 'var(--text-muted)' }}>{team}</Box>
              <Box component="span" sx={{ ml: 0.75, fontSize: '0.8125rem', fontWeight: 900, letterSpacing: '0.06em', color: verdictColor(verdict) }}>{verdict.toUpperCase()}</Box>
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
          {pos ? <Pill color={positionColorVar(String(pos).split('/')[0])}>{pos}</Pill> : null}
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

// Items are [name, position, why, rank, flag]. flag is a Darkness Ruling id (C4). Games are in kickoff order.
const GAMES = [
  {
    id: 'jax-bal',
    slot: 'thu',
    title: 'Jaguars at Ravens',
    kick: 'Thu 8:15p',
    when: 'Thursday Night · 8:15p ET',
    away: 'JAX',
    home: 'BAL',
    awayPts: 24.75,
    homePts: 14.75,
    line: 'JAX -10',
    total: 39.5,
    weather: '68F, wind 5, 21% rain showers',
    rain: false,
    read: 'Jacksonville is a 10-point road favorite with a 39.5 total, implied for 24.75 against Baltimore\'s 14.75, the lowest on the slate, and Trevor Lawrence (QB9) is a start. Lamar Jackson is out Thursday for thumb surgery and IR, and Tyler Huntley is out Thursday with a turf toe reported as season-ending, leaving Joe Fagnano next up and a sit, though no Thursday starter is confirmed. Zay Flowers is a sit after 0.0 on 5 targets last week, and Derrick Henry is a sit with Baltimore implied for 14.75. Bhayshul Tuten (RB12) is a start only if active after not practicing this week, and Chris Rodriguez Jr. is a sit that takes the lead job only if Tuten sits. The inactives drop about 6:45p ET Thursday and this game locks first at 8:15p ET, so make any swap between the two; nothing covers a scratch after kickoff.',
    fpa: 'JAX offense vs BAL D: QB 13, RB 25, WR 10, TE 18 · BAL offense vs JAX D: QB 24, RB 31, WR 5, TE 26',
    start: [
      ['Trevor Lawrence', 'QB', '19.1 a game; Jacksonville implied for 24.75 as a 10-point road favorite Thursday.', 'QB9', 'C9'],
      ['Jacksonville Jaguars', 'DEF', 'Baltimore implied for 14.75, the lowest on the slate, with Jackson and Huntley out; 24 last week.', 'DST2', 'C128'],
    ],
    flex: [
      ['Parker Washington', 'WR', '24% target share, 3.6 last week; Baltimore allows the 10th-most WR points.', 'WR18', 'C83'],
    ],
    watch: [
      ['Bhayshul Tuten', 'RB', 'START if active. Questionable Thursday (ankle, foot) after not practicing; 24.7 and 29.9 the last two, and Jacksonville is implied for 24.75.', 'RB12', 'C41'],
    ],
    sit: [
      ['Joe Fagnano', 'QB', 'Next up with Jackson and Huntley out; 10 of 21 for 91 yards and an interception last week, and Baltimore is implied for 14.75, the lowest on the slate.', null, 'C25'],
      ['Lamar Jackson', 'QB', 'OUT. Out Thursday, thumb surgery and IR; the engine still projects 13.9.', null, 'C26'],
      ['Tyler Huntley', 'QB', 'OUT. Out Thursday, turf toe reported as season-ending.', null, 'C27'],
      ['Chris Rodriguez Jr.', 'RB', 'Limited this week; the lead job only if Tuten sits; 12.8 last week on 6 carries.', null, 'C41'],
      ['Derrick Henry', 'RB', '5.0, 5.9 and 14.0 the last three; Baltimore implied for 14.75, and Jacksonville allows the 2nd-fewest RB points.', null, 'C54'],
      ['Zay Flowers', 'WR', '0.0 on 5 targets last week after Jackson and Huntley went down; Baltimore is implied for 14.75; the engine still projects 16.9.', null, 'C96'],
    ],
    also: 'Foyesade Oluokun (JAX LB) is on the IDP board.',
  },
  {
    id: 'cin-atl',
    slot: 'madrid',
    title: 'Bengals at Falcons',
    kick: 'Sun 9:30a',
    when: 'Sun 9:30a ET · Madrid',
    away: 'CIN',
    home: 'ATL',
    awayPts: 27.75,
    homePts: 24.75,
    line: 'CIN -3',
    total: 52.5,
    weather: 'Madrid, no forecast in our data',
    rain: false,
    read: 'Cincinnati is a 3-point favorite in Madrid with a 52.5 total, implied for 27.75 against Atlanta\'s 24.75. Joe Burrow (QB1) is a start on that number, and so are Ja\'Marr Chase (WR3) and Tee Higgins (WR4). Brian Robinson Jr. was limited Wednesday, so check the Madrid inactives at about 8:00a ET Sunday, the earliest window on the Sunday slate, before you lock Bijan Robinson (RB10). Zachariah Branch is out for Madrid, Drake London (WR15) is a start on a 29% target share, and Michael Penix Jr. is a sit with the 52.5 total making him a 2QB start.',
    fpa: 'CIN offense vs ATL D: QB 21, RB 5, WR 21, TE 15 · ATL offense vs CIN D: QB 16, RB 24, WR 13, TE 7',
    start: [
      ['Joe Burrow', 'QB', '28.9 and 39.5 the last two, 24.2 a game; Cincinnati implied for 27.75 in a 52.5 total in Madrid.', 'QB1', 'C1'],
      ['Bijan Robinson', 'RB', '19.2 a game with 19 carries last week; Brian Robinson Jr. was limited Wednesday; Cincinnati allows the 9th-fewest RB points in a 52.5 total.', 'RB10', 'C39'],
      ['Chase Brown', 'RB', '9 targets last week and 6.0 a game; Cincinnati implied for 27.75, and Atlanta allows the 5th-most RB points.', 'RB13', 'C42'],
      ['Ja\'Marr Chase', 'WR', '31.1 last week on 16 targets; Cincinnati implied for 27.75 in a 52.5 total.', 'WR3', 'C68'],
      ['Tee Higgins', 'WR', '26.8 and 37.5 the last two on a 23% target share.', 'WR4', 'C69'],
      ['Drake London', 'WR', '29% target share, 1.8 in the rain last week; Zachariah Branch is out, in a 52.5 total.', 'WR15', 'C80'],
      ['Mike Gesicki', 'TE', '17.6 last week with Erick All Jr. out for the season; Cincinnati implied for 27.75; TE12.', 'TE12', 'C120'],
    ],
    flex: [],
    watch: [],
    sit: [
      ['Michael Penix Jr.', 'QB', '-1.9 in the rain last week after 23.1 and 20.4; the 52.5 total makes him a 2QB start.', null, 'C16'],
      ['Kyle Pitts Sr.', 'TE', '23.0, 13.2 and 2.6 the last three; Cincinnati allows the 7th-most TE points; TE13.', 'TE13', 'C121'],
    ],
    also: null,
  },
  {
    id: 'cle-no',
    slot: 'one',
    title: 'Browns at Saints',
    kick: 'Sun 1:00p',
    when: 'Sun 1:00p ET',
    away: 'CLE',
    home: 'NO',
    awayPts: 19.75,
    homePts: 22.75,
    line: 'NO -3',
    total: 42.5,
    weather: 'Dome',
    rain: false,
    read: 'New Orleans is a 3-point favorite in a dome with a 42.5 total, implied for 22.75 against Cleveland\'s 19.75. Alvin Kamara did not practice Wednesday (rest, back), so he is a flex only if active (RB23), and the 1:00p inactives at about 11:30a ET settle it. Deshaun Watson did not practice Wednesday with a concussion and is a sit, and Quinshon Judkins (RB21) is a flex against a New Orleans defense that allows the most RB points. Chris Olave (WR10) and Harold Fannin Jr. (TE4) are starts, with Fannin facing a New Orleans defense that allows the 8th-most TE points, and Tyler Shough is a sit against a Cleveland defense that allows the 8th-fewest QB points.',
    fpa: 'CLE offense vs NO D: QB 17, RB 1, WR 16, TE 8 · NO offense vs CLE D: QB 25, RB 18, WR 20, TE 11',
    start: [
      ['Chris Olave', 'WR', '27% target share, 10.1 targets a game; Cleveland allows the 13th-fewest WR points.', 'WR10', 'C75'],
      ['Harold Fannin Jr.', 'TE', '23.4 on 12 targets last week; New Orleans allows the 8th-most TE points.', 'TE4', 'C112'],
    ],
    flex: [
      ['Quinshon Judkins', 'RB', '12.4 a game; New Orleans allows the most RB points, though Cleveland is implied for 19.75.', 'RB21', 'C50'],
      ['Devaughn Vele', 'WR', '19% target share, 16.4 before the bye.', 'WR29', 'C94'],
    ],
    watch: [
      ['Alvin Kamara', 'RB', 'FLEX if active. Did not practice Wednesday (rest, back); 14.9 and 13.2 before the bye with 4.5 targets a game.', 'RB23', 'C52'],
    ],
    sit: [
      ['Tyler Shough', 'QB', '18.1 a game off the bye, but 0.8 and 13.8 in two of the last three; Cleveland allows the 8th-fewest QB points.', null, 'C15'],
      ['Deshaun Watson', 'QB', 'Did not practice Wednesday (concussion); 11.2 last week and Cleveland is implied for 19.75.', null, 'C22'],
      ['Travis Etienne Jr.', 'RB', 'OUT. On IR (hamstring), practice window not opened; the engine still projects 11.9.', null, 'C64'],
    ],
    also: 'Kendre Miller, Kamara\'s handcuff, has no ruling.',
  },
  {
    id: 'dal-ind',
    slot: 'one',
    title: 'Cowboys at Colts',
    kick: 'Sun 1:00p',
    when: 'Sun 1:00p ET',
    away: 'DAL',
    home: 'IND',
    awayPts: 28.5,
    homePts: 23,
    line: 'DAL -5.5',
    total: 51.5,
    weather: '54F, wind 7, sunny',
    rain: false,
    read: 'Dallas is a 5.5-point favorite with a 51.5 total, implied for 28.5 against Indianapolis at 23. Dak Prescott (QB4), Javonte Williams (RB9), CeeDee Lamb (WR5) and Tyler Warren (TE6) are starts, with Warren facing a Dallas defense that allows the 12th-most TE points. Jonathan Taylor (RB6) is a start only if active, and he was limited Wednesday, while George Pickens (WR19) and Keenan Allen (WR22) are flex only if active, after Pickens was limited Wednesday and Allen did not practice. The 1:00p inactives at about 11:30a ET decide all three. Alec Pierce is on IR with no timetable, so he is out.',
    fpa: 'DAL offense vs IND D: QB 14, RB 9, WR 27, TE 14 · IND offense vs DAL D: QB 3, RB 4, WR 9, TE 12',
    start: [
      ['Dak Prescott', 'QB', '23.3 and 19.8 the last two; Dallas implied for 28.5 in a 51.5 total.', 'QB4', 'C4'],
      ['Javonte Williams', 'RB', '16.8 carries a game, 24 last week; Dallas implied for 28.5 and Indianapolis allows the 9th-most RB points.', 'RB9', 'C38'],
      ['CeeDee Lamb', 'WR', '32% target share, 11.5 targets a game; Dallas implied for 28.5.', 'WR5', 'C70'],
      ['Tyler Warren', 'TE', '23% target share, 10 targets in his return last week; Dallas allows the 12th-most TE points.', 'TE6', 'C114'],
    ],
    flex: [
      ['Josh Downs', 'WR', '20% target share, 12.3 last week; Allen did not practice Wednesday.', 'WR26', 'C91'],
      ['Ryan Flournoy', 'WR', '17.0, 11.0 and 13.1 the last three; Dallas implied for 28.5 and Pickens is limited.', 'WR28', 'C93'],
    ],
    watch: [
      ['Jonathan Taylor', 'RB', 'START if active. Limited Wednesday; 18.5 carries a game, and Dallas allows the 4th-most RB points.', 'RB6', 'C35'],
      ['George Pickens', 'WR', 'FLEX if active. Limited Wednesday (hamstring); 7.8 targets a game, Dallas implied for 28.5.', 'WR19', 'C84'],
      ['Keenan Allen', 'WR', 'FLEX if active. Did not practice Wednesday; 13.7 on 7 targets last week, and Dallas allows the 9th-most WR points.', 'WR22', 'C87'],
    ],
    sit: [
      ['Alec Pierce', 'WR', 'OUT. On IR (heel), no timetable; the engine still projects 10.1.', null, 'C106'],
      ['Jake Ferguson', 'TE', 'Did not practice Wednesday (ankle); 9% target share.', null, 'C126'],
    ],
    also: null,
  },
  {
    id: 'den-car',
    slot: 'one',
    title: 'Broncos at Panthers',
    kick: 'Sun 1:00p',
    when: 'Sun 1:00p ET',
    away: 'DEN',
    home: 'CAR',
    awayPts: 23.5,
    homePts: 21,
    line: 'DEN -2.5',
    total: 44.5,
    weather: '64F, wind 3, sunny',
    rain: false,
    read: 'Denver is a 2.5-point favorite with a 44.5 total, implied for 23.5 against Carolina\'s 21.0. RJ Harvey is on IR with a knee injury, and Jonah Coleman (RB16) is a flex after playing 66% of the snaps last week against a Carolina defense that allows the 2nd-most RB points. Chuba Hubbard (RB7) is a start against a Denver defense that allows the 10th-most RB points, and Tetairoa McMillan (WR13) is a start on a 27% target share. The Denver defense is a start (DST8) with Carolina implied for 21.0, and Bryce Young is a sit. Bo Nix is a sit that works only as a 2QB start at Carolina, and Jalen Coker (WR30) is a flex on a 22% target share, though Denver allows the 8th-fewest WR points.',
    fpa: 'DEN offense vs CAR D: QB 18, RB 2, WR 17, TE 16 · CAR offense vs DEN D: QB 19, RB 10, WR 25, TE 6',
    start: [
      ['Chuba Hubbard', 'RB', '24.9 last week on 22 carries and 8 targets; Denver allows the 10th-most RB points.', 'RB7', 'C36'],
      ['Tetairoa McMillan', 'WR', '27% target share, 11 targets last week; Denver allows the 8th-fewest WR points.', 'WR13', 'C78'],
      ['Denver Broncos', 'DEF', 'Carolina implied for 21.0; Bryce Young scored 5.4 and 10.4 the last two.', 'DST8', 'C134'],
    ],
    flex: [
      ['Jonah Coleman', 'RB', '20.4 last week on 66% of the snaps with RJ Harvey on IR; Carolina allows the 2nd-most RB points.', 'RB16', 'C45'],
      ['Jalen Coker', 'WR', '22% target share, 86% of the snaps last week; 13.2 a game, though Denver allows the 8th-fewest WR points.', 'WR30', 'C95'],
    ],
    watch: [],
    sit: [
      ['Bo Nix', 'QB', '26.2 and 19.3 the last two after 4.5, 14.4 a game; a 2QB start at Carolina.', null, 'C17'],
      ['Bryce Young', 'QB', '5.4 and 10.4 the last two; Carolina implied for 21.0.', null, 'C18'],
      ['RJ Harvey', 'RB', 'OUT. On IR (knee); the engine still projects 12.7.', null, 'C62'],
    ],
    also: 'Alex Singleton (DEN LB) is on the IDP board, and J.K. Dobbins, Harvey\'s handcuff, has no ruling.',
  },
  {
    id: 'det-mia',
    slot: 'one',
    title: 'Lions at Dolphins',
    kick: 'Sun 1:00p',
    when: 'Sun 1:00p ET',
    away: 'DET',
    home: 'MIA',
    awayPts: 28.75,
    homePts: 21.75,
    line: 'DET -7',
    total: 50.5,
    weather: '82F, wind 6, mostly sunny',
    rain: false,
    read: 'Detroit is a 7-point favorite with a 50.5 total, implied for 28.75 against Miami\'s 21.75. Jahmyr Gibbs (RB1) is a start on 22.4 carries a game and is off the practice report, and Jared Goff (QB5) is a start against a Miami defense that allows the 5th-most QB points. Amon-Ra St. Brown is a start only if active (WR7), after a limited Wednesday with ribs, so check the 1:00p inactives at about 11:30a ET, and if he sits, more of the passing game falls to Jameson Williams (WR11). Malik Willis is a sit and a streamer against a Detroit defense that allows the most QB points, and Ollie Gordon II is a sit after 6.9 on 19 carries last week. De\'Von Achane is out on IR with a knee injury.',
    fpa: 'DET offense vs MIA D: QB 5, RB 8, WR 30, TE 3 · MIA offense vs DET D: QB 1, RB 28, WR 4, TE 1',
    start: [
      ['Jared Goff', 'QB', '20.3 a game despite 9.0 last week; Detroit implied for 28.75 and Miami allows the 5th-most QB points.', 'QB5', 'C5'],
      ['Jahmyr Gibbs', 'RB', '28.0 a game on 22.4 carries, not on the practice report; Detroit implied for 28.75 and Miami allows the 8th-most RB points.', 'RB1', 'C30'],
      ['Jameson Williams', 'WR', '26.1 and 17.0 the last two; more of the passing game is his if St. Brown sits.', 'WR11', 'C76'],
      ['Sam LaPorta', 'TE', '12.3 a game; Detroit implied for 28.75 and Miami allows the 3rd-most TE points.', 'TE5', 'C113'],
    ],
    flex: [
      ['Caleb Douglas', 'WR', '21.0 and 8.3 the last two on 86% of the snaps last week; Detroit allows the 4th-most WR points.', 'WR23', 'C88'],
      ['Malik Washington', 'WR', '25% target share, 15.0 last week; Detroit allows the 4th-most WR points.', 'WR24', 'C89'],
    ],
    watch: [
      ['Amon-Ra St. Brown', 'WR', 'START if active. Limited Wednesday (ribs); 32% target share, though Miami allows the 3rd-fewest WR points.', 'WR7', 'C72'],
    ],
    sit: [
      ['Malik Willis', 'QB', 'Detroit allows the most QB points (24.8 a game), but he scored 14.6 last week and Miami is implied for 21.75; a streamer, not a QB1.', null, 'C19'],
      ['Ollie Gordon II', 'RB', '19 carries for 6.9 last week and 1.5 targets a game; Detroit allows the 5th-fewest RB points.', null, 'C57'],
      ['De\'Von Achane', 'RB', 'OUT. On IR (knee); the engine still projects 12.3.', null, 'C63'],
    ],
    also: null,
  },
  {
    id: 'lar-was',
    slot: 'one',
    title: 'Rams at Commanders',
    kick: 'Sun 1:00p',
    when: 'Sun 1:00p ET',
    away: 'LAR',
    home: 'WAS',
    awayPts: 26.5,
    homePts: 22,
    line: 'LAR -4.5',
    total: 48.5,
    weather: '60F, wind 10, sunny',
    rain: false,
    read: 'The Rams are 4.5-point favorites with a 48.5 total, implied for 26.5 against Washington\'s 22.0. Puka Nacua (WR2) and Matthew Stafford (QB10) are starts against a Washington defense that allows the 11th-most WR points and the 4th-most QB points. Stefon Diggs (WR21) is a flex only if active after he did not practice Wednesday, and he has a 23% target share with Terry McLaurin on IR; the 1:00p inactives at about 11:30a ET settle it. Kyren Williams (RB11) is a start against a Washington defense that allows the 7th-fewest RB points, and Blake Corum is a sit as the No. 2 behind him. Jayden Daniels (QB8) is a start against a Rams defense that allows the 13th-fewest QB points, and Rachaad White (RB24) is a flex with Jeremy McNichols out for months.',
    fpa: 'LAR offense vs WAS D: QB 4, RB 26, WR 11, TE 2 · WAS offense vs LAR D: QB 20, RB 22, WR 28, TE 27',
    start: [
      ['Jayden Daniels', 'QB', '20.1 a game with 5.4 carries, full practice; the Rams allow the 13th-fewest QB points.', 'QB8', 'C8'],
      ['Matthew Stafford', 'QB', '16.5 a game and 8.3 last week, but Los Angeles is implied for 26.5 and Washington allows the 4th-most QB points.', 'QB10', 'C10'],
      ['Kyren Williams', 'RB', '18.9 a game; Los Angeles implied for 26.5, and Washington allows the 7th-fewest RB points.', 'RB11', 'C40'],
      ['Puka Nacua', 'WR', '34% target share, 12.3 targets a game, 25.0 last week; Washington allows the 11th-most WR points.', 'WR2', 'C67'],
    ],
    flex: [
      ['Rachaad White', 'RB', '15.7 and 14.0 the last two; Jacory Croskey-Merritt is on IR and Jeremy McNichols is out for months.', 'RB24', 'C53'],
    ],
    watch: [
      ['Stefon Diggs', 'WR', 'FLEX if active. Did not practice Wednesday; 23% target share with Terry McLaurin on IR, though the Rams allow the 5th-fewest WR points.', 'WR21', 'C86'],
    ],
    sit: [
      ['Blake Corum', 'RB', '14.0, 17.1 and 13.3 the last three on 9.4 carries a game; the No. 2 behind Kyren Williams.', null, 'C58'],
      ['Davante Adams', 'WR', 'OUT. On IR after hamstring surgery; the engine still projects 16.2.', null, 'C105'],
      ['Terry McLaurin', 'WR', 'OUT. On IR after knee surgery; the engine still projects 9.0.', null, 'C108'],
    ],
    also: 'Quentin Lake (LAR S) is on the IDP board, and Austin Ekeler, White\'s handcuff, has no ruling.',
  },
  {
    id: 'nyg-phi',
    slot: 'one',
    title: 'Giants at Eagles',
    kick: 'Sun 1:00p',
    when: 'Sun 1:00p ET',
    away: 'NYG',
    home: 'PHI',
    awayPts: 21,
    homePts: 17.5,
    line: 'NYG -3.5',
    total: 38.5,
    weather: '59F, wind 10, sunny',
    rain: false,
    read: 'The Giants are 3.5-point favorites with a 38.5 total, the lowest on the slate, implied for 21.0 against Philadelphia\'s 17.5. Cam Skattebo (RB22) is a flex only if active after he did not practice Wednesday with a hamstring that is day-to-day, so the 1:00p inactives at about 11:30a ET decide him. Devin Singletary is a sit unless Skattebo sits, when he takes the lead job. Saquon Barkley is a sit after not practicing Wednesday, and Jalen Hurts is out on IR with blood clots in his lungs. Malik Nabers (WR6) is a start against a Philadelphia defense that allows the 2nd-most WR points, and Isaiah Likely (TE8) is a start against a Philadelphia defense that allows the 3rd-fewest TE points.',
    fpa: 'NYG offense vs PHI D: QB 9, RB 15, WR 2, TE 30 · PHI offense vs NYG D: QB 7, RB 21, WR 15, TE 21',
    start: [
      ['Malik Nabers', 'WR', '29.1, 28.5 and 18.1 before the bye; Philadelphia allows the 2nd-most WR points.', 'WR6', 'C71'],
      ['Isaiah Likely', 'TE', '16.1 a game, 27% target share; Philadelphia allows the 3rd-fewest TE points.', 'TE8', 'C116'],
      ['New York Giants', 'DEF', 'Philadelphia implied for 17.5, with Tanner McKee scoring 7.0 last week and Barkley and Smith not practicing Wednesday.', 'DST6', 'C132'],
    ],
    flex: [],
    watch: [
      ['Cam Skattebo', 'RB', 'FLEX if active. Did not practice Wednesday (hamstring), day-to-day; 19.1 on 17 carries in Week 7.', 'RB22', 'C51'],
    ],
    sit: [
      ['Jalen Hurts', 'QB', 'OUT. On IR, blood clots in his lungs, expected to miss the season; the engine still projects 18.0.', null, 'C29'],
      ['Devin Singletary', 'RB', 'The lead job only if Skattebo sits; 14.5 in Week 7.', null, 'C51'],
      ['Saquon Barkley', 'RB', 'Did not practice Wednesday (hamstring, back); 32% of the snaps last week and Philadelphia is implied for 17.5.', null, 'C55'],
      ['DeVonta Smith', 'WR', 'Did not practice Wednesday (hamstring); last played Week 6.', null, 'C97'],
      ['Dallas Goedert', 'TE', 'Full practice, 10.7 a game, but Philadelphia is implied for 17.5.', null, 'C123'],
    ],
    also: 'Elijah Mitchell, Barkley\'s handcuff, has no ruling.',
  },
  {
    id: 'nyj-kc',
    slot: 'one',
    title: 'Jets at Chiefs',
    kick: 'Sun 1:00p',
    when: 'Sun 1:00p ET',
    away: 'NYJ',
    home: 'KC',
    awayPts: 18.75,
    homePts: 28.75,
    line: 'KC -10',
    total: 47.5,
    weather: '60F, wind 3, sunny',
    rain: false,
    read: 'Kansas City is a 10-point favorite with a 47.5 total, implied for 28.75 against the Jets\' 18.75, and Garrett Wilson is in the concussion protocol after not practicing Wednesday. Adonai Mitchell (WR27) is a flex after 27.2 on 9 targets last week, though Kansas City allows the 2nd-fewest WR points, and Geno Smith is a sit that works only as a 2QB start. Breece Hall has not played since Week 3 and was limited Wednesday, while Braelon Allen (RB19) is a flex after 19.4 and 23.3 the last two on 83% of the snaps. Kenneth Walker III (RB2) is a start, and the Kansas City defense is a start (DST4) with the Jets implied for 18.75. Rashee Rice (WR16) is a flex only if active, and Travis Kelce (TE7) is a start only if active, both limited Wednesday, so the 1:00p inactives at about 11:30a ET settle both.',
    fpa: 'NYJ offense vs KC D: QB 27, RB 22, WR 31, TE 5 · KC offense vs NYJ D: QB 15, RB 17, WR 24, TE 17',
    start: [
      ['Patrick Mahomes', 'QB', '25.4 last week, full practice; Kansas City implied for 28.75 as a 10-point favorite.', 'QB7', 'C7'],
      ['Kenneth Walker III', 'RB', '22.9 a game on 20.1 carries, 21 last week; Kansas City implied for 28.75 as a 10-point favorite.', 'RB2', 'C31'],
      ['Kansas City Chiefs', 'DEF', '10-point favorites; the Jets implied for 18.75 with Garrett Wilson in the concussion protocol.', 'DST4', 'C130'],
    ],
    flex: [
      ['Braelon Allen', 'RB', '19.4 and 23.3 the last two on 83% of the snaps; Breece Hall is still limited.', 'RB19', 'C48'],
      ['Adonai Mitchell', 'WR', '27.2 on 9 targets last week; Garrett Wilson is in the concussion protocol, though Kansas City allows the 2nd-fewest WR points.', 'WR27', 'C92'],
    ],
    watch: [
      ['Rashee Rice', 'WR', 'FLEX if active. Limited Wednesday (hamstring, knee); 18.3 on 8 targets last week and Kansas City implied for 28.75.', 'WR16', 'C81'],
      ['Travis Kelce', 'TE', 'START if active. Limited Wednesday (ankle); 19% target share and Kansas City implied for 28.75.', 'TE7', 'C115'],
    ],
    sit: [
      ['Geno Smith', 'QB', '23.5 and 18.0 the last two, but the Jets are implied for 18.75; a 2QB start.', null, 'C20'],
      ['Breece Hall', 'RB', 'Limited Wednesday (quadriceps); has not played since Week 3.', null, 'C48'],
      ['Emmett Johnson', 'RB', '25.3 last week on 19% of the snaps and one carry.', null, 'C60'],
      ['Garrett Wilson', 'WR', 'In the concussion protocol, did not practice Wednesday.', null, 'C100'],
      ['Omar Cooper Jr.', 'WR', 'Not in the Week 8 box score and not on the practice report; 22.3 and 22.5 the two before.', null, 'C103'],
      ['Mason Taylor', 'TE', 'Limited Wednesday (back); 25.2 and 4.9 the last two.', null, 'C124'],
    ],
    also: null,
  },
  {
    id: 'hou-lac',
    slot: 'late',
    title: 'Texans at Chargers',
    kick: 'Sun 4:05p',
    when: 'Sun 4:05p ET',
    away: 'HOU',
    home: 'LAC',
    awayPts: 22.5,
    homePts: 18,
    line: 'HOU -4.5',
    total: 40.5,
    weather: 'Dome',
    rain: false,
    read: 'Houston is a 4.5-point favorite in a dome with a 40.5 total, implied for 22.5 against the Chargers\' 18.0. The Texans\' defense is a start (DST3) with the Chargers implied for 18.0 and Justin Herbert scoring 8.8 and 7.8 the last two. David Montgomery is out, and Woody Marks (RB20) is a flex after 19 carries on 89% of the snaps in Week 7, against a Chargers defense that allows the 11th-most RB points. C.J. Stroud is a sit (QB14) at 18.4 a game off the bye, against a Chargers defense that allows the 8th-fewest QB points. Nico Collins (WR20) is a flex on a 22% target share, with Jaylin Noel on IR.',
    fpa: 'HOU offense vs LAC D: QB 25, RB 11, WR 19, TE 29 · LAC offense vs HOU D: QB 12, RB 14, WR 3, TE 25',
    start: [
      ['Houston Texans', 'DEF', 'The Chargers implied for 18.0; Justin Herbert scored 8.8 and 7.8 in his last two.', 'DST3', 'C129'],
    ],
    flex: [
      ['Woody Marks', 'RB', '19 carries on 89% of the snaps in Week 7, David Montgomery is out; the Chargers allow the 11th-most RB points.', 'RB20', 'C49'],
      ['Nico Collins', 'WR', '22% target share with Jaylin Noel on IR; 15.2 a game.', 'WR20', 'C85'],
    ],
    watch: [],
    sit: [
      ['C.J. Stroud', 'QB', '18.4 a game off the bye; the Chargers allow the 8th-fewest QB points; QB14.', 'QB14', 'C14'],
    ],
    also: null,
  },
  {
    id: 'ari-sea',
    slot: 'late',
    title: 'Cardinals at Seahawks',
    kick: 'Sun 4:25p',
    when: 'Sun 4:25p ET',
    away: 'ARI',
    home: 'SEA',
    awayPts: 15.5,
    homePts: 24,
    line: 'SEA -8.5',
    total: 39.5,
    weather: '55F, wind 10, 23% light rain',
    rain: false,
    read: 'Seattle is an 8.5-point favorite with a 39.5 total, implied for 24 against Arizona\'s 15.5. Sam Darnold is out with a quadriceps injury, and Drew Lock (elbow) is slated to start; he is a sit and a 2QB start only, against an Arizona defense that allows the 2nd-most QB points. Jeremiyah Love is on IR and Bam Knight is in the concussion protocol, so Tyler Allgeier (RB17) is a flex, with Arizona implied for 15.5. Jaxon Smith-Njigba (WR1) is a start only if active, and Michael Wilson (WR25) is a flex only if active, both limited, so the 4:25p inactives at about 2:55p ET settle both. Trey McBride (TE2) is a start on a 28% target share, and the Seattle defense (DST1) is a start with Arizona implied for 15.5.',
    fpa: 'ARI offense vs SEA D: QB 31, RB 13, WR 32, TE 28 · SEA offense vs ARI D: QB 2, RB 19, WR 13, TE 9',
    start: [
      ['Trey McBride', 'TE', '28% target share, 10.8 targets a game, 27.1 and 20.2 the last two.', 'TE2', 'C110'],
      ['Seattle Seahawks', 'DEF', 'Arizona implied for 15.5 with an unsettled quarterback; 11.0 a game.', 'DST1', 'C127'],
    ],
    flex: [
      ['Tyler Allgeier', 'RB', '36.1 last week; Jeremiyah Love is on IR and Bam Knight is in the concussion protocol, but Arizona is implied for 15.5.', 'RB17', 'C46'],
    ],
    watch: [
      ['Jaxon Smith-Njigba', 'WR', 'START if active. Limited on the NFL.com report; 36% target share, 27.6 a game, and Arizona allows the 13th-most WR points.', 'WR1', 'C66'],
      ['Michael Wilson', 'WR', 'FLEX if active. Limited Wednesday (ribs, rest); 15 targets for 26.8 last week, but Seattle allows the fewest WR points.', 'WR25', 'C90'],
    ],
    sit: [
      ['Drew Lock', 'QB', 'Slated to start with Darnold out, carrying an elbow injury; Arizona allows the 2nd-most QB points, so a 2QB start.', null, 'C21'],
      ['Gardner Minshew II', 'QB', '19.5 in relief last week and first on the chart, but Arizona is implied for 15.5.', null, 'C24'],
      ['Jacoby Brissett', 'QB', 'Did not practice Wednesday; replaced in the third quarter last week after 3.5.', null, 'C24'],
      ['Sam Darnold', 'QB', 'OUT. Ruled out Sunday (quadriceps), week-to-week; the engine still projects 15.3.', null, 'C28'],
      ['Zach Charbonnet', 'RB', '6 carries in his first game last week, with Jadarian Price at 10; a split backfield.', null, 'C59'],
      ['Emanuel Wilson', 'RB', 'Did not appear in the Week 8 box score; 18.5 in Week 7.', null, 'C59'],
      ['Jeremiyah Love', 'RB', 'OUT. On IR, high ankle sprain; the engine still projects 8.5.', null, 'C65'],
    ],
    also: 'Ernest Jones IV (SEA LB) is on the IDP board.',
  },
  {
    id: 'gb-ne',
    slot: 'late',
    title: 'Packers at Patriots',
    kick: 'Sun 4:25p',
    when: 'Sun 4:25p ET',
    away: 'GB',
    home: 'NE',
    awayPts: 21,
    homePts: 24.5,
    line: 'NE -3.5',
    total: 45.5,
    weather: '56F, wind 7, mostly sunny',
    rain: false,
    read: 'New England is a 3.5-point favorite with a 45.5 total, implied for 24.5 against Green Bay\'s 21.0. TreVeyon Henderson did not practice Wednesday with an illness, and Rhamondre Stevenson (RB14) is a start after 19 carries on 77% of the snaps last week, with the 4:25p inactives at about 2:55p ET showing whether Henderson is active. Christian Watson (WR9) is a start only if active after a limited Wednesday with ribs, and the same 2:55p window settles him. Drake Maye (QB6) and Josh Jacobs (RB4) are starts, and Matthew Golden (WR8) is a start against a New England defense that allows the 7th-most WR points. Jordan Love (QB13) is a sit against a New England defense that allows the 10th-fewest QB points, and Tucker Kraft (TE10) is a start against a New England defense that allows the 9th-fewest TE points.',
    fpa: 'GB offense vs NE D: QB 23, RB 29, WR 7, TE 24 · NE offense vs GB D: QB 28, RB 7, WR 8, TE 31',
    start: [
      ['Drake Maye', 'QB', '23.8, 27.4 and 22.5 the last three with 5.8 carries a game, full practice; Green Bay allows the 5th-fewest QB points.', 'QB6', 'C6'],
      ['Josh Jacobs', 'RB', '20.1 and 23.2 in two games back with 6.5 targets a game; New England allows the 4th-fewest RB points.', 'RB4', 'C33'],
      ['Rhamondre Stevenson', 'RB', '19 carries on 77% of the snaps last week; TreVeyon Henderson did not practice Wednesday (illness), and Green Bay allows the 7th-most RB points.', 'RB14', 'C43'],
      ['Matthew Golden', 'WR', '10.3 targets a game, 13 last week for 20.9; New England allows the 7th-most WR points.', 'WR8', 'C73'],
      ['Tucker Kraft', 'TE', '14.8 and 17.3 the last two; New England allows the 9th-fewest TE points.', 'TE10', 'C118'],
    ],
    flex: [],
    watch: [
      ['Christian Watson', 'WR', 'START if active. Limited Wednesday (ribs); 18.4 a game, 49% of the snaps last week.', 'WR9', 'C74'],
    ],
    sit: [
      ['Jordan Love', 'QB', '18.7 a game and 21.5 last week, but Green Bay is implied for 21.0 and New England allows the 10th-fewest QB points; QB13.', 'QB13', 'C13'],
      ['A.J. Brown', 'WR', 'Did not practice Wednesday (knee, ankle); 6.4 a game.', null, 'C99'],
      ['Romeo Doubs', 'WR', 'OUT. On IR (shoulder); the engine still projects 10.0.', null, 'C107'],
      ['Hunter Henry', 'TE', 'Did not practice Wednesday (foot); left after 13% of the snaps last week.', null, 'C125'],
    ],
    also: 'Evan Williams (GB S) is on the IDP board, and Corey Kiner has no ruling.',
  },
  {
    id: 'lv-sf',
    slot: 'late',
    title: 'Raiders at 49ers',
    kick: 'Sun 4:25p',
    when: 'Sun 4:25p ET',
    away: 'LV',
    home: 'SF',
    awayPts: 21.25,
    homePts: 31.25,
    line: 'SF -10',
    total: 52.5,
    weather: '71F, wind 6, sunny',
    rain: false,
    read: 'San Francisco is a 10-point favorite with a 52.5 total, implied for 31.25, the highest on the slate, against Las Vegas at 21.25. Christian McCaffrey (RB3) is a start only if active after he did not practice Wednesday with a hamstring described as mild, so the 4:25p inactives at about 2:55p ET decide him, and Kaelon Black takes the work only if he sits. Brock Purdy (QB3) is a start against a Las Vegas defense that allows the 6th-most QB points, and Kirk Cousins (QB11) is a start, since Las Vegas is a 10-point underdog and will throw. Brock Bowers (TE1) is a start, and George Kittle (TE3) is a start against a Las Vegas defense that allows the 4th-most TE points. Mike Evans (WR17) is a flex only if active, and Deebo Samuel is a sit, both after not practicing Wednesday.',
    fpa: 'LV offense vs SF D: QB 22, RB 12, WR 22, TE 22 · SF offense vs LV D: QB 6, RB 6, WR 12, TE 4',
    start: [
      ['Brock Purdy', 'QB', 'San Francisco implied for 31.25, the highest on the slate; Las Vegas allows the 6th-most QB points; 20.9 a game.', 'QB3', 'C3'],
      ['Kirk Cousins', 'QB', '18.5, 20.4 and 28.2 the last three; a 10-point underdog will throw, and San Francisco allows the 11th-fewest QB points.', 'QB11', 'C11'],
      ['Brock Bowers', 'TE', '29% target share, 10.2 targets a game, 28.2 last week.', 'TE1', 'C109'],
      ['George Kittle', 'TE', '15.1 a game, San Francisco implied for 31.25; Las Vegas allows the 4th-most TE points.', 'TE3', 'C111'],
    ],
    flex: [
      ['Ashton Jeanty', 'RB', '16.7 a game with 6.0 targets, but 2 carries on 40% of the snaps last week.', 'RB18', 'C47'],
    ],
    watch: [
      ['Christian McCaffrey', 'RB', 'START if active. Did not practice Wednesday (hamstring, described as mild); 20.6 a game and San Francisco implied for 31.25.', 'RB3', 'C32'],
      ['Mike Evans', 'WR', 'FLEX if active. Did not practice Wednesday (Achilles, ribs), has not played since Week 6; 14.8 a game, San Francisco implied for 31.25.', 'WR17', 'C82'],
    ],
    sit: [
      ['Kaelon Black', 'RB', 'Takes the work only if McCaffrey sits; 10.9 on 12 carries in Week 7.', null, 'C32'],
      ['Mike Washington Jr.', 'RB', '25 carries for 8.3 last week with no targets; Las Vegas is a 10-point underdog.', null, 'C47'],
      ['Deebo Samuel Sr.', 'WR', 'Did not practice Wednesday (hamstring); last played Week 5.', null, 'C98'],
      ['Tre Tucker', 'WR', '0.0 on 1 target last week after 26.7 and 21.3.', null, 'C102'],
    ],
    also: 'Nakobe Dean (LV LB) and Fred Warner (SF LB) are on the IDP board.',
  },
  {
    id: 'tb-chi',
    slot: 'prime',
    title: 'Buccaneers at Bears',
    kick: 'Sun 8:20p',
    when: 'Sunday Night · 8:20p ET',
    away: 'TB',
    home: 'CHI',
    awayPts: 20.75,
    homePts: 26.75,
    line: 'CHI -6',
    total: 47.5,
    weather: '49F, wind 5, mostly clear',
    rain: false,
    read: 'Chicago is a 6-point favorite with a 47.5 total, implied for 26.75 against Tampa Bay\'s 20.75. D\'Andre Swift (RB5) is a start on volume, with 27 carries last week, against a Tampa Bay defense that allows the fewest RB points. Kyle Monangai did not practice Wednesday, which keeps the work on Swift. Bucky Irving (RB15) is a start on 24.0 and 21.0 the last two, and Caleb Williams (QB12) is a start against a Tampa Bay defense that allows the 3rd-fewest QB points. Kenny Gainwell (limited Wednesday, hip) and Emeka Egbuka (did not practice Wednesday, foot) are sits.',
    fpa: 'TB offense vs CHI D: QB 8, RB 30, WR 18, TE 23 · CHI offense vs TB D: QB 30, RB 32, WR 26, TE 10',
    start: [
      ['Caleb Williams', 'QB', '19.5 a game with 5.2 carries; Chicago implied for 26.75, though Tampa allows the 3rd-fewest QB points; QB12.', 'QB12', 'C12'],
      ['D\'Andre Swift', 'RB', '23.0, 19.0 and 27.9 the last three, 27 carries last week; Kyle Monangai did not practice Wednesday, so volume beats Tampa\'s fewest RB points allowed.', 'RB5', 'C34'],
      ['Bucky Irving', 'RB', '24.0 and 21.0 the last two, 18.4 carries a game; Chicago allows the 3rd-fewest RB points.', 'RB15', 'C44'],
      ['Luther Burden III', 'WR', '17.5, 23.7 and 18.6 the last three; Chicago implied for 26.75.', 'WR12', 'C77'],
      ['Colston Loveland', 'TE', '18.5, 19.9 and 11.5 the last three on 12 and 9 targets the last two.', 'TE9', 'C117'],
      ['Chicago Bears', 'DEF', 'Tampa implied for 20.75; Baker Mayfield scored 6.7 and 1.4 the last two.', 'DST5', 'C131'],
    ],
    flex: [],
    watch: [],
    sit: [
      ['Kenny Gainwell', 'RB', 'Limited Wednesday (hip); 25 carries for 14.0 last week.', null, 'C61'],
      ['Emeka Egbuka', 'WR', 'Did not practice Wednesday (foot), running on the side; last played Week 6.', null, 'C101'],
    ],
    also: 'Roschon Johnson has no ruling.',
  },
  {
    id: 'buf-min',
    slot: 'prime',
    title: 'Bills at Vikings',
    kick: 'Mon 8:15p',
    when: 'Monday Night · 8:15p ET',
    away: 'BUF',
    home: 'MIN',
    awayPts: 24.5,
    homePts: 21,
    line: 'BUF -3.5',
    total: 45.5,
    weather: 'Dome',
    rain: false,
    read: 'Buffalo is a 3.5-point favorite in a dome with a 45.5 total, implied for 24.5 against Minnesota\'s 21.0. Josh Allen (QB2) is a start on 7.9 carries a game, even though Minnesota allows the fewest QB points, and James Cook III (RB8) is a start against a Minnesota defense that allows the 6th-fewest RB points. Justin Jefferson (WR14) and T.J. Hockenson (TE11) are starts, with Buffalo allowing the 6th-most WR points and the 12th-most TE points. Kyler Murray is a sit with a sore hamstring under full evaluation, and Carson Wentz is next on the Minnesota chart; the Monday inactives at about 6:45p ET are the last window of the week, with no later game to pivot to. Aaron Jones Sr. and Jordan Mason are sits in a split Minnesota backfield, and Dalton Kincaid (TE14) is a sit against a Minnesota defense that allows the fewest TE points.',
    fpa: 'BUF offense vs MIN D: QB 32, RB 27, WR 29, TE 32 · MIN offense vs BUF D: QB 10, RB 3, WR 6, TE 12',
    start: [
      ['Josh Allen', 'QB', '26.8 a game on 7.9 carries; Minnesota allows the fewest QB points (8.1 a game), but the legs travel.', 'QB2', 'C2'],
      ['James Cook III', 'RB', '18.8 a game on 19.7 carries; Minnesota allows the 6th-fewest RB points.', 'RB8', 'C37'],
      ['Justin Jefferson', 'WR', '27% target share, 14.3 last week; Buffalo allows the 6th-most WR points.', 'WR14', 'C79'],
      ['T.J. Hockenson', 'TE', '13.5 and 15.8 the last two; Buffalo allows the 12th-most TE points.', 'TE11', 'C119'],
      ['Minnesota Vikings', 'DEF', '13.9 a game, the best on the slate, at home in a dome.', 'DST7', 'C133'],
    ],
    flex: [],
    watch: [],
    sit: [
      ['Kyler Murray', 'QB', 'Sore hamstring and a full evaluation this week; Carson Wentz is next, and Murray has 12.3 a game.', null, 'C23'],
      ['Aaron Jones Sr.', 'RB', '3.6 and 6.0 the last two; Buffalo allows the 3rd-most RB points but Minnesota\'s backfield is split.', null, 'C56'],
      ['Jordan Mason', 'RB', '6.8 and 2.0 the last two.', null, 'C56'],
      ['DJ Moore', 'WR', 'Left late last week with a knee issue and says he is okay; 10.8 a game, and Minnesota allows the 4th-fewest WR points.', null, 'C104'],
      ['Dalton Kincaid', 'TE', '18.6 last week, but Minnesota allows the fewest TE points; TE14.', 'TE14', 'C122'],
    ],
    also: 'Blake Cashman (MIN LB) is on the IDP board.',
  },
];

const QB_ROWS = [
  [1, 'Joe Burrow', 'CIN', '28.9 and 39.5 the last two, 24.2 a game; Cincinnati implied for 27.75 in a 52.5 total in Madrid', 'start'],
  [2, 'Josh Allen', 'BUF', '26.8 a game on 7.9 carries; Minnesota allows the fewest QB points (8.1 a game), but the legs travel', 'start'],
  [3, 'Brock Purdy', 'SF', 'San Francisco implied for 31.25, the highest on the slate; Las Vegas allows the 6th-most QB points; 20.9 a game', 'start'],
  [4, 'Dak Prescott', 'DAL', '23.3 and 19.8 the last two; Dallas implied for 28.5 in a 51.5 total', 'start'],
  [5, 'Jared Goff', 'DET', '20.3 a game despite 9.0 last week; Detroit implied for 28.75 and Miami allows the 5th-most QB points', 'start'],
  [6, 'Drake Maye', 'NE', '23.8, 27.4 and 22.5 the last three with 5.8 carries a game, full practice; Green Bay allows the 5th-fewest QB points', 'start'],
  [7, 'Patrick Mahomes', 'KC', '25.4 last week, full practice; Kansas City implied for 28.75 as a 10-point favorite', 'start'],
  [8, 'Jayden Daniels', 'WAS', '20.1 a game with 5.4 carries, full practice; the Rams allow the 13th-fewest QB points', 'start'],
  [9, 'Trevor Lawrence', 'JAX', '19.1 a game; Jacksonville implied for 24.75 as a 10-point road favorite Thursday', 'start'],
  [10, 'Matthew Stafford', 'LAR', '16.5 a game and 8.3 last week, but Los Angeles is implied for 26.5 and Washington allows the 4th-most QB points', 'start'],
  [11, 'Kirk Cousins', 'LV', '18.5, 20.4 and 28.2 the last three; a 10-point underdog will throw, and San Francisco allows the 11th-fewest QB points', 'start'],
  [12, 'Caleb Williams', 'CHI', '19.5 a game with 5.2 carries; Chicago implied for 26.75, though Tampa allows the 3rd-fewest QB points; QB12', 'start'],
  [13, 'Jordan Love', 'GB', '18.7 a game and 21.5 last week, but Green Bay is implied for 21.0 and New England allows the 10th-fewest QB points; QB13', 'sit'],
  [14, 'C.J. Stroud', 'HOU', '18.4 a game off the bye; the Chargers allow the 8th-fewest QB points; QB14', 'sit'],
];

const RB_ROWS = [
  [1, 'Jahmyr Gibbs', 'DET', '28.0 a game on 22.4 carries, not on the practice report; Detroit implied for 28.75 and Miami allows the 8th-most RB points', 'start'],
  [2, 'Kenneth Walker III', 'KC', '22.9 a game on 20.1 carries, 21 last week; Kansas City implied for 28.75 as a 10-point favorite', 'start'],
  [3, 'Christian McCaffrey', 'SF', 'If active. Did not practice Wednesday (hamstring, described as mild); 20.6 a game and San Francisco implied for 31.25', 'start'],
  [4, 'Josh Jacobs', 'GB', '20.1 and 23.2 in two games back with 6.5 targets a game; New England allows the 4th-fewest RB points', 'start'],
  [5, 'D\'Andre Swift', 'CHI', '23.0, 19.0 and 27.9 the last three, 27 carries last week; Kyle Monangai did not practice Wednesday, so volume beats Tampa\'s fewest RB points allowed', 'start'],
  [6, 'Jonathan Taylor', 'IND', 'If active. Limited Wednesday; 18.5 carries a game, and Dallas allows the 4th-most RB points', 'start'],
  [7, 'Chuba Hubbard', 'CAR', '24.9 last week on 22 carries and 8 targets; Denver allows the 10th-most RB points', 'start'],
  [8, 'James Cook III', 'BUF', '18.8 a game on 19.7 carries; Minnesota allows the 6th-fewest RB points', 'start'],
  [9, 'Javonte Williams', 'DAL', '16.8 carries a game, 24 last week; Dallas implied for 28.5 and Indianapolis allows the 9th-most RB points', 'start'],
  [10, 'Bijan Robinson', 'ATL', '19.2 a game with 19 carries last week; Brian Robinson Jr. was limited Wednesday; Cincinnati allows the 9th-fewest RB points in a 52.5 total', 'start'],
  [11, 'Kyren Williams', 'LAR', '18.9 a game; Los Angeles implied for 26.5, and Washington allows the 7th-fewest RB points', 'start'],
  [12, 'Bhayshul Tuten', 'JAX', 'If active. Questionable Thursday (ankle, foot) after not practicing; 24.7 and 29.9 the last two, and Jacksonville is implied for 24.75', 'start'],
  [13, 'Chase Brown', 'CIN', '9 targets last week and 6.0 a game; Cincinnati implied for 27.75, and Atlanta allows the 5th-most RB points', 'start'],
  [14, 'Rhamondre Stevenson', 'NE', '19 carries on 77% of the snaps last week; TreVeyon Henderson did not practice Wednesday (illness), and Green Bay allows the 7th-most RB points', 'start'],
  [15, 'Bucky Irving', 'TB', '24.0 and 21.0 the last two, 18.4 carries a game; Chicago allows the 3rd-fewest RB points', 'start'],
  [16, 'Jonah Coleman', 'DEN', '20.4 last week on 66% of the snaps with RJ Harvey on IR; Carolina allows the 2nd-most RB points', 'flex'],
  [17, 'Tyler Allgeier', 'ARI', '36.1 last week; Jeremiyah Love is on IR and Bam Knight is in the concussion protocol, but Arizona is implied for 15.5', 'flex'],
  [18, 'Ashton Jeanty', 'LV', '16.7 a game with 6.0 targets, but 2 carries on 40% of the snaps last week', 'flex'],
  [19, 'Braelon Allen', 'NYJ', '19.4 and 23.3 the last two on 83% of the snaps; Breece Hall is still limited', 'flex'],
  [20, 'Woody Marks', 'HOU', '19 carries on 89% of the snaps in Week 7, David Montgomery is out; the Chargers allow the 11th-most RB points', 'flex'],
  [21, 'Quinshon Judkins', 'CLE', '12.4 a game; New Orleans allows the most RB points, though Cleveland is implied for 19.75', 'flex'],
  [22, 'Cam Skattebo', 'NYG', 'If active. Did not practice Wednesday (hamstring), day-to-day; 19.1 on 17 carries in Week 7', 'flex'],
  [23, 'Alvin Kamara', 'NO', 'If active. Did not practice Wednesday (rest, back); 14.9 and 13.2 before the bye with 4.5 targets a game', 'flex'],
  [24, 'Rachaad White', 'WAS', '15.7 and 14.0 the last two; Jacory Croskey-Merritt is on IR and Jeremy McNichols is out for months', 'flex'],
];

const WR_ROWS = [
  [1, 'Jaxon Smith-Njigba', 'SEA', 'If active. Limited on the NFL.com report; 36% target share, 27.6 a game, and Arizona allows the 13th-most WR points', 'start'],
  [2, 'Puka Nacua', 'LAR', '34% target share, 12.3 targets a game, 25.0 last week; Washington allows the 11th-most WR points', 'start'],
  [3, 'Ja\'Marr Chase', 'CIN', '31.1 last week on 16 targets; Cincinnati implied for 27.75 in a 52.5 total', 'start'],
  [4, 'Tee Higgins', 'CIN', '26.8 and 37.5 the last two on a 23% target share', 'start'],
  [5, 'CeeDee Lamb', 'DAL', '32% target share, 11.5 targets a game; Dallas implied for 28.5', 'start'],
  [6, 'Malik Nabers', 'NYG', '29.1, 28.5 and 18.1 before the bye; Philadelphia allows the 2nd-most WR points', 'start'],
  [7, 'Amon-Ra St. Brown', 'DET', 'If active. Limited Wednesday (ribs); 32% target share, though Miami allows the 3rd-fewest WR points', 'start'],
  [8, 'Matthew Golden', 'GB', '10.3 targets a game, 13 last week for 20.9; New England allows the 7th-most WR points', 'start'],
  [9, 'Christian Watson', 'GB', 'If active. Limited Wednesday (ribs); 18.4 a game, 49% of the snaps last week', 'start'],
  [10, 'Chris Olave', 'NO', '27% target share, 10.1 targets a game; Cleveland allows the 13th-fewest WR points', 'start'],
  [11, 'Jameson Williams', 'DET', '26.1 and 17.0 the last two; more of the passing game is his if St. Brown sits', 'start'],
  [12, 'Luther Burden III', 'CHI', '17.5, 23.7 and 18.6 the last three; Chicago implied for 26.75', 'start'],
  [13, 'Tetairoa McMillan', 'CAR', '27% target share, 11 targets last week; Denver allows the 8th-fewest WR points', 'start'],
  [14, 'Justin Jefferson', 'MIN', '27% target share, 14.3 last week; Buffalo allows the 6th-most WR points', 'start'],
  [15, 'Drake London', 'ATL', '29% target share, 1.8 in the rain last week; Zachariah Branch is out, in a 52.5 total', 'start'],
  [16, 'Rashee Rice', 'KC', 'If active. Limited Wednesday (hamstring, knee); 18.3 on 8 targets last week and Kansas City implied for 28.75', 'flex'],
  [17, 'Mike Evans', 'SF', 'If active. Did not practice Wednesday (Achilles, ribs), has not played since Week 6; 14.8 a game, San Francisco implied for 31.25', 'flex'],
  [18, 'Parker Washington', 'JAX', '24% target share, 3.6 last week; Baltimore allows the 10th-most WR points', 'flex'],
  [19, 'George Pickens', 'DAL', 'If active. Limited Wednesday (hamstring); 7.8 targets a game, Dallas implied for 28.5', 'flex'],
  [20, 'Nico Collins', 'HOU', '22% target share with Jaylin Noel on IR; 15.2 a game', 'flex'],
  [21, 'Stefon Diggs', 'WAS', 'If active. Did not practice Wednesday; 23% target share with Terry McLaurin on IR, though the Rams allow the 5th-fewest WR points', 'flex'],
  [22, 'Keenan Allen', 'IND', 'If active. Did not practice Wednesday; 13.7 on 7 targets last week, and Dallas allows the 9th-most WR points', 'flex'],
  [23, 'Caleb Douglas', 'MIA', '21.0 and 8.3 the last two on 86% of the snaps last week; Detroit allows the 4th-most WR points', 'flex'],
  [24, 'Malik Washington', 'MIA', '25% target share, 15.0 last week; Detroit allows the 4th-most WR points', 'flex'],
  [25, 'Michael Wilson', 'ARI', 'If active. Limited Wednesday (ribs, rest); 15 targets for 26.8 last week, but Seattle allows the fewest WR points', 'flex'],
  [26, 'Josh Downs', 'IND', '20% target share, 12.3 last week; Allen did not practice Wednesday', 'flex'],
  [27, 'Adonai Mitchell', 'NYJ', '27.2 on 9 targets last week; Garrett Wilson is in the concussion protocol, though Kansas City allows the 2nd-fewest WR points', 'flex'],
  [28, 'Ryan Flournoy', 'DAL', '17.0, 11.0 and 13.1 the last three; Dallas implied for 28.5 and Pickens is limited', 'flex'],
  [29, 'Devaughn Vele', 'NO', '19% target share, 16.4 before the bye', 'flex'],
  [30, 'Jalen Coker', 'CAR', '22% target share, 86% of the snaps last week; 13.2 a game, though Denver allows the 8th-fewest WR points', 'flex'],
];

const TE_ROWS = [
  [1, 'Brock Bowers', 'LV', '29% target share, 10.2 targets a game, 28.2 last week', 'start'],
  [2, 'Trey McBride', 'ARI', '28% target share, 10.8 targets a game, 27.1 and 20.2 the last two', 'start'],
  [3, 'George Kittle', 'SF', '15.1 a game, San Francisco implied for 31.25; Las Vegas allows the 4th-most TE points', 'start'],
  [4, 'Harold Fannin Jr.', 'CLE', '23.4 on 12 targets last week; New Orleans allows the 8th-most TE points', 'start'],
  [5, 'Sam LaPorta', 'DET', '12.3 a game; Detroit implied for 28.75 and Miami allows the 3rd-most TE points', 'start'],
  [6, 'Tyler Warren', 'IND', '23% target share, 10 targets in his return last week; Dallas allows the 12th-most TE points', 'start'],
  [7, 'Travis Kelce', 'KC', 'If active. Limited Wednesday (ankle); 19% target share and Kansas City implied for 28.75', 'start'],
  [8, 'Isaiah Likely', 'NYG', '16.1 a game, 27% target share; Philadelphia allows the 3rd-fewest TE points', 'start'],
  [9, 'Colston Loveland', 'CHI', '18.5, 19.9 and 11.5 the last three on 12 and 9 targets the last two', 'start'],
  [10, 'Tucker Kraft', 'GB', '14.8 and 17.3 the last two; New England allows the 9th-fewest TE points', 'start'],
  [11, 'T.J. Hockenson', 'MIN', '13.5 and 15.8 the last two; Buffalo allows the 12th-most TE points', 'start'],
  [12, 'Mike Gesicki', 'CIN', '17.6 last week with Erick All Jr. out for the season; Cincinnati implied for 27.75; TE12', 'start'],
  [13, 'Kyle Pitts Sr.', 'ATL', '23.0, 13.2 and 2.6 the last three; Cincinnati allows the 7th-most TE points; TE13', 'sit'],
  [14, 'Dalton Kincaid', 'BUF', '18.6 last week, but Minnesota allows the fewest TE points; TE14', 'sit'],
];

const DST_ROWS = [
  [1, 'Seattle Seahawks', 'SEA', 'Arizona implied for 15.5 with an unsettled quarterback; 11.0 a game', 'start'],
  [2, 'Jacksonville Jaguars', 'JAX', 'Baltimore implied for 14.75, the lowest on the slate, with Jackson and Huntley out; 24 last week', 'start'],
  [3, 'Houston Texans', 'HOU', 'The Chargers implied for 18.0; Justin Herbert scored 8.8 and 7.8 in his last two', 'start'],
  [4, 'Kansas City Chiefs', 'KC', '10-point favorites; the Jets implied for 18.75 with Garrett Wilson in the concussion protocol', 'start'],
  [5, 'Chicago Bears', 'CHI', 'Tampa implied for 20.75; Baker Mayfield scored 6.7 and 1.4 the last two', 'start'],
  [6, 'New York Giants', 'NYG', 'Philadelphia implied for 17.5, with Tanner McKee scoring 7.0 last week and Barkley and Smith not practicing Wednesday', 'start'],
  [7, 'Minnesota Vikings', 'MIN', '13.9 a game, the best on the slate, at home in a dome', 'start'],
  [8, 'Denver Broncos', 'DEN', 'Carolina implied for 21.0; Bryce Young scored 5.4 and 10.4 the last two', 'start'],
];

const RULINGS = [
  [
    'C1',
    [
      ['Joe Burrow', 'QB', 'CIN', 'START', '28.9 and 39.5 the last two, 24.2 a game; Cincinnati implied for 27.75 in a 52.5 total in Madrid.'],
    ],
  ],
  [
    'C2',
    [
      ['Josh Allen', 'QB', 'BUF', 'START', '26.8 a game on 7.9 carries; Minnesota allows the fewest QB points (8.1 a game), but the legs travel.'],
    ],
  ],
  [
    'C3',
    [
      ['Brock Purdy', 'QB', 'SF', 'START', 'San Francisco implied for 31.25, the highest on the slate; Las Vegas allows the 6th-most QB points; 20.9 a game.'],
    ],
  ],
  [
    'C4',
    [
      ['Dak Prescott', 'QB', 'DAL', 'START', '23.3 and 19.8 the last two; Dallas implied for 28.5 in a 51.5 total.'],
    ],
  ],
  [
    'C5',
    [
      ['Jared Goff', 'QB', 'DET', 'START', '20.3 a game despite 9.0 last week; Detroit implied for 28.75 and Miami allows the 5th-most QB points.'],
    ],
  ],
  [
    'C6',
    [
      ['Drake Maye', 'QB', 'NE', 'START', '23.8, 27.4 and 22.5 the last three with 5.8 carries a game, full practice; Green Bay allows the 5th-fewest QB points.'],
    ],
  ],
  [
    'C7',
    [
      ['Patrick Mahomes', 'QB', 'KC', 'START', '25.4 last week, full practice; Kansas City implied for 28.75 as a 10-point favorite.'],
    ],
  ],
  [
    'C8',
    [
      ['Jayden Daniels', 'QB', 'WAS', 'START', '20.1 a game with 5.4 carries, full practice; the Rams allow the 13th-fewest QB points.'],
    ],
  ],
  [
    'C9',
    [
      ['Trevor Lawrence', 'QB', 'JAX', 'START', '19.1 a game; Jacksonville implied for 24.75 as a 10-point road favorite Thursday.'],
    ],
  ],
  [
    'C10',
    [
      ['Matthew Stafford', 'QB', 'LAR', 'START', '16.5 a game and 8.3 last week, but Los Angeles is implied for 26.5 and Washington allows the 4th-most QB points.'],
    ],
  ],
  [
    'C11',
    [
      ['Kirk Cousins', 'QB', 'LV', 'START', '18.5, 20.4 and 28.2 the last three; a 10-point underdog will throw, and San Francisco allows the 11th-fewest QB points.'],
    ],
  ],
  [
    'C12',
    [
      ['Caleb Williams', 'QB', 'CHI', 'START', '19.5 a game with 5.2 carries; Chicago implied for 26.75, though Tampa allows the 3rd-fewest QB points; QB12.'],
    ],
  ],
  [
    'C13',
    [
      ['Jordan Love', 'QB', 'GB', 'SIT', '18.7 a game and 21.5 last week, but Green Bay is implied for 21.0 and New England allows the 10th-fewest QB points; QB13.'],
    ],
  ],
  [
    'C14',
    [
      ['C.J. Stroud', 'QB', 'HOU', 'SIT', '18.4 a game off the bye; the Chargers allow the 8th-fewest QB points; QB14.'],
    ],
  ],
  [
    'C15',
    [
      ['Tyler Shough', 'QB', 'NO', 'SIT', '18.1 a game off the bye, but 0.8 and 13.8 in two of the last three; Cleveland allows the 8th-fewest QB points.'],
    ],
  ],
  [
    'C16',
    [
      ['Michael Penix Jr.', 'QB', 'ATL', 'SIT', '-1.9 in the rain last week after 23.1 and 20.4; the 52.5 total makes him a 2QB start.'],
    ],
  ],
  [
    'C17',
    [
      ['Bo Nix', 'QB', 'DEN', 'SIT', '26.2 and 19.3 the last two after 4.5, 14.4 a game; a 2QB start at Carolina.'],
    ],
  ],
  [
    'C18',
    [
      ['Bryce Young', 'QB', 'CAR', 'SIT', '5.4 and 10.4 the last two; Carolina implied for 21.0.'],
    ],
  ],
  [
    'C19',
    [
      ['Malik Willis', 'QB', 'MIA', 'SIT', 'Detroit allows the most QB points (24.8 a game), but he scored 14.6 last week and Miami is implied for 21.75; a streamer, not a QB1.'],
    ],
  ],
  [
    'C20',
    [
      ['Geno Smith', 'QB', 'NYJ', 'SIT', '23.5 and 18.0 the last two, but the Jets are implied for 18.75; a 2QB start.'],
    ],
  ],
  [
    'C21',
    [
      ['Drew Lock', 'QB', 'SEA', 'SIT', 'Slated to start with Darnold out, carrying an elbow injury; Arizona allows the 2nd-most QB points, so a 2QB start.'],
    ],
  ],
  [
    'C22',
    [
      ['Deshaun Watson', 'QB', 'CLE', 'SIT', 'Did not practice Wednesday (concussion); 11.2 last week and Cleveland is implied for 19.75.'],
    ],
  ],
  [
    'C23',
    [
      ['Kyler Murray', 'QB', 'MIN', 'SIT', 'Sore hamstring and a full evaluation this week; Carson Wentz is next, and Murray has 12.3 a game.'],
    ],
  ],
  [
    'C24',
    [
      ['Gardner Minshew II', 'QB', 'ARI', 'SIT', '19.5 in relief last week and first on the chart, but Arizona is implied for 15.5.'],
      ['Jacoby Brissett', 'QB', 'ARI', 'SIT', 'Did not practice Wednesday; replaced in the third quarter last week after 3.5.'],
    ],
  ],
  [
    'C25',
    [
      ['Joe Fagnano', 'QB', 'BAL', 'SIT', 'Next up with Jackson and Huntley out; 10 of 21 for 91 yards and an interception last week, and Baltimore is implied for 14.75, the lowest on the slate.'],
    ],
  ],
  [
    'C26',
    [
      ['Lamar Jackson', 'QB', 'BAL', 'OUT', 'Out Thursday, thumb surgery and IR; the engine still projects 13.9.'],
    ],
  ],
  [
    'C27',
    [
      ['Tyler Huntley', 'QB', 'BAL', 'OUT', 'Out Thursday, turf toe reported as season-ending.'],
    ],
  ],
  [
    'C28',
    [
      ['Sam Darnold', 'QB', 'SEA', 'OUT', 'Ruled out Sunday (quadriceps), week-to-week; the engine still projects 15.3.'],
    ],
  ],
  [
    'C29',
    [
      ['Jalen Hurts', 'QB', 'PHI', 'OUT', 'On IR, blood clots in his lungs, expected to miss the season; the engine still projects 18.0.'],
    ],
  ],
  [
    'C30',
    [
      ['Jahmyr Gibbs', 'RB', 'DET', 'START', '28.0 a game on 22.4 carries, not on the practice report; Detroit implied for 28.75 and Miami allows the 8th-most RB points.'],
    ],
  ],
  [
    'C31',
    [
      ['Kenneth Walker III', 'RB', 'KC', 'START', '22.9 a game on 20.1 carries, 21 last week; Kansas City implied for 28.75 as a 10-point favorite.'],
    ],
  ],
  [
    'C32',
    [
      ['Christian McCaffrey', 'RB', 'SF', 'START if active', 'Did not practice Wednesday (hamstring, described as mild); 20.6 a game and San Francisco implied for 31.25.'],
      ['Kaelon Black', 'RB', 'SF', 'SIT', 'Takes the work only if McCaffrey sits; 10.9 on 12 carries in Week 7.'],
    ],
  ],
  [
    'C33',
    [
      ['Josh Jacobs', 'RB', 'GB', 'START', '20.1 and 23.2 in two games back with 6.5 targets a game; New England allows the 4th-fewest RB points.'],
    ],
  ],
  [
    'C34',
    [
      ['D\'Andre Swift', 'RB', 'CHI', 'START', '23.0, 19.0 and 27.9 the last three, 27 carries last week; Kyle Monangai did not practice Wednesday, so volume beats Tampa\'s fewest RB points allowed.'],
    ],
  ],
  [
    'C35',
    [
      ['Jonathan Taylor', 'RB', 'IND', 'START if active', 'Limited Wednesday; 18.5 carries a game, and Dallas allows the 4th-most RB points.'],
    ],
  ],
  [
    'C36',
    [
      ['Chuba Hubbard', 'RB', 'CAR', 'START', '24.9 last week on 22 carries and 8 targets; Denver allows the 10th-most RB points.'],
    ],
  ],
  [
    'C37',
    [
      ['James Cook III', 'RB', 'BUF', 'START', '18.8 a game on 19.7 carries; Minnesota allows the 6th-fewest RB points.'],
    ],
  ],
  [
    'C38',
    [
      ['Javonte Williams', 'RB', 'DAL', 'START', '16.8 carries a game, 24 last week; Dallas implied for 28.5 and Indianapolis allows the 9th-most RB points.'],
    ],
  ],
  [
    'C39',
    [
      ['Bijan Robinson', 'RB', 'ATL', 'START', '19.2 a game with 19 carries last week; Brian Robinson Jr. was limited Wednesday; Cincinnati allows the 9th-fewest RB points in a 52.5 total.'],
    ],
  ],
  [
    'C40',
    [
      ['Kyren Williams', 'RB', 'LAR', 'START', '18.9 a game; Los Angeles implied for 26.5, and Washington allows the 7th-fewest RB points.'],
    ],
  ],
  [
    'C41',
    [
      ['Bhayshul Tuten', 'RB', 'JAX', 'START if active', 'Questionable Thursday (ankle, foot) after not practicing; 24.7 and 29.9 the last two, and Jacksonville is implied for 24.75.'],
      ['Chris Rodriguez Jr.', 'RB', 'JAX', 'SIT', 'Limited this week; the lead job only if Tuten sits; 12.8 last week on 6 carries.'],
    ],
  ],
  [
    'C42',
    [
      ['Chase Brown', 'RB', 'CIN', 'START', '9 targets last week and 6.0 a game; Cincinnati implied for 27.75, and Atlanta allows the 5th-most RB points.'],
    ],
  ],
  [
    'C43',
    [
      ['Rhamondre Stevenson', 'RB', 'NE', 'START', '19 carries on 77% of the snaps last week; TreVeyon Henderson did not practice Wednesday (illness), and Green Bay allows the 7th-most RB points.'],
    ],
  ],
  [
    'C44',
    [
      ['Bucky Irving', 'RB', 'TB', 'START', '24.0 and 21.0 the last two, 18.4 carries a game; Chicago allows the 3rd-fewest RB points.'],
    ],
  ],
  [
    'C45',
    [
      ['Jonah Coleman', 'RB', 'DEN', 'FLEX', '20.4 last week on 66% of the snaps with RJ Harvey on IR; Carolina allows the 2nd-most RB points.'],
    ],
  ],
  [
    'C46',
    [
      ['Tyler Allgeier', 'RB', 'ARI', 'FLEX', '36.1 last week; Jeremiyah Love is on IR and Bam Knight is in the concussion protocol, but Arizona is implied for 15.5.'],
    ],
  ],
  [
    'C47',
    [
      ['Ashton Jeanty', 'RB', 'LV', 'FLEX', '16.7 a game with 6.0 targets, but 2 carries on 40% of the snaps last week.'],
      ['Mike Washington Jr.', 'RB', 'LV', 'SIT', '25 carries for 8.3 last week with no targets; Las Vegas is a 10-point underdog.'],
    ],
  ],
  [
    'C48',
    [
      ['Braelon Allen', 'RB', 'NYJ', 'FLEX', '19.4 and 23.3 the last two on 83% of the snaps; Breece Hall is still limited.'],
      ['Breece Hall', 'RB', 'NYJ', 'SIT', 'Limited Wednesday (quadriceps); has not played since Week 3.'],
    ],
  ],
  [
    'C49',
    [
      ['Woody Marks', 'RB', 'HOU', 'FLEX', '19 carries on 89% of the snaps in Week 7, David Montgomery is out; the Chargers allow the 11th-most RB points.'],
    ],
  ],
  [
    'C50',
    [
      ['Quinshon Judkins', 'RB', 'CLE', 'FLEX', '12.4 a game; New Orleans allows the most RB points, though Cleveland is implied for 19.75.'],
    ],
  ],
  [
    'C51',
    [
      ['Cam Skattebo', 'RB', 'NYG', 'FLEX if active', 'Did not practice Wednesday (hamstring), day-to-day; 19.1 on 17 carries in Week 7.'],
      ['Devin Singletary', 'RB', 'NYG', 'SIT', 'The lead job only if Skattebo sits; 14.5 in Week 7.'],
    ],
  ],
  [
    'C52',
    [
      ['Alvin Kamara', 'RB', 'NO', 'FLEX if active', 'Did not practice Wednesday (rest, back); 14.9 and 13.2 before the bye with 4.5 targets a game.'],
    ],
  ],
  [
    'C53',
    [
      ['Rachaad White', 'RB', 'WAS', 'FLEX', '15.7 and 14.0 the last two; Jacory Croskey-Merritt is on IR and Jeremy McNichols is out for months.'],
    ],
  ],
  [
    'C54',
    [
      ['Derrick Henry', 'RB', 'BAL', 'SIT', '5.0, 5.9 and 14.0 the last three; Baltimore implied for 14.75, and Jacksonville allows the 2nd-fewest RB points.'],
    ],
  ],
  [
    'C55',
    [
      ['Saquon Barkley', 'RB', 'PHI', 'SIT', 'Did not practice Wednesday (hamstring, back); 32% of the snaps last week and Philadelphia is implied for 17.5.'],
    ],
  ],
  [
    'C56',
    [
      ['Aaron Jones Sr.', 'RB', 'MIN', 'SIT', '3.6 and 6.0 the last two; Buffalo allows the 3rd-most RB points but Minnesota\'s backfield is split.'],
      ['Jordan Mason', 'RB', 'MIN', 'SIT', '6.8 and 2.0 the last two.'],
    ],
  ],
  [
    'C57',
    [
      ['Ollie Gordon II', 'RB', 'MIA', 'SIT', '19 carries for 6.9 last week and 1.5 targets a game; Detroit allows the 5th-fewest RB points.'],
    ],
  ],
  [
    'C58',
    [
      ['Blake Corum', 'RB', 'LAR', 'SIT', '14.0, 17.1 and 13.3 the last three on 9.4 carries a game; the No. 2 behind Kyren Williams.'],
    ],
  ],
  [
    'C59',
    [
      ['Zach Charbonnet', 'RB', 'SEA', 'SIT', '6 carries in his first game last week, with Jadarian Price at 10; a split backfield.'],
      ['Emanuel Wilson', 'RB', 'SEA', 'SIT', 'Did not appear in the Week 8 box score; 18.5 in Week 7.'],
    ],
  ],
  [
    'C60',
    [
      ['Emmett Johnson', 'RB', 'KC', 'SIT', '25.3 last week on 19% of the snaps and one carry.'],
    ],
  ],
  [
    'C61',
    [
      ['Kenny Gainwell', 'RB', 'TB', 'SIT', 'Limited Wednesday (hip); 25 carries for 14.0 last week.'],
    ],
  ],
  [
    'C62',
    [
      ['RJ Harvey', 'RB', 'DEN', 'OUT', 'On IR (knee); the engine still projects 12.7.'],
    ],
  ],
  [
    'C63',
    [
      ['De\'Von Achane', 'RB', 'MIA', 'OUT', 'On IR (knee); the engine still projects 12.3.'],
    ],
  ],
  [
    'C64',
    [
      ['Travis Etienne Jr.', 'RB', 'NO', 'OUT', 'On IR (hamstring), practice window not opened; the engine still projects 11.9.'],
    ],
  ],
  [
    'C65',
    [
      ['Jeremiyah Love', 'RB', 'ARI', 'OUT', 'On IR, high ankle sprain; the engine still projects 8.5.'],
    ],
  ],
  [
    'C66',
    [
      ['Jaxon Smith-Njigba', 'WR', 'SEA', 'START if active', 'Limited on the NFL.com report; 36% target share, 27.6 a game, and Arizona allows the 13th-most WR points.'],
    ],
  ],
  [
    'C67',
    [
      ['Puka Nacua', 'WR', 'LAR', 'START', '34% target share, 12.3 targets a game, 25.0 last week; Washington allows the 11th-most WR points.'],
    ],
  ],
  [
    'C68',
    [
      ['Ja\'Marr Chase', 'WR', 'CIN', 'START', '31.1 last week on 16 targets; Cincinnati implied for 27.75 in a 52.5 total.'],
    ],
  ],
  [
    'C69',
    [
      ['Tee Higgins', 'WR', 'CIN', 'START', '26.8 and 37.5 the last two on a 23% target share.'],
    ],
  ],
  [
    'C70',
    [
      ['CeeDee Lamb', 'WR', 'DAL', 'START', '32% target share, 11.5 targets a game; Dallas implied for 28.5.'],
    ],
  ],
  [
    'C71',
    [
      ['Malik Nabers', 'WR', 'NYG', 'START', '29.1, 28.5 and 18.1 before the bye; Philadelphia allows the 2nd-most WR points.'],
    ],
  ],
  [
    'C72',
    [
      ['Amon-Ra St. Brown', 'WR', 'DET', 'START if active', 'Limited Wednesday (ribs); 32% target share, though Miami allows the 3rd-fewest WR points.'],
    ],
  ],
  [
    'C73',
    [
      ['Matthew Golden', 'WR', 'GB', 'START', '10.3 targets a game, 13 last week for 20.9; New England allows the 7th-most WR points.'],
    ],
  ],
  [
    'C74',
    [
      ['Christian Watson', 'WR', 'GB', 'START if active', 'Limited Wednesday (ribs); 18.4 a game, 49% of the snaps last week.'],
    ],
  ],
  [
    'C75',
    [
      ['Chris Olave', 'WR', 'NO', 'START', '27% target share, 10.1 targets a game; Cleveland allows the 13th-fewest WR points.'],
    ],
  ],
  [
    'C76',
    [
      ['Jameson Williams', 'WR', 'DET', 'START', '26.1 and 17.0 the last two; more of the passing game is his if St. Brown sits.'],
    ],
  ],
  [
    'C77',
    [
      ['Luther Burden III', 'WR', 'CHI', 'START', '17.5, 23.7 and 18.6 the last three; Chicago implied for 26.75.'],
    ],
  ],
  [
    'C78',
    [
      ['Tetairoa McMillan', 'WR', 'CAR', 'START', '27% target share, 11 targets last week; Denver allows the 8th-fewest WR points.'],
    ],
  ],
  [
    'C79',
    [
      ['Justin Jefferson', 'WR', 'MIN', 'START', '27% target share, 14.3 last week; Buffalo allows the 6th-most WR points.'],
    ],
  ],
  [
    'C80',
    [
      ['Drake London', 'WR', 'ATL', 'START', '29% target share, 1.8 in the rain last week; Zachariah Branch is out, in a 52.5 total.'],
    ],
  ],
  [
    'C81',
    [
      ['Rashee Rice', 'WR', 'KC', 'FLEX if active', 'Limited Wednesday (hamstring, knee); 18.3 on 8 targets last week and Kansas City implied for 28.75.'],
    ],
  ],
  [
    'C82',
    [
      ['Mike Evans', 'WR', 'SF', 'FLEX if active', 'Did not practice Wednesday (Achilles, ribs), has not played since Week 6; 14.8 a game, San Francisco implied for 31.25.'],
    ],
  ],
  [
    'C83',
    [
      ['Parker Washington', 'WR', 'JAX', 'FLEX', '24% target share, 3.6 last week; Baltimore allows the 10th-most WR points.'],
    ],
  ],
  [
    'C84',
    [
      ['George Pickens', 'WR', 'DAL', 'FLEX if active', 'Limited Wednesday (hamstring); 7.8 targets a game, Dallas implied for 28.5.'],
    ],
  ],
  [
    'C85',
    [
      ['Nico Collins', 'WR', 'HOU', 'FLEX', '22% target share with Jaylin Noel on IR; 15.2 a game.'],
    ],
  ],
  [
    'C86',
    [
      ['Stefon Diggs', 'WR', 'WAS', 'FLEX if active', 'Did not practice Wednesday; 23% target share with Terry McLaurin on IR, though the Rams allow the 5th-fewest WR points.'],
    ],
  ],
  [
    'C87',
    [
      ['Keenan Allen', 'WR', 'IND', 'FLEX if active', 'Did not practice Wednesday; 13.7 on 7 targets last week, and Dallas allows the 9th-most WR points.'],
    ],
  ],
  [
    'C88',
    [
      ['Caleb Douglas', 'WR', 'MIA', 'FLEX', '21.0 and 8.3 the last two on 86% of the snaps last week; Detroit allows the 4th-most WR points.'],
    ],
  ],
  [
    'C89',
    [
      ['Malik Washington', 'WR', 'MIA', 'FLEX', '25% target share, 15.0 last week; Detroit allows the 4th-most WR points.'],
    ],
  ],
  [
    'C90',
    [
      ['Michael Wilson', 'WR', 'ARI', 'FLEX if active', 'Limited Wednesday (ribs, rest); 15 targets for 26.8 last week, but Seattle allows the fewest WR points.'],
    ],
  ],
  [
    'C91',
    [
      ['Josh Downs', 'WR', 'IND', 'FLEX', '20% target share, 12.3 last week; Allen did not practice Wednesday.'],
    ],
  ],
  [
    'C92',
    [
      ['Adonai Mitchell', 'WR', 'NYJ', 'FLEX', '27.2 on 9 targets last week; Garrett Wilson is in the concussion protocol, though Kansas City allows the 2nd-fewest WR points.'],
    ],
  ],
  [
    'C93',
    [
      ['Ryan Flournoy', 'WR', 'DAL', 'FLEX', '17.0, 11.0 and 13.1 the last three; Dallas implied for 28.5 and Pickens is limited.'],
    ],
  ],
  [
    'C94',
    [
      ['Devaughn Vele', 'WR', 'NO', 'FLEX', '19% target share, 16.4 before the bye.'],
    ],
  ],
  [
    'C95',
    [
      ['Jalen Coker', 'WR', 'CAR', 'FLEX', '22% target share, 86% of the snaps last week; 13.2 a game, though Denver allows the 8th-fewest WR points.'],
    ],
  ],
  [
    'C96',
    [
      ['Zay Flowers', 'WR', 'BAL', 'SIT', '0.0 on 5 targets last week after Jackson and Huntley went down; Baltimore is implied for 14.75; the engine still projects 16.9.'],
    ],
  ],
  [
    'C97',
    [
      ['DeVonta Smith', 'WR', 'PHI', 'SIT', 'Did not practice Wednesday (hamstring); last played Week 6.'],
    ],
  ],
  [
    'C98',
    [
      ['Deebo Samuel Sr.', 'WR', 'SF', 'SIT', 'Did not practice Wednesday (hamstring); last played Week 5.'],
    ],
  ],
  [
    'C99',
    [
      ['A.J. Brown', 'WR', 'NE', 'SIT', 'Did not practice Wednesday (knee, ankle); 6.4 a game.'],
    ],
  ],
  [
    'C100',
    [
      ['Garrett Wilson', 'WR', 'NYJ', 'SIT', 'In the concussion protocol, did not practice Wednesday.'],
    ],
  ],
  [
    'C101',
    [
      ['Emeka Egbuka', 'WR', 'TB', 'SIT', 'Did not practice Wednesday (foot), running on the side; last played Week 6.'],
    ],
  ],
  [
    'C102',
    [
      ['Tre Tucker', 'WR', 'LV', 'SIT', '0.0 on 1 target last week after 26.7 and 21.3.'],
    ],
  ],
  [
    'C103',
    [
      ['Omar Cooper Jr.', 'WR', 'NYJ', 'SIT', 'Not in the Week 8 box score and not on the practice report; 22.3 and 22.5 the two before.'],
    ],
  ],
  [
    'C104',
    [
      ['DJ Moore', 'WR', 'BUF', 'SIT', 'Left late last week with a knee issue and says he is okay; 10.8 a game, and Minnesota allows the 4th-fewest WR points.'],
    ],
  ],
  [
    'C105',
    [
      ['Davante Adams', 'WR', 'LAR', 'OUT', 'On IR after hamstring surgery; the engine still projects 16.2.'],
    ],
  ],
  [
    'C106',
    [
      ['Alec Pierce', 'WR', 'IND', 'OUT', 'On IR (heel), no timetable; the engine still projects 10.1.'],
    ],
  ],
  [
    'C107',
    [
      ['Romeo Doubs', 'WR', 'NE', 'OUT', 'On IR (shoulder); the engine still projects 10.0.'],
    ],
  ],
  [
    'C108',
    [
      ['Terry McLaurin', 'WR', 'WAS', 'OUT', 'On IR after knee surgery; the engine still projects 9.0.'],
    ],
  ],
  [
    'C109',
    [
      ['Brock Bowers', 'TE', 'LV', 'START', '29% target share, 10.2 targets a game, 28.2 last week.'],
    ],
  ],
  [
    'C110',
    [
      ['Trey McBride', 'TE', 'ARI', 'START', '28% target share, 10.8 targets a game, 27.1 and 20.2 the last two.'],
    ],
  ],
  [
    'C111',
    [
      ['George Kittle', 'TE', 'SF', 'START', '15.1 a game, San Francisco implied for 31.25; Las Vegas allows the 4th-most TE points.'],
    ],
  ],
  [
    'C112',
    [
      ['Harold Fannin Jr.', 'TE', 'CLE', 'START', '23.4 on 12 targets last week; New Orleans allows the 8th-most TE points.'],
    ],
  ],
  [
    'C113',
    [
      ['Sam LaPorta', 'TE', 'DET', 'START', '12.3 a game; Detroit implied for 28.75 and Miami allows the 3rd-most TE points.'],
    ],
  ],
  [
    'C114',
    [
      ['Tyler Warren', 'TE', 'IND', 'START', '23% target share, 10 targets in his return last week; Dallas allows the 12th-most TE points.'],
    ],
  ],
  [
    'C115',
    [
      ['Travis Kelce', 'TE', 'KC', 'START if active', 'Limited Wednesday (ankle); 19% target share and Kansas City implied for 28.75.'],
    ],
  ],
  [
    'C116',
    [
      ['Isaiah Likely', 'TE', 'NYG', 'START', '16.1 a game, 27% target share; Philadelphia allows the 3rd-fewest TE points.'],
    ],
  ],
  [
    'C117',
    [
      ['Colston Loveland', 'TE', 'CHI', 'START', '18.5, 19.9 and 11.5 the last three on 12 and 9 targets the last two.'],
    ],
  ],
  [
    'C118',
    [
      ['Tucker Kraft', 'TE', 'GB', 'START', '14.8 and 17.3 the last two; New England allows the 9th-fewest TE points.'],
    ],
  ],
  [
    'C119',
    [
      ['T.J. Hockenson', 'TE', 'MIN', 'START', '13.5 and 15.8 the last two; Buffalo allows the 12th-most TE points.'],
    ],
  ],
  [
    'C120',
    [
      ['Mike Gesicki', 'TE', 'CIN', 'START', '17.6 last week with Erick All Jr. out for the season; Cincinnati implied for 27.75; TE12.'],
    ],
  ],
  [
    'C121',
    [
      ['Kyle Pitts Sr.', 'TE', 'ATL', 'SIT', '23.0, 13.2 and 2.6 the last three; Cincinnati allows the 7th-most TE points; TE13.'],
    ],
  ],
  [
    'C122',
    [
      ['Dalton Kincaid', 'TE', 'BUF', 'SIT', '18.6 last week, but Minnesota allows the fewest TE points; TE14.'],
    ],
  ],
  [
    'C123',
    [
      ['Dallas Goedert', 'TE', 'PHI', 'SIT', 'Full practice, 10.7 a game, but Philadelphia is implied for 17.5.'],
    ],
  ],
  [
    'C124',
    [
      ['Mason Taylor', 'TE', 'NYJ', 'SIT', 'Limited Wednesday (back); 25.2 and 4.9 the last two.'],
    ],
  ],
  [
    'C125',
    [
      ['Hunter Henry', 'TE', 'NE', 'SIT', 'Did not practice Wednesday (foot); left after 13% of the snaps last week.'],
    ],
  ],
  [
    'C126',
    [
      ['Jake Ferguson', 'TE', 'DAL', 'SIT', 'Did not practice Wednesday (ankle); 9% target share.'],
    ],
  ],
  [
    'C127',
    [
      ['Seattle Seahawks', 'DEF', 'SEA', 'START', 'Arizona implied for 15.5 with an unsettled quarterback; 11.0 a game.'],
    ],
  ],
  [
    'C128',
    [
      ['Jacksonville Jaguars', 'DEF', 'JAX', 'START', 'Baltimore implied for 14.75, the lowest on the slate, with Jackson and Huntley out; 24 last week.'],
    ],
  ],
  [
    'C129',
    [
      ['Houston Texans', 'DEF', 'HOU', 'START', 'The Chargers implied for 18.0; Justin Herbert scored 8.8 and 7.8 in his last two.'],
    ],
  ],
  [
    'C130',
    [
      ['Kansas City Chiefs', 'DEF', 'KC', 'START', '10-point favorites; the Jets implied for 18.75 with Garrett Wilson in the concussion protocol.'],
    ],
  ],
  [
    'C131',
    [
      ['Chicago Bears', 'DEF', 'CHI', 'START', 'Tampa implied for 20.75; Baker Mayfield scored 6.7 and 1.4 the last two.'],
    ],
  ],
  [
    'C132',
    [
      ['New York Giants', 'DEF', 'NYG', 'START', 'Philadelphia implied for 17.5, with Tanner McKee scoring 7.0 last week and Barkley and Smith not practicing Wednesday.'],
    ],
  ],
  [
    'C133',
    [
      ['Minnesota Vikings', 'DEF', 'MIN', 'START', '13.9 a game, the best on the slate, at home in a dome.'],
    ],
  ],
  [
    'C134',
    [
      ['Denver Broncos', 'DEF', 'DEN', 'START', 'Carolina implied for 21.0; Bryce Young scored 5.4 and 10.4 the last two.'],
    ],
  ],
];

const SLOT = (slot) => GAMES.filter((g) => g.slot === slot).map((g) => <GameCard key={g.id} g={g} />);

const QB_NEXT = 'Sits and unranked: Tyler Shough, Michael Penix Jr., Bo Nix, Bryce Young, Malik Willis, Geno Smith, Drew Lock, Deshaun Watson, Kyler Murray, Gardner Minshew II, Jacoby Brissett and Joe Fagnano. Out: Lamar Jackson (the engine still projects 13.9), Tyler Huntley, Sam Darnold (15.3) and Jalen Hurts (18.0). Aaron Rodgers and Cam Ward are on bye.';
const RB_NEXT = 'Sits: Derrick Henry, Saquon Barkley, Breece Hall, Aaron Jones Sr., Jordan Mason, Ollie Gordon II, Blake Corum, Zach Charbonnet, Emanuel Wilson, Emmett Johnson, Kenny Gainwell, Mike Washington Jr., and the handcuffs Kaelon Black, Chris Rodriguez Jr. and Devin Singletary. Out, all engine placeholders on IR: RJ Harvey (12.7), De\'Von Achane (12.3), Travis Etienne Jr. (11.9) and Jeremiyah Love (8.5).';
const WR_NEXT = 'Sits: Zay Flowers, DeVonta Smith, Deebo Samuel Sr., A.J. Brown, Garrett Wilson, Emeka Egbuka, Tre Tucker, Omar Cooper Jr. and DJ Moore. Out, all engine placeholders on IR: Davante Adams (16.2), Alec Pierce (10.1), Romeo Doubs (10.0) and Terry McLaurin (9.0). Nobody from Pittsburgh or Tennessee is ranked.';
const TE_NEXT = 'Sits: Dallas Goedert, Mason Taylor, Hunter Henry and Jake Ferguson. Kyle Pitts Sr. and Dalton Kincaid are ranked 13th and 14th with sit rulings.';
const DST_TIER_NEXT = 'Every D/ST in the top eight has a ruling. Tampa Bay scored 29 and 22 the last two weeks but faces Chicago at 26.75, so do not chase it.';

// Injury board rows are [name, position, team, status, pivot, tone, ruling].
// Statuses are the Wednesday practice reports; no Thursday report existed when this was written.

const INJ_OUT = [
  ['Lamar Jackson', 'QB', 'BAL', 'Out Thursday, thumb surgery and IR; the engine still projects 13.9.', 'Joe Fagnano is next up and a sit.', 'out', 'C26'],
  ['Tyler Huntley', 'QB', 'BAL', 'Out Thursday, turf toe reported as season-ending.', 'Joe Fagnano is next up and a sit.', 'out', 'C27'],
  ['Sam Darnold', 'QB', 'SEA', 'Ruled out Sunday (quadriceps), week-to-week; the engine still projects 15.3.', 'Drew Lock is slated to start and is a sit.', 'out', 'C28'],
  ['Jalen Hurts', 'QB', 'PHI', 'On IR, blood clots in his lungs, expected to miss the season; the engine still projects 18.0.', 'Tanner McKee has no ruling, and Philadelphia is implied for 17.5.', 'out', 'C29'],
  ['RJ Harvey', 'RB', 'DEN', 'On IR (knee); the engine still projects 12.7.', 'Jonah Coleman (FLEX, RB16).', 'out', 'C62'],
  ['De\'Von Achane', 'RB', 'MIA', 'On IR (knee); the engine still projects 12.3.', 'Ollie Gordon II is a sit.', 'out', 'C63'],
  ['Travis Etienne Jr.', 'RB', 'NO', 'On IR (hamstring), practice window not opened; the engine still projects 11.9.', 'Alvin Kamara (FLEX if active, RB23).', 'out', 'C64'],
  ['Jeremiyah Love', 'RB', 'ARI', 'On IR, high ankle sprain; the engine still projects 8.5.', 'Tyler Allgeier (FLEX, RB17).', 'out', 'C65'],
  ['Davante Adams', 'WR', 'LAR', 'On IR after hamstring surgery; the engine still projects 16.2.', 'Puka Nacua (START, WR2).', 'out', 'C105'],
  ['Alec Pierce', 'WR', 'IND', 'On IR (heel), no timetable; the engine still projects 10.1.', 'Keenan Allen (FLEX if active, WR22) and Josh Downs (FLEX, WR26).', 'out', 'C106'],
  ['Romeo Doubs', 'WR', 'NE', 'On IR (shoulder); the engine still projects 10.0.', 'A.J. Brown is a sit, and no other New England receiver has a call.', 'out', 'C107'],
  ['Terry McLaurin', 'WR', 'WAS', 'On IR after knee surgery; the engine still projects 9.0.', 'Stefon Diggs (FLEX if active, WR21).', 'out', 'C108'],
];

const INJ_THU = [
  ['Bhayshul Tuten', 'RB', 'JAX', 'Questionable Thursday (ankle, foot) after not practicing; 24.7 and 29.9 the last two, and Jacksonville is implied for 24.75.', 'Chris Rodriguez Jr. takes the lead job. He is a sit on the record and a pivot if you need a back. Make any swap before the 8:15p ET kickoff.', 'gtd', 'C41'],
];

const INJ_MADRID = [];

const INJ_ONE = [
  ['Jonathan Taylor', 'RB', 'IND', 'Limited Wednesday; 18.5 carries a game, and Dallas allows the 4th-most RB points.', 'No other Indianapolis back has a call. Carry a back who kicks off at 4:05p or later.', 'gtd', 'C35'],
  ['Cam Skattebo', 'RB', 'NYG', 'Did not practice Wednesday (hamstring), day-to-day; 19.1 on 17 carries in Week 7.', 'Devin Singletary takes the lead job and is a sit on the record. Carry a flex who kicks off at 4:05p or later.', 'gtd', 'C51'],
  ['Alvin Kamara', 'RB', 'NO', 'Did not practice Wednesday (rest, back); 14.9 and 13.2 before the bye with 4.5 targets a game.', 'Kendre Miller has no ruling, no call. Carry a flex who kicks off at 4:05p or later.', 'gtd', 'C52'],
  ['Amon-Ra St. Brown', 'WR', 'DET', 'Limited Wednesday (ribs); 32% target share, though Miami allows the 3rd-fewest WR points.', 'Jameson Williams (START, WR11) gets more of the passing game.', 'gtd', 'C72'],
  ['Rashee Rice', 'WR', 'KC', 'Limited Wednesday (hamstring, knee); 18.3 on 8 targets last week and Kansas City implied for 28.75.', 'No other Kansas City receiver has a call. Carry a flex who kicks off at 4:05p or later.', 'gtd', 'C81'],
  ['George Pickens', 'WR', 'DAL', 'Limited Wednesday (hamstring); 7.8 targets a game, Dallas implied for 28.5.', 'CeeDee Lamb (START, WR5) and Ryan Flournoy (FLEX, WR28).', 'gtd', 'C84'],
  ['Stefon Diggs', 'WR', 'WAS', 'Did not practice Wednesday; 23% target share with Terry McLaurin on IR, though the Rams allow the 5th-fewest WR points.', 'No other Washington receiver has a call. Carry a flex who kicks off at 4:05p or later.', 'gtd', 'C86'],
  ['Keenan Allen', 'WR', 'IND', 'Did not practice Wednesday; 13.7 on 7 targets last week, and Dallas allows the 9th-most WR points.', 'Josh Downs (FLEX, WR26).', 'gtd', 'C87'],
  ['Travis Kelce', 'TE', 'KC', 'Limited Wednesday (ankle); 19% target share and Kansas City implied for 28.75.', 'Carry a later tight end: Bowers, McBride or Kittle at 4:25p, Loveland on Sunday night or Hockenson on Monday.', 'gtd', 'C115'],
  ['Deshaun Watson', 'QB', 'CLE', 'Did not practice Wednesday (concussion); 11.2 last week and Cleveland is implied for 19.75.', 'No Cleveland quarterback has a start call.', 'sit', 'C22'],
  ['Breece Hall', 'RB', 'NYJ', 'Limited Wednesday (quadriceps); has not played since Week 3.', 'Braelon Allen (FLEX, RB19).', 'sit', 'C48'],
  ['Saquon Barkley', 'RB', 'PHI', 'Did not practice Wednesday (hamstring, back); 32% of the snaps last week and Philadelphia is implied for 17.5.', 'Elijah Mitchell has no ruling, no call.', 'sit', 'C55'],
  ['DeVonta Smith', 'WR', 'PHI', 'Did not practice Wednesday (hamstring); last played Week 6.', 'Makai Lemon has no ruling, no call.', 'sit', 'C97'],
  ['Garrett Wilson', 'WR', 'NYJ', 'In the concussion protocol, did not practice Wednesday.', 'Adonai Mitchell (FLEX, WR27).', 'sit', 'C100'],
  ['Mason Taylor', 'TE', 'NYJ', 'Limited Wednesday (back); 25.2 and 4.9 the last two.', 'No other Jets tight end has a call.', 'sit', 'C124'],
  ['Jake Ferguson', 'TE', 'DAL', 'Did not practice Wednesday (ankle); 9% target share.', 'Brevyn Spann-Ford has no ruling, no call.', 'sit', 'C126'],
];

const INJ_LATE = [
  ['Christian McCaffrey', 'RB', 'SF', 'Did not practice Wednesday (hamstring, described as mild); 20.6 a game and San Francisco implied for 31.25.', 'Kaelon Black takes the work and is a sit on the record. Carry a later back: Swift or Irving on Sunday night, Cook on Monday.', 'gtd', 'C32'],
  ['Jaxon Smith-Njigba', 'WR', 'SEA', 'Limited on the NFL.com report; 36% target share, 27.6 a game, and Arizona allows the 13th-most WR points.', 'No other Seattle receiver has a call. Carry a receiver who kicks off Sunday night or Monday.', 'gtd', 'C66'],
  ['Michael Wilson', 'WR', 'ARI', 'Limited Wednesday (ribs, rest); 15 targets for 26.8 last week, but Seattle allows the fewest WR points.', 'No other Arizona receiver has a call. Carry a receiver who kicks off Sunday night or Monday.', 'gtd', 'C90'],
  ['Christian Watson', 'WR', 'GB', 'Limited Wednesday (ribs); 18.4 a game, 49% of the snaps last week.', 'Matthew Golden (START, WR8) stays the Green Bay call.', 'gtd', 'C74'],
  ['Mike Evans', 'WR', 'SF', 'Did not practice Wednesday (Achilles, ribs), has not played since Week 6; 14.8 a game, San Francisco implied for 31.25.', 'Deebo Samuel Sr. is a sit. Carry a receiver who kicks off Sunday night or Monday.', 'gtd', 'C82'],
  ['Drew Lock', 'QB', 'SEA', 'Slated to start with Darnold out, carrying an elbow injury; Arizona allows the 2nd-most QB points, so a 2QB start.', 'No Seattle quarterback has a start call.', 'sit', 'C21'],
  ['Jacoby Brissett', 'QB', 'ARI', 'Did not practice Wednesday; replaced in the third quarter last week after 3.5.', 'Gardner Minshew II is first on the chart and is also a sit.', 'sit', 'C24'],
  ['Deebo Samuel Sr.', 'WR', 'SF', 'Did not practice Wednesday (hamstring); last played Week 5.', 'Mike Evans (FLEX if active, WR17).', 'sit', 'C98'],
  ['A.J. Brown', 'WR', 'NE', 'Did not practice Wednesday (knee, ankle); 6.4 a game.', 'No other New England receiver has a call.', 'sit', 'C99'],
  ['Hunter Henry', 'TE', 'NE', 'Did not practice Wednesday (foot); left after 13% of the snaps last week.', 'Eli Raridon has no ruling, no call.', 'sit', 'C125'],
];

const INJ_NIGHT = [
  ['Kenny Gainwell', 'RB', 'TB', 'Limited Wednesday (hip); 25 carries for 14.0 last week.', 'Bucky Irving (START, RB15).', 'sit', 'C61'],
  ['Emeka Egbuka', 'WR', 'TB', 'Did not practice Wednesday (foot), running on the side; last played Week 6.', 'No other Tampa Bay receiver has a call.', 'sit', 'C101'],
];

const INJ_MNF = [
  ['Kyler Murray', 'QB', 'MIN', 'Sore hamstring and a full evaluation this week; Carson Wentz is next, and Murray has 12.3 a game.', 'Carson Wentz is next, with no ruling and no call.', 'sit', 'C23'],
];

const ALREADY_OUT = ['Jacory Croskey-Merritt (WAS RB, IR)', 'Jeremy McNichols (WAS RB, out for months)', 'Jaylin Noel (HOU WR, IR)', 'David Montgomery (HOU RB, out)', 'Erick All Jr. (CIN TE, IR)', 'Zachariah Branch (ATL WR, out for Madrid)', 'Dameon Pierce (PHI RB, IR)', 'Tank Bigsby (PHI RB, IR)', 'Will Shipley (PHI RB, IR)'];

// Handcuff rows are [team, starter and status, handcuff, verdict].

const HANDCUFFS = [
  ['JAX', 'Bhayshul Tuten: questionable Thursday (ankle, foot) after not practicing.', 'Chris Rodriguez Jr.', 'SIT. Limited this week; the lead job only if Tuten sits; 12.8 last week on 6 carries.'],
  ['SF', 'Christian McCaffrey: did not practice Wednesday (hamstring, described as mild).', 'Kaelon Black', 'SIT. Takes the work only if McCaffrey sits; 10.9 on 12 carries in Week 7.'],
  ['NYG', 'Cam Skattebo: did not practice Wednesday (hamstring), day-to-day.', 'Devin Singletary', 'SIT. The lead job only if Skattebo sits; 14.5 in Week 7.'],
  ['NYJ', 'Breece Hall: limited Wednesday (quadriceps), has not played since Week 3.', 'Braelon Allen', 'FLEX, RB19. 19.4 and 23.3 the last two on 83% of the snaps; Breece Hall is still limited.'],
  ['ARI', 'Jeremiyah Love: on IR. Bam Knight: in the concussion protocol.', 'Tyler Allgeier', 'FLEX, RB17. 36.1 last week; Jeremiyah Love is on IR and Bam Knight is in the concussion protocol, but Arizona is implied for 15.5.'],
  ['DEN', 'RJ Harvey: on IR (knee).', 'Jonah Coleman', 'FLEX, RB16. 20.4 last week on 66% of the snaps with RJ Harvey on IR; Carolina allows the 2nd-most RB points. J.K. Dobbins has no ruling.'],
  ['HOU', 'David Montgomery: out.', 'Woody Marks', 'FLEX, RB20. 19 carries on 89% of the snaps in Week 7, David Montgomery is out; the Chargers allow the 11th-most RB points.'],
  ['CHI', 'Kyle Monangai: did not practice Wednesday.', 'D\'Andre Swift', 'START, RB5. 23.0, 19.0 and 27.9 the last three, 27 carries last week; Kyle Monangai did not practice Wednesday, so volume beats Tampa\'s fewest RB points allowed. Roschon Johnson has no ruling.'],
  ['NE', 'TreVeyon Henderson: did not practice Wednesday (illness).', 'Rhamondre Stevenson', 'START, RB14. 19 carries on 77% of the snaps last week; TreVeyon Henderson did not practice Wednesday (illness), and Green Bay allows the 7th-most RB points. Corey Kiner has no ruling.'],
  ['PHI', 'Saquon Barkley: did not practice Wednesday (hamstring, back).', 'Elijah Mitchell', 'No ruling, no call. 11 carries and 6 targets last week; Dameon Pierce, Tank Bigsby and Will Shipley are on IR.'],
  ['LAR', 'Kyren Williams: a start.', 'Blake Corum', 'SIT. 14.0, 17.1 and 13.3 the last three on 9.4 carries a game; the No. 2 behind Kyren Williams.'],
  ['NO', 'Alvin Kamara: did not practice Wednesday (rest, back).', 'Kendre Miller', 'No ruling, no call.'],
  ['TB', 'Bucky Irving: a start.', 'Kenny Gainwell', 'SIT. Limited Wednesday (hip); 25 carries for 14.0 last week.'],
  ['WAS', 'Rachaad White: a flex.', 'Austin Ekeler', 'No ruling, no call.'],
];

// D/ST rows are [d/st, opponent, opp implied, verdict, why].

const DST_TABLE = [
  ['Seattle Seahawks', 'vs ARI', '15.5', 'START (DST1)', 'Arizona implied for 15.5 with an unsettled quarterback; 11.0 a game.'],
  ['Jacksonville Jaguars', 'at BAL', '14.75', 'START (DST2)', 'Baltimore implied for 14.75, the lowest on the slate, with Jackson and Huntley out; 24 last week.'],
  ['Houston Texans', 'at LAC', '18', 'START (DST3)', 'The Chargers implied for 18.0; Justin Herbert scored 8.8 and 7.8 in his last two.'],
  ['Kansas City Chiefs', 'vs NYJ', '18.75', 'START (DST4)', '10-point favorites; the Jets implied for 18.75 with Garrett Wilson in the concussion protocol.'],
  ['Chicago Bears', 'vs TB', '20.75', 'START (DST5)', 'Tampa implied for 20.75; Baker Mayfield scored 6.7 and 1.4 the last two.'],
  ['New York Giants', 'at PHI', '17.5', 'START (DST6)', 'Philadelphia implied for 17.5, with Tanner McKee scoring 7.0 last week and Barkley and Smith not practicing Wednesday.'],
  ['Minnesota Vikings', 'vs BUF', '24.5', 'START (DST7)', '13.9 a game, the best on the slate, at home in a dome.'],
  ['Denver Broncos', 'at CAR', '21', 'START (DST8)', 'Carolina implied for 21.0; Bryce Young scored 5.4 and 10.4 the last two.'],
];

// IDP rows are [player, team, position, opponent, note].

const IDP_TABLE = [
  ['Blake Cashman', 'MIN', 'LB', 'vs BUF', '23.0 two weeks ago, 11.8 a game'],
  ['Alex Singleton', 'DEN', 'LB', 'at CAR', '20.5 and 15.0 the last two, 11.4 a game'],
  ['Evan Williams', 'GB', 'S', 'at NE', '10.7 a game, 8.5 last week'],
  ['Nakobe Dean', 'LV', 'LB', 'at SF', '10.6 a game; Las Vegas is a 10-point underdog'],
  ['Ernest Jones IV', 'SEA', 'LB', 'vs ARI', '10.3 a game, 10.0 last week'],
  ['Fred Warner', 'SF', 'LB', 'vs LV', '9.8 a game, 11.5 last time out'],
  ['Quentin Lake', 'LAR', 'S', 'at WAS', '9.5 a game, 12.5 last week'],
  ['Foyesade Oluokun', 'JAX', 'LB', 'at BAL (Thursday)', '9.4 a game, 12.0 last week'],
];

const IDP_AVOID = 'Edgerrin Cooper and Tremaine Edmunds are on IR. Talanoa Hufanga and Bobby Okereke did not practice Wednesday. Jordan Battle was limited.';

const SLEEPERS = [
  ['Jonah Coleman', 'FLEX, RB16. 20.4 last week on 66% of the snaps with RJ Harvey on IR; Carolina allows the 2nd-most RB points.', 'RB'],
  ['Woody Marks', 'FLEX, RB20. 19 carries on 89% of the snaps in Week 7, David Montgomery is out; the Chargers allow the 11th-most RB points.', 'RB'],
  ['Adonai Mitchell', 'FLEX, WR27. 27.2 on 9 targets last week; Garrett Wilson is in the concussion protocol, though Kansas City allows the 2nd-fewest WR points.', 'WR'],
  ['Caleb Douglas', 'FLEX, WR23. 21.0 and 8.3 the last two on 86% of the snaps last week; Detroit allows the 4th-most WR points.', 'WR'],
  ['Mike Gesicki', 'START, TE12. 17.6 last week with Erick All Jr. out for the season; Cincinnati implied for 27.75; TE12.', 'TE'],
];

const FADES = [
  ['Derrick Henry', 'SIT. 5.0, 5.9 and 14.0 the last three; Baltimore implied for 14.75, and Jacksonville allows the 2nd-fewest RB points.', 'RB'],
  ['Zay Flowers', 'SIT. 0.0 on 5 targets last week after Jackson and Huntley went down; Baltimore is implied for 14.75; the engine still projects 16.9.', 'WR'],
  ['Jordan Love', 'SIT, QB13. 18.7 a game and 21.5 last week, but Green Bay is implied for 21.0 and New England allows the 10th-fewest QB points; QB13.', 'QB'],
  ['Emmett Johnson', 'SIT. 25.3 last week on 19% of the snaps and one carry.', 'RB'],
  ['Kyle Pitts Sr.', 'SIT, TE13. 23.0, 13.2 and 2.6 the last three; Cincinnati allows the 7th-most TE points; TE13.', 'TE'],
];

const PIVOTS = [
  ['Tuten out', 'Chris Rodriguez Jr. takes the lead job. He is a sit on the record and a pivot if you need a back. Make any swap between the 6:45p ET inactives and the 8:15p ET kickoff.'],
  ['Lamar and Huntley out (already)', 'Joe Fagnano is next up and a sit. Zay Flowers and Derrick Henry are sits too.'],
  ['Darnold out (already)', 'Drew Lock is slated to start and is a sit. Jaxon Smith-Njigba stays a START if active, WR1.'],
  ['Love out (already)', 'Tyler Allgeier is a FLEX, RB17.'],
  ['Harvey out (already)', 'Jonah Coleman is a FLEX, RB16.'],
  ['Taylor out', 'No other Indianapolis back has a call. Swap to a back who kicks off at 4:05p or later.'],
  ['St. Brown out', 'Jameson Williams is a START, WR11 and gets more of the passing game.'],
  ['Pickens out', 'CeeDee Lamb stays a START, WR5, and Ryan Flournoy is a FLEX, WR28.'],
  ['Keenan Allen out', 'Josh Downs is a FLEX, WR26.'],
  ['Skattebo out', 'Devin Singletary takes the lead job and is a sit on the record. Swap to a flex who kicks off at 4:05p or later if you have one.'],
  ['Kamara, Diggs or Rice out', 'No teammate has a call. Swap to a flex who kicks off at 4:05p or later.'],
  ['Kelce out', 'Carry a later tight end: Bowers, McBride or Kittle at 4:25p, Loveland on Sunday night or Hockenson on Monday.'],
  ['McCaffrey out', 'Kaelon Black takes the work and is a sit on the record. Carry a later back: Swift or Irving on Sunday night, Cook on Monday.'],
  ['Evans out', 'Deebo Samuel Sr. is a sit. Swap to a receiver who kicks off Sunday night or Monday.'],
  ['Smith-Njigba or Michael Wilson out', 'Neither team has another receiver call. Swap to a receiver who kicks off Sunday night or Monday.'],
  ['Christian Watson out', 'Matthew Golden stays a START, WR8.'],
  ['Murray out', 'Carson Wentz is next, with no ruling and no call. Justin Jefferson and T.J. Hockenson stay starts. Monday night leaves no later window.'],
];

const CHECK_THU = [
  ['Bhayshul Tuten (JAX RB).', 'Active: START. Out: Chris Rodriguez Jr. has the lead job and is a pivot; his ruling stays a sit.'],
  ['Baltimore at quarterback.', 'Jackson and Huntley are out. Fagnano is a sit either way.'],
  ['Everyone else on the card.', 'Thursday locks first: make any swap between the 6:45p ET inactives and the 8:15p ET kickoff.'],
];

const CHECK_MADRID = [
  ['Nobody on this card has an if-active call.', 'Bijan Robinson stays a start. Brian Robinson Jr. was limited Wednesday and Zachariah Branch is out. Re-check Friday\'s reports.'],
];

const CHECK_ONE = [
  ['Jonathan Taylor (IND RB).', 'Active: START. Out: no other Indianapolis back has a call.'],
  ['Amon-Ra St. Brown (DET WR).', 'Active: START. Out: Jameson Williams stays the START and gets more of the passing game.'],
  ['Travis Kelce (KC TE).', 'Active: START. Out: carry a 4:25p tight end.'],
  ['George Pickens (DAL WR).', 'Active: FLEX. Out: CeeDee Lamb stays the START, and Ryan Flournoy stays a FLEX.'],
  ['Keenan Allen (IND WR).', 'Active: FLEX. Out: Josh Downs stays a FLEX.'],
  ['Stefon Diggs (WAS WR).', 'Active: FLEX. Out: no other Washington receiver has a call.'],
  ['Rashee Rice (KC WR).', 'Active: FLEX. Out: no other Kansas City receiver has a call.'],
  ['Cam Skattebo (NYG RB).', 'Active: FLEX. Out: Devin Singletary takes the lead job; his ruling stays a sit.'],
  ['Alvin Kamara (NO RB).', 'Active: FLEX. Out: Kendre Miller has no ruling.'],
  ['Sits either way.', 'Deshaun Watson, Breece Hall, Saquon Barkley, DeVonta Smith, Garrett Wilson, Mason Taylor and Jake Ferguson.'],
];

const CHECK_LATE = [
  ['Christian McCaffrey (SF RB).', 'Active: START. Out: Kaelon Black takes the work; his ruling stays a sit.'],
  ['Jaxon Smith-Njigba (SEA WR).', 'Active: START. Out: no other Seattle receiver has a call.'],
  ['Christian Watson (GB WR).', 'Active: START. Out: Matthew Golden stays the START.'],
  ['Mike Evans (SF WR).', 'Active: FLEX. Out: Deebo Samuel Sr. is a sit.'],
  ['Michael Wilson (ARI WR).', 'Active: FLEX. Out: no other Arizona receiver has a call.'],
  ['Sits either way.', 'Drew Lock, Jacoby Brissett, Deebo Samuel Sr., A.J. Brown and Hunter Henry.'],
];

const CHECK_SNF = [
  ['Nobody on this card has an if-active call.', 'Swift and Irving stay starts. Kyle Monangai has no ruling; Emeka Egbuka and Kenny Gainwell are sits.'],
];

const CHECK_MNF = [
  ['Kyler Murray (MIN QB).', 'A sit either way. Carson Wentz is next, with no ruling.'],
  ['DJ Moore (BUF WR).', 'A sit either way.'],
  ['Everyone else on the card.', 'Monday is the last window, so a scratch here has no later game to pivot to.'],
];

const Body = () => (
  <>
    <HeroBanner />

    <Lead>
      Fifteen games, Thursday through Monday. Pittsburgh and Tennessee are on bye, so 30 teams play.
      Jacksonville at Baltimore kicks off first, Thursday at 8:15p ET. Cincinnati and Atlanta play in
      Madrid at 9:30a ET Sunday, Tampa Bay at Chicago is the Sunday night game, and Buffalo at Minnesota
      closes the week Monday. At Baltimore, Tyler Huntley&apos;s turf toe is reported as season-ending,
      Lamar Jackson is headed for thumb surgery and IR, and Joe Fagnano took over Sunday. Seattle ruled
      Sam Darnold out, and Drew Lock is slated to start. Every call is here. Set your Thursday lineup
      first, and set your pivots before you go to bed Saturday.
    </Lead>

    <Note title="Read this first">
      <strong>Lines are our database as of Nov 5, 11:19am ET. Weather is as of 6:24am ET. Practice notes
      are the Wednesday reports, and no Thursday report was published when I wrote this.</strong>{' '}
      Updates since Tuesday&apos;s waiver column:
      <Box component="ul" sx={{ pl: 2.5, m: '8px 0 0 !important' }}>
        <li>Seattle ruled Sam Darnold out (quadriceps, week-to-week). Drew Lock (elbow) is slated to start. Tuesday&apos;s column had Darnold first in the superflex corner.</li>
        <li>Arizona placed Jeremiyah Love on IR Tuesday (high ankle sprain).</li>
        <li>Tyler Huntley&apos;s turf toe is reported as season-ending, and Lamar Jackson is headed for thumb surgery and IR. Joe Fagnano took over Sunday and was a full participant on the report. Baltimore had not named a Thursday starter in anything I could find.</li>
        <li>Jalen Hurts stays on IR: new imaging showed blood clots in his lungs. Tanner McKee practiced in full.</li>
        <li>Kyler Murray&apos;s hamstring is under evaluation. Carson Wentz is next on Minnesota&apos;s chart.</li>
        <li>From the Wednesday report: Zachariah Branch (ATL) is out for Madrid. Jacksonville&apos;s Jakobi Meyers and Chris Rodriguez Jr. were limited. Bam Knight (ARI) is in the concussion protocol and did not practice.</li>
      </Box>
      Re-check the Thursday and Friday reports and the inactives before you lock anything. Every window below says
      when the inactives drop. Every time on this page is Eastern.
    </Note>

    <P>
      Scoring is PPR. Pittsburgh and Tennessee are on bye, so nobody from those two is ranked or called.
      Where an engine projection is a placeholder (an injured or inactive player the model still scores),
      I say so and lean on usage.
    </P>
    <RailList
      items={[
        ['FPA rank', '1 means the defense allows the most points to that position (a good matchup), 32 the fewest (tough). Weeks 1 to 8.'],
        ['Verdicts', 'START, FLEX, SIT and OUT are the rulings. "If active" calls are void if the player does not appear, and they sit in the game-time group of each card.'],
        ['Tiers', 'QB 14, RB 24, WR 30, TE 14 and D/ST 8, in the order I rank them. A player ranked without a ruling says so.'],
        ['Ruling links', 'Every call on a card links to its Darkness Ruling (C1 to C134) with the reason.'],
      ]}
    />

    <JumpGrid />

    <H2>The Slate Board</H2>
    <P>
      Every game, in kickoff order with Thursday first: line, total, weather and both implied totals on
      one scale. Filled bars are the favorites. Cincinnati and Atlanta, and Las Vegas and San Francisco,
      share the highest total at 52.5. The lowest is the Giants and Philadelphia at 38.5. San Francisco
      has the highest implied total, 31.25, then Detroit and Kansas City at 28.75 and Dallas at 28.5.
      Baltimore (14.75) and Arizona (15.5) have the lowest. Jacksonville, Kansas City and San Francisco
      are the biggest favorites, all at -10.
    </P>
    <SlateBoard />
    <P>
      New Orleans, the Chargers and Minnesota play indoors. Madrid has no forecast in our data. Wind tops
      out at 10 mph in Rams-Washington, Giants-Philadelphia and Arizona-Seattle. Baltimore has a 21% chance
      of showers Thursday, and Seattle has a 23% chance of light rain. Nothing here is worth a points
      adjustment.
    </P>

    <H2>The Injury Board</H2>
    <P>
      The practice notes here are the Wednesday reports. The decision rules are simple, and I apply them
      the same way to every name on this page.
    </P>
    <RailList
      color="var(--warning)"
      items={[
        ['"If active" calls', 'are void if the player does not appear. A call that turns on a practice report carries that injury on its card.'],
        ['Engine placeholders', 'Hurts, Darnold, Adams, Pierce, Doubs, McLaurin, Harvey, Achane, Etienne and Lamar Jackson carry a projection. Each has an OUT ruling, so the projection is a placeholder.'],
        ['Byes', 'Pittsburgh and Tennessee: nobody is ranked or called.'],
      ]}
    />
    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, my: 2 }}>
      <Chip tone="var(--accent)">Thursday: about 6:45p ET</Chip>
      <Chip tone="var(--accent)">Madrid: about 8:00a ET Sunday</Chip>
      <Chip tone="var(--accent)">1:00p games: about 11:30a ET</Chip>
      <Chip tone="var(--accent)">4:05p / 4:25p: about 2:35p / 2:55p ET</Chip>
      <Chip tone="var(--accent)">SNF: about 6:50p ET</Chip>
      <Chip tone="var(--accent)">MNF: about 6:45p ET Monday</Chip>
    </Box>

    <InjuryGroup title="Out, or treat as out" when="Engine projections for these players are placeholders." rows={INJ_OUT} />
    <InjuryGroup title="Thursday" when="Inactives about 6:45p ET" rows={INJ_THU} />
    {INJ_MADRID.length ? <InjuryGroup title="Madrid" when="Inactives about 8:00a ET" rows={INJ_MADRID} /> : null}
    <InjuryGroup title="1:00p games" when="Inactives about 11:30a ET" rows={INJ_ONE} />
    <InjuryGroup title="Late window" when="Inactives about 2:35p / 2:55p ET" rows={INJ_LATE} />
    <InjuryGroup title="Sunday night" when="Inactives about 6:50p ET" rows={INJ_NIGHT} />
    <InjuryGroup title="Monday night" when="Inactives about 6:45p ET Monday; no later window" rows={INJ_MNF} />
    <Box component="h3" sx={{ m: '24px 0 8px !important', fontSize: '1.15rem !important' }}>Already out for the week or longer</Box>
    <Box component="p" sx={{ mt: '0 !important', fontSize: '0.92rem', color: 'var(--text-muted)', lineHeight: 1.6 }}>
      {ALREADY_OUT.join('; ')}.
    </Box>

    <H2>Thursday Night</H2>
    <P>
      One game, and it kicks off first. Inactives drop about 6:45p ET. Baltimore had not named a Thursday
      starter in anything I could find. Set your lineup before you do anything else on Thursday.
    </P>
    {SLOT('thu')}

    <H2>Sunday Morning in Madrid</H2>
    <P>
      Cincinnati and Atlanta play in Madrid (Bernabeu) at 9:30a ET Sunday, the first kickoff of the Sunday
      slate. Inactives drop about 8:00a ET. The Wednesday report has Zachariah Branch (ATL) out for Madrid.
    </P>
    {SLOT('madrid')}

    <H2>The 1:00p Window</H2>
    <P>
      Seven games at 1:00p ET. Nothing kicks between 1:00p and 4:05p, so a 1:00p decision needs a
      4:05p-or-later swap on your bench. Inactives about 11:30a ET.
    </P>
    {SLOT('one')}

    <H2>Late Window</H2>
    <P>
      Four games, one at 4:05p and three at 4:25p. Houston at the Chargers is the 4:05p game. Arizona at
      Seattle, Green Bay at New England and Las Vegas at San Francisco kick at 4:25p. Inactives drop about
      2:35p ET for the 4:05p game and about 2:55p ET for the 4:25p games.
    </P>
    {SLOT('late')}

    <H2>Prime Time</H2>
    <P>
      Sunday night is Tampa Bay at Chicago at 8:20p ET. Monday night is Buffalo at Minnesota at 8:15p ET,
      the last window. Practice notes here are from Wednesday, so hold the Monday read loosely. Kyler
      Murray&apos;s hamstring is under evaluation; Carson Wentz is next on Minnesota&apos;s chart.
    </P>
    {SLOT('prime')}

    <H2>Position Tiers</H2>
    <P>
      The rankings for the Thursday through Monday slate. The bands follow my written verdict on each
      player: START, FLEX or SIT. A player I ranked without a ruling is listed under RANKED, NO CALL. The
      note under each name is the reason from his ruling.
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
    <TierBoard pos="DST" rows={DST_ROWS} next={DST_TIER_NEXT} />

    <H2>Handcuff Board</H2>
    <P>
      The starter&apos;s report decides the handcuff, so read this beside the Injury Board. The verdict is
      for Week 9 and nothing else. A handcuff with no ruling gets no call.
    </P>
    <Table aria-label="Week 9 handcuff board">
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
      Each row is a D/ST and the offense it faces. &quot;Opp implied&quot; is the points the opposing offense
      is expected to score. Among these matchups, the two lowest opposing totals are Baltimore (14.75) and
      Arizona (15.5), faced by Jacksonville and Seattle.
    </P>
    <Table aria-label="Week 9 D/ST streaming board">
      <THead>
        <TR>
          <TH scope="col">D/ST</TH><TH scope="col">Opponent</TH><TH scope="col">Opp implied</TH><TH scope="col">Verdict</TH><TH scope="col">Why</TH>
        </TR>
      </THead>
      <TBody>
        {DST_TABLE.map(([team, opp, imp, verdict, why]) => (
          <TR key={team}><TD><strong>{team}</strong></TD><TD>{opp}</TD><TD>{imp}</TD><TD>{verdict}</TD><TD>{why}</TD></TR>
        ))}
      </TBody>
    </Table>

    <H2>IDP Streamers</H2>
    <P>
      Each streamer comes with the numbers behind the call. Check your own wire before you add one.
    </P>
    <Table aria-label="Week 9 IDP streamers">
      <THead>
        <TR>
          <TH scope="col">Player</TH><TH scope="col">Team</TH><TH scope="col">Pos</TH><TH scope="col">Opp</TH><TH scope="col">Note</TH>
        </TR>
      </THead>
      <TBody>
        {IDP_TABLE.map(([name, team, pos, opp, note]) => (
          <TR key={name}><TD><strong>{name}</strong></TD><TD>{team}</TD><TD>{pos}</TD><TD>{opp}</TD><TD>{note}</TD></TR>
        ))}
      </TBody>
    </Table>
    <P>{IDP_AVOID}</P>

    <H2>Sleepers, Fades and Pivots</H2>
    <H3>Sleepers</H3>
    <P>Lower-profile names. Check your own wire before you add one.</P>
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
      One hundred and thirty-four rulings, C1 to C134, and 142 calls inside them. Each one is here with
      its reason.
    </P>
    {RULINGS.map((r) => <RulingCard key={r[0]} r={r} />)}

    <H2>Inactives Checklist</H2>
    <P>
      Inactives drop about 90 minutes before each kickoff. Windows are Eastern time. Thursday is the first
      window, so start there.
    </P>
    <WindowChecklist title="Thursday inactives" time="about 6:45p ET" rows={CHECK_THU} />
    <WindowChecklist title="Madrid inactives" time="about 8:00a ET Sunday" rows={CHECK_MADRID} />
    <WindowChecklist title="1:00p inactives" time="about 11:30a ET" rows={CHECK_ONE} />
    <WindowChecklist title="4:05p and 4:25p inactives" time="about 2:35p and 2:55p ET" rows={CHECK_LATE} />
    <WindowChecklist title="Sunday night inactives" time="about 6:50p ET" rows={CHECK_SNF} />
    <WindowChecklist title="Monday night inactives" time="about 6:45p ET Monday" rows={CHECK_MNF} />

    <Quote>
      Start the names the rulings start, lean on usage, and have your pivots set before Sunday&apos;s
      9:30a Madrid kickoff. The reports still to come may change any of it.
    </Quote>
  </>
);

export default Body;
