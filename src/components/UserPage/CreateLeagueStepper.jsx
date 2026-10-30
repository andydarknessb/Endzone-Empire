import React, {
  useEffect, useId, useRef, useState,
} from 'react';
import PropTypes from 'prop-types';
import {
  Box, Checkbox, Dialog, DialogTitle, FormControl, FormControlLabel, FormLabel,
  IconButton, Radio, RadioGroup, Stack, Typography, useMediaQuery,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { visuallyHidden } from '@mui/utils';
import AddIcon from '@mui/icons-material/Add';
import RemoveIcon from '@mui/icons-material/Remove';
import apiClient from '../../api/apiClient';
import { readHttpFailure } from '../../lib/httpFailure';
import { browserTimeZone, zonedWallTimeToUtcIso } from '../../lib/draftTimezone';
import {
  LEAGUE_TYPE, LEAGUE_TYPE_OPTIONS, MIN_TEAMS, capForType, clampTeamCount, includesFantasy, includesPickem,
  isPickemOnlyType, isValidTeamCount, leagueTypePayload,
} from '../../shared/lib/leagueType';
import { PICKEM_MODE_OPTIONS } from '../../widgets/pickem-settings';
import { joinLink } from '../../features/copy-invite';
import DraftScheduleField from '../common/DraftScheduleField';
import { useSnackbar } from '../Snackbar/SnackbarProvider';
import {
  BODY_FONT, Frame, PixelArrow, PixelCheck, PixelClose, PixelWarn, PsButton, pixelSx,
} from '../../shared/ui/playselect';
import { Dim, KitTextField, Note } from '../DraftSettings/kit';
import { HOME_PANEL_VARS } from './homeTheme';

/**
 * Create league in five steps (Home v2 slice 4): League type, Basics, Rules,
 * Draft, Review, then a done step with the invite code.
 *
 * The request it sends is exactly the one the old one-screen dialog sent:
 * the same keys, through leagueTypePayload, with the draft wall time
 * converted by zonedWallTimeToUtcIso and the same acknowledgement rule (a
 * scheduled draft needs its zone confirmed). "Schedule later" is the
 * one-screen dialog's empty draft date.
 *
 * Enable-and-validate: Continue and Create stay enabled and check the step on
 * submit, putting each error under its field (aria-invalid). The step rail
 * locks every step after the first invalid one, and Create re-checks every
 * step before sending. Answers live in this component, which the page keeps
 * mounted, so closing mid-way keeps them; only closing the done step resets.
 */

const DEFAULT_TEAMS = 12;
const STEP_LABELS = ['League type', 'Basics', 'Rules', 'Draft', 'Review'];
const LAST_STEP = STEP_LABELS.length - 1;

const TYPE_SHORT_LABEL = {
  [LEAGUE_TYPE.FANTASY]: 'Fantasy football',
  [LEAGUE_TYPE.PICKEM]: "NFL pick'em",
  [LEAGUE_TYPE.BOTH]: "Fantasy + pick'em",
};

// What each type comes with, under its helper line on the first step.
const TYPE_INCLUDES = {
  [LEAGUE_TYPE.FANTASY]: 'Draft · lineups · waivers · trades · 2 to 20 teams',
  [LEAGUE_TYPE.PICKEM]: 'Weekly picks · standings · 2 to 50 managers',
  [LEAGUE_TYPE.BOTH]: 'Everything in fantasy · plus weekly picks',
};

const SCORING_OPTIONS = [
  { value: 'standard', label: 'Standard', help: 'No points for receptions.' },
  { value: 'half_ppr', label: 'Half PPR', help: '0.5 per reception. The league default.' },
  { value: 'ppr', label: 'PPR', help: '1 point per reception.' },
];

const VISIBILITY_OPTIONS = [
  { value: 'private', label: 'Private', help: 'Only people with the invite code.' },
  { value: 'public', label: 'Public', help: 'Listed in Discover for anyone to find.' },
];

const DRAFT_MODE_OPTIONS = [
  { value: 'later', label: 'Schedule later', help: 'Set it from League settings once everyone joins.' },
  { value: 'schedule', label: 'Pick a date and time', help: 'Managers get a countdown on their home screen.' },
];

const initialAnswers = () => ({
  leagueType: LEAGUE_TYPE.FANTASY,
  pickemMode: 'straight',
  leagueName: '',
  teamName: '',
  numTeams: DEFAULT_TEAMS,
  isPublic: false,
  joinApproval: false,
  bestBall: false,
  // Half PPR is stored as the half_ppr preset rather than left NULL: the two
  // score identically, but only a stored preset shows the league's scoring
  // chip and matches Discover's scoring filter.
  scoringPreset: 'half_ppr',
  draftMode: 'later',
  draftDate: '',
  draftTimezone: browserTimeZone(),
  draftAcknowledged: false,
});

/**
 * The POST /api/league body, key for key what the one-screen dialog sent.
 * maxTeams is always explicit: the server's default is the fantasy 10 for
 * every type, so a pick'em pool must never rely on it.
 */
function createPayload(answers) {
  const draftWallTime = answers.draftMode === 'schedule' ? answers.draftDate : '';
  const draftDateUtc = draftWallTime ? zonedWallTimeToUtcIso(draftWallTime, answers.draftTimezone) : null;
  const payload = {
    name: answers.leagueName,
    teamName: answers.teamName.trim(),
    maxTeams: Number(answers.numTeams),
    ...leagueTypePayload({
      leagueType: answers.leagueType,
      pickemMode: answers.pickemMode,
      bestBall: answers.bestBall,
      scoringPreset: answers.scoringPreset,
      draftDate: draftDateUtc,
      draftTimezone: answers.draftTimezone,
    }),
  };
  if (answers.isPublic) payload.isPublic = true;
  if (answers.isPublic && answers.joinApproval) payload.joinApproval = true;
  return payload;
}

/** Every step's problems, keyed by field, computed from the answers alone. */
function validate(answers) {
  const cap = capForType(answers.leagueType);
  const basics = {};
  if (!answers.leagueName.trim()) basics.leagueName = 'Enter a league name.';
  if (!answers.teamName.trim()) basics.teamName = 'Enter your team name.';
  if (!isValidTeamCount(answers.numTeams, cap)) basics.numTeams = `Enter a whole number from ${MIN_TEAMS} to ${cap}.`;

  const draft = {};
  if (includesFantasy(answers.leagueType) && answers.draftMode === 'schedule') {
    if (!answers.draftDate) draft.draftDate = 'Choose a draft date and time, or choose Schedule later.';
    else if (!zonedWallTimeToUtcIso(answers.draftDate, answers.draftTimezone)) draft.draftDate = 'Choose the draft time zone.';
    else if (!answers.draftAcknowledged) draft.draftAcknowledged = 'Confirm the draft date and time zone to continue.';
  }
  return [{}, basics, {}, draft, {}];
}

// The footer's one-line summary of what is blocking the current step.
function stepHint(step, problems) {
  if (step === 1) {
    return problems.leagueName || problems.teamName
      ? 'Add a league name and your team name.'
      : problems.numTeams;
  }
  if (step === 3) return 'Confirm the draft time zone, or choose Schedule later.';
  return '';
}

// "YYYY-MM-DDTHH:mm" as written, with no zone math: the wall time the
// commissioner typed, read back to them.
function wallTimeParts(wallTime) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(wallTime || '');
  if (!match) return null;
  const [, y, mo, d, h, mi] = match.map(Number);
  const instant = new Date(Date.UTC(y, mo - 1, d, h, mi));
  const format = (options) => new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', ...options }).format(instant);
  return {
    day: format({ weekday: 'short', month: 'short', day: 'numeric' }),
    monthDay: format({ month: 'short', day: 'numeric' }),
    time: format({ hour: 'numeric', minute: '2-digit' }),
  };
}

// Painted on the Play-select kit (DESIGN.md "Play-select: Home and league pages"). The kit has no dialog,
// radio card or stepper component, so the MUI controls are skinned here (fleet lead call, #2454): the
// 6px double frame, square 44px controls with a 2px edge, Play blue for the selected state with the
// radio dot or check as its mark, and a fill only on the one forward action.
const helpSx = { color: 'var(--ps-dim)', fontSize: '14px', fontFamily: 'inherit' };
const SCRIM_SX = { backgroundColor: 'color-mix(in srgb, var(--ps-field) 85%, transparent)' };
const RULE = '2px solid var(--ps-rule)';

// A choice card: 2px Dim edge when unselected, the Play blue with Play ink when selected. The radio dot
// (or the checkbox tick) is the non-colour mark.
const optionCardSx = (selected) => ({
  m: 0,
  alignItems: 'flex-start',
  p: '8px 12px 8px 4px',
  minHeight: '44px',
  borderRadius: 0,
  border: '2px solid',
  borderColor: selected ? 'var(--ps-play)' : 'var(--ps-dim)',
  backgroundColor: selected ? 'var(--ps-play)' : 'transparent',
  color: selected ? 'var(--ps-play-ink)' : 'var(--ps-ink)',
  '& .MuiRadio-root, & .MuiCheckbox-root': {
    p: '10px', color: 'inherit', '&.Mui-checked': { color: 'inherit' },
  },
  '& .ps-help': { color: selected ? 'var(--ps-play-dim)' : 'var(--ps-dim)' },
  // The native input is invisible, so the kit ring goes on the whole card.
  '&:has(input:focus-visible)': { outline: '3px solid var(--ps-focus)', outlineOffset: 0, boxShadow: '0 0 0 7px var(--ps-halo)' },
});

// A plain checkbox row (no card): Ink glyph, 44px target.
const checkRowSx = { m: 0, minHeight: '44px', color: 'var(--ps-ink)', '&:has(input:focus-visible)': { outline: '3px solid var(--ps-focus)', outlineOffset: 0, boxShadow: '0 0 0 7px var(--ps-halo)' }, '& .MuiCheckbox-root': { p: '10px', color: 'var(--ps-ink)' } };

// The Teams stepper's minus and plus: square, 2px Ink edge.
const stepperButtonSx = {
  minWidth: '44px',
  minHeight: '44px',
  borderRadius: 0,
  color: 'var(--ps-ink)',
  border: '2px solid var(--ps-ink)',
  '&.Mui-disabled': { color: 'var(--ps-dim)', borderColor: 'var(--ps-rule)' },
};

/** A labelled radio group drawn as selectable cards. */
function ChoiceCards({
  legend, hideLegend, name, value, onChange, options, columns = 1,
}) {
  const legendId = useId();
  return (
    <FormControl component="fieldset" sx={{ m: 0, minWidth: 0 }}>
      <FormLabel
        component="legend"
        id={legendId}
        sx={hideLegend ? visuallyHidden : {
          fontWeight: 600, fontSize: '14px', fontFamily: 'inherit', color: 'var(--ps-ink)', mb: '8px', '&.Mui-focused': { color: 'var(--ps-ink)' },
        }}
      >
        {legend}
      </FormLabel>
      <RadioGroup
        name={name}
        aria-labelledby={legendId}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: 'minmax(0, 1fr)', sm: `repeat(${columns}, minmax(0, 1fr))` },
          gap: '10px',
        }}
      >
        {options.map((option) => (
          <FormControlLabel
            key={option.value}
            value={option.value}
            control={<Radio />}
            sx={optionCardSx(value === option.value)}
            label={(
              <Box sx={{ pt: '8px' }}>
                <Typography sx={{ fontSize: '15px', fontWeight: 700, fontFamily: 'inherit' }}>{option.label}</Typography>
                {option.help && (
                  <Typography className="ps-help" sx={{ ...helpSx, color: undefined }}>{option.help}</Typography>
                )}
                {option.includes && (
                  <Typography className="ps-help" sx={{ fontSize: '13px', display: 'block', fontWeight: 600, fontFamily: 'inherit', mt: '4px' }}>
                    {option.includes}
                  </Typography>
                )}
              </Box>
            )}
          />
        ))}
      </RadioGroup>
    </FormControl>
  );
}

ChoiceCards.propTypes = {
  legend: PropTypes.string.isRequired,
  hideLegend: PropTypes.bool,
  name: PropTypes.string.isRequired,
  value: PropTypes.string.isRequired,
  onChange: PropTypes.func.isRequired,
  options: PropTypes.arrayOf(PropTypes.shape({
    value: PropTypes.string.isRequired,
    label: PropTypes.string.isRequired,
    help: PropTypes.string,
    includes: PropTypes.string,
  })).isRequired,
  columns: PropTypes.number,
};

/**
 * A step's heading. It takes focus when it mounts, so every step change and
 * the done step move a screen reader to the new heading. Each step renders
 * its own (keyed) heading, so a re-render on the same step never steals focus
 * back from a field.
 */
function StepHeading({ eyebrow, children }) {
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current) ref.current.focus();
  }, []);
  return (
    <Box>
      {eyebrow && (
        <Box component="p" sx={{ ...helpSx, m: 0, mb: '8px', fontSize: '13px', fontWeight: 600 }}>
          {eyebrow}
        </Box>
      )}
      <Box
        ref={ref}
        component="h3"
        tabIndex={-1}
        sx={{
          m: 0, ...pixelSx(24), fontSize: { xs: '16px', sm: '24px' }, overflowWrap: 'anywhere', '&:focus:not(:focus-visible)': { outline: 'none' },
        }}
      >
        {children}
      </Box>
    </Box>
  );
}

StepHeading.propTypes = {
  eyebrow: PropTypes.string,
  children: PropTypes.node.isRequired,
};

export default function CreateLeagueStepper({ open, onClose, onCreated }) {
  const notify = useSnackbar();
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));

  const [answers, setAnswers] = useState(initialAnswers);
  const [step, setStep] = useState(0);
  // The furthest step the manager has reached; the rail opens nothing past it.
  const [reached, setReached] = useState(0);
  // Steps the manager has tried to leave: only those show their errors.
  const [tried, setTried] = useState({});
  const [pending, setPending] = useState(false);
  const [createError, setCreateError] = useState(null);
  // The created league (the POST response body) once the create succeeds.
  const [created, setCreated] = useState(null);
  // POST /api/league is not idempotent: a ref, not state, so a second submit
  // in the same tick (key repeat) is refused before any re-render.
  const inFlight = useRef(false);

  const nameRef = useRef(null);
  const teamRef = useRef(null);
  const countRef = useRef(null);

  const {
    leagueType, pickemMode, leagueName, teamName, numTeams, isPublic, joinApproval, bestBall,
    scoringPreset, draftMode, draftDate, draftTimezone, draftAcknowledged,
  } = answers;
  const update = (patch) => setAnswers((current) => ({ ...current, ...patch }));

  const cap = capForType(leagueType);
  const hasFantasy = includesFantasy(leagueType);
  const hasPickem = includesPickem(leagueType);
  const pickemOnly = isPickemOnlyType(leagueType);
  const sizeNoun = pickemOnly ? 'managers' : 'teams';
  const problems = validate(answers);
  const valid = problems.map((p) => Object.keys(p).length === 0);
  const firstInvalid = valid.findIndex((ok) => !ok);
  const done = Boolean(created);
  const shown = tried[step] ? problems[step] : {};

  const isLocked = (i) => done || i > reached || (firstInvalid !== -1 && i > firstInvalid);
  const goTo = (i) => {
    if (pending || isLocked(i)) return;
    setStep(i);
    setCreateError(null);
  };

  // Switching type re-caps the team count: a 30-manager pick'em pool cannot
  // become a 30-team fantasy league (and a fractional count rounds down).
  const handleLeagueTypeChange = (nextType) => {
    setAnswers((current) => ({
      ...current,
      leagueType: nextType,
      numTeams: clampTeamCount(current.numTeams, capForType(nextType)),
    }));
  };

  const stepTeams = (delta) => {
    const n = Math.trunc(Number(numTeams));
    const base = numTeams === '' || !Number.isFinite(n) ? DEFAULT_TEAMS : n;
    update({ numTeams: Math.min(cap, Math.max(MIN_TEAMS, base + delta)) });
  };

  const handleClose = () => {
    setCreateError(null);
    onClose();
  };

  // A finished create starts the next one fresh, but only once the dialog has
  // faded out, so the done step never flashes back to step 1 while closing.
  const handleExited = () => {
    if (!created) return;
    setAnswers(initialAnswers());
    setStep(0);
    setReached(0);
    setTried({});
    setCreated(null);
  };

  const create = async () => {
    inFlight.current = true;
    setPending(true);
    setCreateError(null);
    try {
      const response = await apiClient.post('/api/league', createPayload(answers));
      // The snackbar is the one success announcement; the done step's
      // heading takes focus but announces nothing of its own.
      notify('League created!');
      setCreated(response?.data || {});
      if (onCreated) onCreated(response?.data);
    } catch (err) {
      setCreateError(readHttpFailure(err).message || err.message);
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  };

  const handleSubmit = (event) => {
    event.preventDefault();
    if (inFlight.current || done) return;
    if (step === LAST_STEP) {
      // Create re-checks every step and sends the manager to the first one
      // that no longer passes.
      if (firstInvalid !== -1) {
        setTried((current) => ({ ...current, [firstInvalid]: true }));
        setStep(firstInvalid);
        return;
      }
      create();
      return;
    }
    if (!valid[step]) {
      setTried((current) => ({ ...current, [step]: true }));
      if (step === 1) {
        const firstBad = [
          [problems[1].leagueName, nameRef],
          [problems[1].teamName, teamRef],
          [problems[1].numTeams, countRef],
        ].find(([problem]) => problem);
        if (firstBad && firstBad[1].current) firstBad[1].current.focus();
      }
      return;
    }
    setStep(step + 1);
    setReached((current) => Math.max(current, step + 1));
    setCreateError(null);
  };

  // --- Summaries: rail, review and preview all read the same values ---

  const scoringLabel = SCORING_OPTIONS.find((o) => o.value === scoringPreset)?.label || '';
  const when = draftMode === 'schedule' ? wallTimeParts(draftDate) : null;
  const pickemModeLabel = pickemMode === 'confidence' ? 'Confidence' : 'Straight up';
  const countText = `${numTeams === '' ? '?' : numTeams} ${sizeNoun}`;
  let draftSummary = 'No draft';
  if (hasFantasy) {
    if (draftMode === 'later') draftSummary = 'Schedule later';
    else if (valid[3] && when) draftSummary = `${when.day} · ${when.time} · ${draftTimezone}`;
    else draftSummary = 'Not confirmed';
  }
  const railSubs = [
    TYPE_SHORT_LABEL[leagueType],
    valid[1] ? leagueName : 'Name, team, size',
    hasFantasy ? `${scoringLabel}${bestBall ? ' · best ball' : ''}` : pickemModeLabel,
    draftSummary,
    'Check and create',
  ];
  const rulesSummary = [
    hasFantasy ? scoringLabel : null,
    hasFantasy && bestBall ? 'Best ball' : null,
    hasPickem ? `${pickemMode === 'confidence' ? 'Confidence' : 'Straight-up'} pick'em` : null,
    isPublic ? (joinApproval ? 'Public, approval required' : 'Public') : 'Private',
  ].filter(Boolean).join(' · ');
  const reviewRows = [
    { key: 'Type', value: TYPE_SHORT_LABEL[leagueType], step: 0, ok: true },
    {
      key: 'League',
      value: `${leagueName.trim() ? leagueName : 'Missing league name'} · ${countText}`,
      step: 1,
      ok: !problems[1].leagueName && !problems[1].numTeams,
    },
    { key: 'Your team', value: teamName.trim() ? teamName : 'Missing team name', step: 1, ok: !problems[1].teamName },
    { key: 'Rules', value: rulesSummary, step: 2, ok: true },
    { key: 'Draft', value: draftSummary, step: 3, ok: valid[3] },
  ];
  const chips = [
    TYPE_SHORT_LABEL[leagueType],
    countText,
    ...(hasFantasy ? [scoringLabel] : []),
    ...(hasFantasy && bestBall ? ['Best ball'] : []),
    isPublic ? 'Public' : 'Private',
    ...(hasFantasy ? [when ? `Draft ${when.monthDay}` : 'Draft TBD'] : []),
  ];

  let hint = '';
  if (step === LAST_STEP && firstInvalid !== -1) hint = `Fix ${STEP_LABELS[firstInvalid]} before creating.`;
  else if (tried[step] && !valid[step]) hint = stepHint(step, problems[step]);

  const copy = async (text, confirmation) => {
    try {
      await navigator.clipboard.writeText(text);
      notify(confirmation);
    } catch {
      notify("Couldn't copy. Select the code and copy it instead.", { severity: 'error' });
    }
  };

  const eyebrow = `Step ${step + 1} of ${STEP_LABELS.length}`;
  const inviteCode = created?.invite_code;
  const createdId = created?.id;

  // A field error in the kit's error type: Danger bold on the panel (a registered pairing).
  const errorText = (message) => (message ? <Box component="span" sx={{ color: 'var(--ps-danger)', fontWeight: 700 }}>{message}</Box> : undefined);

  const stepBody = () => {
    if (step === 0) {
      return (
        <>
          <Box key="h0">
            <StepHeading eyebrow={eyebrow}>What kind of league?</StepHeading>
            <Dim sx={{ mt: '12px', fontSize: '15px' }}>
              You can turn pick&apos;em on later in a fantasy league. A pick&apos;em league can&apos;t add a draft.
            </Dim>
          </Box>
          <ChoiceCards
            legend="League type"
            hideLegend
            name="create-league-type"
            value={leagueType}
            onChange={handleLeagueTypeChange}
            options={LEAGUE_TYPE_OPTIONS.map((o) => ({
              value: o.value, label: o.label, help: o.helper, includes: TYPE_INCLUDES[o.value],
            }))}
          />
        </>
      );
    }
    if (step === 1) {
      const presets = pickemOnly ? [10, 20, 30, 50] : [8, 10, 12, 14];
      const count = Number(numTeams);
      return (
        <>
          <StepHeading key="h1" eyebrow={eyebrow}>Name it and size it</StepHeading>
          <KitTextField
            id="create-league-name"
            inputRef={nameRef}
            label={<>League name<span aria-hidden="true"> *</span></>}
            required
            fullWidth
            value={leagueName}
            error={Boolean(shown.leagueName)}
            helperText={errorText(shown.leagueName)}
            onChange={(event) => update({ leagueName: event.target.value })}
          />
          <KitTextField
            id="create-league-team-name"
            inputRef={teamRef}
            label={<>Team name<span aria-hidden="true"> *</span></>}
            required
            fullWidth
            inputProps={{ maxLength: 120 }}
            error={Boolean(shown.teamName)}
            helperText={errorText(shown.teamName)
              || "Your team's identity in this league. Other managers never see your account email or username."}
            onChange={(event) => update({ teamName: event.target.value })}
            value={teamName}
          />
          <Box>
            <Stack direction="row" alignItems="flex-end" sx={{ flexWrap: 'wrap', gap: '8px' }}>
              <IconButton
                aria-label={pickemOnly ? 'Fewer managers' : 'Fewer teams'}
                onClick={() => stepTeams(-1)}
                disabled={Number.isFinite(count) && numTeams !== '' && count <= MIN_TEAMS}
                sx={stepperButtonSx}
              >
                <RemoveIcon />
              </IconButton>
              <KitTextField
                id="create-league-size"
                inputRef={countRef}
                label={pickemOnly ? 'Managers' : 'Teams'}
                type="number"
                inputProps={{
                  min: MIN_TEAMS, max: cap, step: 1, 'aria-describedby': 'create-league-size-helper-text',
                }}
                sx={{ width: 120 }}
                value={numTeams}
                error={Boolean(shown.numTeams)}
                onChange={(event) => update({ numTeams: event.target.value })}
              />
              <IconButton
                aria-label={pickemOnly ? 'More managers' : 'More teams'}
                onClick={() => stepTeams(1)}
                disabled={Number.isFinite(count) && count >= cap}
                sx={stepperButtonSx}
              >
                <AddIcon />
              </IconButton>
              <Stack
                direction="row"
                role="group"
                aria-label={`Common league sizes, in ${sizeNoun}`}
                sx={{ flexWrap: 'wrap', gap: '8px', pl: { sm: '8px' } }}
              >
                {presets.map((n) => (
                  <PsButton
                    key={n}
                    variant={count === n ? 'selected' : 'ghost'}
                    aria-pressed={count === n ? 'true' : 'false'}
                    onClick={() => update({ numTeams: n })}
                  >
                    {n}
                  </PsButton>
                ))}
              </Stack>
            </Stack>
            {/* The count's helper sits under the whole row, tied to the
                number field so its error is read with it. */}
            <Dim
              id="create-league-size-helper-text"
              sx={{ mt: '8px', fontWeight: shown.numTeams ? 700 : 400, ...(shown.numTeams ? { color: 'var(--ps-danger)' } : {}) }}
            >
              {shown.numTeams || (pickemOnly
                ? `${MIN_TEAMS} to ${cap} managers. Pick'em pools have no schedule to balance.`
                : `${MIN_TEAMS} to ${cap} teams. Even numbers make a cleaner head-to-head schedule.`)}
            </Dim>
          </Box>
        </>
      );
    }
    if (step === 2) {
      return (
        <>
          <Box key="h2">
            <StepHeading eyebrow={eyebrow}>House rules</StepHeading>
            <Dim sx={{ mt: '12px', fontSize: '15px' }}>
              All of these can change later in League settings, until the season locks them.
            </Dim>
          </Box>
          {hasFantasy && (
            <>
              <ChoiceCards
                legend="Scoring"
                name="create-league-scoring"
                value={scoringPreset}
                onChange={(value) => update({ scoringPreset: value })}
                options={SCORING_OPTIONS}
                columns={3}
              />
              <FormControlLabel
                sx={optionCardSx(bestBall)}
                control={<Checkbox checked={bestBall} onChange={(event) => update({ bestBall: event.target.checked })} />}
                label={(
                  <Box sx={{ pt: '8px' }}>
                    <Typography sx={{ fontSize: '15px', fontWeight: 700, fontFamily: 'inherit' }}>Best ball</Typography>
                    <Typography className="ps-help" sx={{ ...helpSx, color: undefined }}>
                      An optimal lineup is set automatically each week, with no manual lineup edits.
                    </Typography>
                  </Box>
                )}
              />
            </>
          )}
          {hasPickem && (
            <Box>
              <ChoiceCards
                legend="Pick'em scoring"
                name="create-league-pickem-mode"
                value={pickemMode}
                onChange={(value) => update({ pickemMode: value })}
                options={PICKEM_MODE_OPTIONS.map(({ value, label }) => ({ value, label }))}
                columns={2}
              />
              <Dim sx={{ mt: '8px' }}>
                The mode can only change before the season&apos;s first pick.
              </Dim>
            </Box>
          )}
          <Box>
            <ChoiceCards
              legend="Who can join"
              name="create-league-visibility"
              value={isPublic ? 'public' : 'private'}
              onChange={(value) => update({ isPublic: value === 'public' })}
              options={VISIBILITY_OPTIONS}
              columns={2}
            />
            {isPublic && (
              <FormControlLabel
                sx={{ ...checkRowSx, mt: '8px' }}
                control={(
                  <Checkbox
                    checked={joinApproval}
                    onChange={(event) => update({ joinApproval: event.target.checked })}
                  />
                )}
                label="Require commissioner approval before someone joins"
              />
            )}
          </Box>
        </>
      );
    }
    if (step === 3) {
      return (
        <>
          <StepHeading key="h3" eyebrow={eyebrow}>Draft day</StepHeading>
          {hasFantasy ? (
            <>
              <ChoiceCards
                legend="When is the draft"
                hideLegend
                name="create-league-draft-mode"
                value={draftMode}
                onChange={(value) => update({ draftMode: value })}
                options={DRAFT_MODE_OPTIONS}
                columns={2}
              />
              {draftMode === 'schedule' && (
                <DraftScheduleField
                  look="playselect"
                  wallTime={draftDate}
                  onWallTimeChange={(value) => update({ draftDate: value })}
                  timeZone={draftTimezone}
                  onTimeZoneChange={(value) => update({ draftTimezone: value })}
                  acknowledged={draftAcknowledged}
                  onAcknowledgedChange={(value) => update({ draftAcknowledged: value })}
                  error={shown.draftDate}
                  acknowledgeError={shown.draftAcknowledged}
                />
              )}
            </>
          ) : (
            <Box sx={{ p: '16px 20px', border: RULE }}>
              <Box component="p" sx={{ m: 0, fontWeight: 700 }}>Pick&apos;em leagues don&apos;t draft.</Box>
              <Dim>Managers start picking as soon as they join. Continue to review.</Dim>
            </Box>
          )}
        </>
      );
    }
    return (
      <>
        <StepHeading key="h4" eyebrow={eyebrow}>Look good?</StepHeading>
        {createError && (
          <Note warn>
            <Box component="p" sx={{ m: 0, fontWeight: 700 }}>We couldn&apos;t create the league.</Box>
            {createError}
            {' '}
            Your answers are still here, so try again in a moment.
          </Note>
        )}
        <Box component="dl" sx={{ m: 0, border: RULE }}>
          {reviewRows.map((row) => (
            <Box
              key={row.key}
              sx={{
                display: 'grid',
                gridTemplateColumns: { xs: 'minmax(0, 1fr) auto', sm: '140px minmax(0, 1fr) auto' },
                alignItems: 'center',
                columnGap: '16px',
                py: '4px',
                pl: '16px',
                pr: '8px',
                borderBottom: RULE,
                '&:last-of-type': { borderBottom: 0 },
              }}
            >
              <Box component="dt" sx={{ ...helpSx, fontWeight: 600 }}>
                {row.key}
              </Box>
              <Box
                component="dd"
                sx={{
                  m: 0,
                  fontWeight: 600,
                  gridColumn: { xs: '1', sm: 'auto' },
                  gridRow: { xs: '2', sm: 'auto' },
                  color: row.ok ? 'var(--ps-ink)' : 'var(--ps-danger)',
                }}
              >
                {row.value}
              </Box>
              <Box sx={{ gridRow: { xs: '1 / span 2', sm: 'auto' }, gridColumn: { xs: '2', sm: 'auto' } }}>
                <PsButton variant="quiet" ariaLabel={`Edit ${row.key.toLowerCase()}`} onClick={() => goTo(row.step)}>
                  Edit
                </PsButton>
              </Box>
            </Box>
          ))}
        </Box>
      </>
    );
  };

  let submitLabel = 'Continue';
  if (pending) submitLabel = 'Creating league…';
  else if (step === LAST_STEP) submitLabel = 'Create league';

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      fullWidth
      maxWidth="lg"
      fullScreen={fullScreen}
      TransitionProps={{ onExited: handleExited }}
      BackdropProps={{ sx: SCRIM_SX }}
      PaperProps={{
        className: 'ps-root',
        sx: {
          ...HOME_PANEL_VARS,
          border: '6px double var(--ps-frame)',
          borderRadius: 0,
          backgroundColor: 'var(--ps-panel)',
          backgroundImage: 'none',
          boxShadow: 'none',
          color: 'var(--ps-ink)',
          fontFamily: BODY_FONT,
          ...(fullScreen ? { m: 0 } : null),
        },
      }}
    >
      <Box
        sx={{
          position: 'relative',
          display: 'grid',
          gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: '240px minmax(0, 1fr) 280px' },
          minHeight: { md: 640 },
        }}
      >
        <Box
          component="button"
          type="button"
          aria-label={done ? 'Close' : 'Close. Your answers are kept.'}
          onClick={handleClose}
          sx={{
            position: 'absolute',
            top: 8,
            right: 8,
            zIndex: 1,
            display: 'grid',
            placeItems: 'center',
            width: '44px',
            height: '44px',
            p: 0,
            border: '2px solid var(--ps-ink)',
            borderRadius: 0,
            background: 'var(--ps-panel)',
            color: 'var(--ps-ink)',
          }}
        >
          <PixelClose size={16} />
        </Box>

        <Box
          component="nav"
          aria-label="Create league steps"
          sx={{
            backgroundColor: 'var(--ps-field)',
            borderRight: { md: RULE },
            borderBottom: { xs: RULE, md: 0 },
            p: { xs: '14px', md: '20px 16px' },
            pr: { xs: '64px', md: '16px' },
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
          }}
        >
          <DialogTitle sx={{ p: 0, mb: { md: '8px' }, ...pixelSx(16) }}>
            Create a league
          </DialogTitle>
          <Box
            component="ol"
            sx={{
              listStyle: 'none',
              m: 0,
              display: 'flex',
              flexDirection: { xs: 'row', md: 'column' },
              gap: '6px',
              overflowX: { xs: 'auto', md: 'visible' },
              // The scroll box clips the 7px focus halo, so keep room around the buttons.
              p: { xs: '8px', md: 0 },
            }}
          >
            {STEP_LABELS.map((label, i) => {
              const current = i === step && !done;
              const locked = isLocked(i);
              const past = !current && valid[i] && (done || i < reached);
              const needsFix = !current && i <= reached && !valid[i];
              let srState = '';
              if (current) srState = ', current step';
              else if (past) srState = ', completed';
              else if (needsFix) srState = ', needs attention';
              else if (locked) srState = ', not available yet';
              let sub = railSubs[i];
              if (i > reached) sub = 'Not started';
              else if (needsFix) sub = 'Needs attention';
              let mark = i + 1;
              if (past) mark = <PixelCheck size={14} />;
              else if (needsFix) mark = <PixelWarn color="var(--ps-danger)" />;
              return (
                <Box component="li" key={label} sx={{ flexShrink: 0 }}>
                  <Box
                    component="button"
                    type="button"
                    aria-current={current ? 'step' : undefined}
                    aria-disabled={locked ? 'true' : 'false'}
                    onClick={() => goTo(i)}
                    // The current step is the Play blue with an arrow as its non-colour mark.
                    sx={{
                      width: '100%',
                      minHeight: '56px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'flex-start',
                      textAlign: 'left',
                      gap: '12px',
                      p: '6px 10px',
                      borderRadius: 0,
                      border: '2px solid',
                      borderColor: current ? 'var(--ps-play)' : 'transparent',
                      color: current ? 'var(--ps-play-ink)' : 'var(--ps-ink)',
                      backgroundColor: current ? 'var(--ps-play)' : 'transparent',
                      cursor: locked ? 'not-allowed' : 'pointer',
                      fontFamily: 'inherit',
                    }}
                  >
                    <Box
                      component="span"
                      aria-hidden="true"
                      sx={{
                        width: '28px',
                        height: '28px',
                        flexShrink: 0,
                        boxSizing: 'border-box',
                        border: '2px solid currentColor',
                        display: 'grid',
                        placeItems: 'center',
                        fontSize: '14px',
                        fontWeight: 700,
                      }}
                    >
                      {mark}
                    </Box>
                    <Box component="span" sx={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                      <Box component="span" sx={{ fontSize: '15px', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                        {label}
                        {current && <PixelArrow />}
                        <Box component="span" sx={visuallyHidden}>{srState}</Box>
                      </Box>
                      <Box
                        component="span"
                        sx={{
                          display: { xs: 'none', md: 'block' },
                          fontSize: '13px',
                          color: current ? 'var(--ps-play-dim)' : 'var(--ps-dim)',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                      >
                        {sub}
                      </Box>
                    </Box>
                  </Box>
                </Box>
              );
            })}
          </Box>
          <Dim sx={{ mt: 'auto', fontSize: '13px', display: { xs: 'none', md: 'block' } }}>
            Your answers are kept if you close this and come back.
          </Dim>
        </Box>

        <Box
          component="form"
          noValidate
          onSubmit={handleSubmit}
          sx={{ display: 'flex', flexDirection: 'column', minWidth: 0, m: 0 }}
        >
          {done ? (
            <Stack
              spacing={2}
              alignItems="center"
              justifyContent="center"
              sx={{ flexGrow: 1, textAlign: 'center', px: { xs: '14px', sm: '40px' }, py: '40px' }}
            >
              <Box
                aria-hidden="true"
                sx={{
                  width: '72px',
                  height: '72px',
                  display: 'grid',
                  placeItems: 'center',
                  color: 'var(--ps-ink)',
                  border: '2px solid var(--ps-ink)',
                }}
              >
                <PixelCheck size={36} />
              </Box>
              <StepHeading key="done">{`${leagueName.trim() || 'Your league'} is ready`}</StepHeading>
              {inviteCode && (
                <>
                  <Dim sx={{ maxWidth: 420, fontSize: '15px' }}>
                    Share the invite code so managers can join. You&apos;ll see each one land in Activity.
                  </Dim>
                  <Stack
                    direction={{ xs: 'column', sm: 'row' }}
                    spacing={1.5}
                    alignItems="center"
                    sx={{ p: '10px 12px', border: RULE }}
                  >
                    <Box
                      component="code"
                      sx={{ fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace', fontSize: '22px', fontWeight: 700, letterSpacing: '0.08em', color: 'var(--ps-ink)' }}
                    >
                      {inviteCode}
                    </Box>
                    <PsButton ariaLabel={`Copy invite code ${inviteCode}`} onClick={() => copy(inviteCode, 'Invite code copied')}>
                      Copy
                    </PsButton>
                    <PsButton onClick={() => copy(joinLink(inviteCode), 'Invite link copied')}>
                      Copy invite link
                    </PsButton>
                  </Stack>
                </>
              )}
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ pt: 1 }}>
                {createdId != null && (
                  <PsButton variant="fill" to={`/league/${createdId}`} onClick={handleClose}>
                    Go to league
                  </PsButton>
                )}
                <PsButton onClick={handleClose}>Done</PsButton>
              </Stack>
            </Stack>
          ) : (
            <>
              <Stack spacing={3} sx={{ flexGrow: 1, px: { xs: '14px', sm: '40px' }, pt: { xs: '24px', sm: '36px' }, pb: '24px' }}>
                {stepBody()}
              </Stack>
              <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '12px', p: { xs: '12px 14px', sm: '16px 40px' }, borderTop: RULE }}>
                <Box role="status" sx={{ mr: 'auto', fontSize: '14px', fontWeight: 700, color: 'var(--ps-danger)' }}>
                  {hint}
                </Box>
                {step === 0 ? (
                  <PsButton onClick={handleClose}>Cancel</PsButton>
                ) : (
                  <PsButton onClick={() => goTo(step - 1)}>Back</PsButton>
                )}
                <PsButton type="submit" variant="fill" aria-disabled={pending ? 'true' : undefined}>
                  {submitLabel}
                </PsButton>
              </Box>
            </>
          )}
        </Box>

        <Box
          component="aside"
          aria-label="League preview"
          sx={{
            backgroundColor: 'var(--ps-field)',
            borderLeft: { md: RULE },
            borderTop: { xs: RULE, md: 0 },
            p: { xs: '14px', md: '20px' },
            pt: { md: '72px' },
            display: 'flex',
            flexDirection: 'column',
            gap: '16px',
          }}
        >
          <Box component="p" sx={{ ...helpSx, m: 0, fontWeight: 700 }}>
            Preview
          </Box>
          <Frame tier="rule" component="div">
            <Stack direction="row" spacing={1.5} alignItems="center" sx={{ p: '14px', borderBottom: RULE }}>
              <Box
                aria-hidden="true"
                sx={{
                  width: '40px',
                  height: '40px',
                  flexShrink: 0,
                  border: '2px solid var(--ps-ink)',
                  display: 'grid',
                  placeItems: 'center',
                  ...pixelSx(16),
                }}
              >
                {(leagueName.trim()[0] || '?').toUpperCase()}
              </Box>
              <Box sx={{ minWidth: 0 }}>
                <Typography noWrap sx={{ fontWeight: 700, fontFamily: 'inherit' }} title={leagueName || undefined}>
                  {leagueName || 'Untitled league'}
                </Typography>
                <Typography noWrap component="p" sx={helpSx}>
                  {`${teamName || 'Your team'} · Commissioner`}
                </Typography>
              </Box>
            </Stack>
            <Box component="ul" sx={{ listStyle: 'none', m: 0, p: '14px', display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
              {chips.map((chip) => (
                <Box
                  component="li"
                  key={chip}
                  sx={{
                    px: '10px',
                    py: '2px',
                    border: '2px solid var(--ps-dim)',
                    fontSize: '13px',
                    fontWeight: 600,
                    color: 'var(--ps-ink)',
                  }}
                >
                  {chip}
                </Box>
              ))}
            </Box>
          </Frame>
          <Dim>
            This is how the league appears on your home screen. You&apos;ll be its commissioner.
          </Dim>
        </Box>
      </Box>
    </Dialog>
  );
}

CreateLeagueStepper.propTypes = {
  open: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  onCreated: PropTypes.func,
};
