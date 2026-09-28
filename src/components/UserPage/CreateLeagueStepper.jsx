import React, {
  useEffect, useId, useRef, useState,
} from 'react';
import PropTypes from 'prop-types';
import { Link as RouterLink } from 'react-router-dom';
import {
  Alert, AlertTitle, Box, Button, Checkbox, Dialog, DialogTitle, FormControl, FormControlLabel, FormLabel,
  IconButton, Radio, RadioGroup, Stack, TextField, Typography, useMediaQuery,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { visuallyHidden } from '@mui/utils';
import AddIcon from '@mui/icons-material/Add';
import CheckIcon from '@mui/icons-material/Check';
import CloseIcon from '@mui/icons-material/Close';
import RemoveIcon from '@mui/icons-material/Remove';
import apiClient from '../../api/apiClient';
import { readHttpFailure } from '../../lib/httpFailure';
import { browserTimeZone, zonedWallTimeToUtcIso } from '../../lib/draftTimezone';
import { MIN_TOUCH_TARGET_SX } from '../../shared/lib/a11y';
import {
  LEAGUE_TYPE, LEAGUE_TYPE_OPTIONS, MIN_TEAMS, capForType, clampTeamCount, includesFantasy, includesPickem,
  isPickemOnlyType, isValidTeamCount, leagueTypePayload,
} from '../../shared/lib/leagueType';
import { PICKEM_MODE_OPTIONS } from '../../widgets/pickem-settings';
import { joinLink } from '../../features/copy-invite';
import DraftScheduleField from '../common/DraftScheduleField';
import { useSnackbar } from '../Snackbar/SnackbarProvider';
import {
  DISPLAY_FONT, HAIRLINE, alertSx, choiceControlSx, dialogPaperSx, dimSx, fieldSx, ghostButtonSx,
  primaryButtonSx, quietButtonSx,
} from '../common/homeIslandSx';

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

// Painted on the island (ADR 0051). The dialog is a card (`dash-surface`);
// the rail and the preview are stat tiles (`dash-surface2`). Inputs keep the
// card's own fill with the `dash-field` edge. The board fills them
// `dash-surface2`, but MUI floats the label across the input's top edge, and
// in error that label is danger text half on the fill: danger on
// `dash-surface2` is not a registered pairing, danger on `dash-surface` is.
const inputSx = fieldSx('var(--dash-surface)');
const helpSx = { ...dimSx, fontSize: '13px' };

// A choice card: 2px `dash-field` edge when unselected (the 3:1 boundary of
// a control), the accent edge on the accent tint when selected. Ink and dim
// on the accent tint over a card are registered.
const optionCardSx = (selected) => ({
  m: 0,
  alignItems: 'flex-start',
  p: 1.5,
  borderRadius: 'var(--dash-radius-sm)',
  border: '2px solid',
  borderColor: selected ? 'var(--dash-accent)' : 'var(--dash-field)',
  backgroundColor: selected ? 'var(--dash-accent-soft)' : 'transparent',
  color: 'var(--dash-ink)',
  '& .MuiRadio-root, & .MuiCheckbox-root': { ...choiceControlSx, mt: -0.75 },
});

// The shared DraftScheduleField paints app tokens (League settings uses it
// too), so the stepper repaints it from outside: island fields, a dim UTC
// line, an ink acknowledgement and its danger error line, all on the card.
// The board sets the acknowledgement on the warning tint; that is left out
// here, because the checkbox glyph and its focus ring would then sit on the
// tint (neither is a registered pairing) and the error line, which the shared
// field renders outside the label, could not join it.
const draftScheduleSx = {
  ...inputSx,
  '& .MuiTypography-caption': helpSx,
  '& .MuiCheckbox-root': choiceControlSx,
  '& .MuiFormControlLabel-label': { color: 'var(--dash-ink)', fontSize: '14px' },
};

// A size preset: pressed is the accent edge on the accent tint, resting the
// `dash-field` edge; ink label either way.
const presetSx = (pressed) => ({
  ...MIN_TOUCH_TARGET_SX,
  px: 1.5,
  textTransform: 'none',
  fontSize: '14px',
  fontWeight: 600,
  boxShadow: 'none',
  borderRadius: 'var(--dash-radius-sm)',
  color: 'var(--dash-ink)',
  border: `1px solid ${pressed ? 'var(--dash-accent)' : 'var(--dash-field)'}`,
  backgroundColor: pressed ? 'var(--dash-accent-soft)' : 'transparent',
  '&:hover': {
    boxShadow: 'none',
    borderColor: 'var(--dash-accent)',
    backgroundColor: pressed ? 'var(--dash-accent-soft)' : 'transparent',
  },
});

// The Teams stepper's minus and plus: `dash-field` edged, ink glyph.
const stepperButtonSx = {
  ...MIN_TOUCH_TARGET_SX,
  mt: 0.5,
  color: 'var(--dash-ink)',
  border: '1px solid var(--dash-field)',
  borderRadius: 'var(--dash-radius-sm)',
  backgroundColor: 'transparent',
  '&:hover': { backgroundColor: 'var(--dash-surface2)', borderColor: 'var(--dash-accent)' },
  '&.Mui-disabled': { color: 'var(--dash-dim)', borderColor: 'var(--dash-field)' },
};

const bigButtonSx = { ...MIN_TOUCH_TARGET_SX, minHeight: 48, px: 2.5, fontSize: '15px' };

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
          fontWeight: 600, fontSize: '14px', color: 'var(--dash-ink)', mb: 1, '&.Mui-focused': { color: 'var(--dash-ink)' },
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
          gap: 1.25,
        }}
      >
        {options.map((option) => (
          <FormControlLabel
            key={option.value}
            value={option.value}
            control={<Radio />}
            sx={optionCardSx(value === option.value)}
            label={(
              <Box>
                <Typography sx={{ fontSize: '15px', fontWeight: 600 }}>{option.label}</Typography>
                {option.help && (
                  <Typography variant="body2" sx={helpSx}>{option.help}</Typography>
                )}
                {option.includes && (
                  <Typography variant="caption" sx={{ ...dimSx, fontSize: '12px', display: 'block', fontWeight: 600, letterSpacing: '0.04em', mt: 0.5 }}>
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
        <Typography
          variant="overline"
          component="p"
          sx={{ ...dimSx, fontSize: '12px', fontWeight: 700, letterSpacing: '0.08em', lineHeight: 1.6 }}
        >
          {eyebrow}
        </Typography>
      )}
      <Typography
        ref={ref}
        tabIndex={-1}
        variant="h5"
        component="h3"
        sx={{
          fontFamily: DISPLAY_FONT,
          fontSize: { xs: '28px', sm: '34px' },
          fontWeight: 700,
          lineHeight: 1.05,
          textTransform: 'uppercase',
          '&:focus:not(:focus-visible)': { outline: 'none' },
        }}
      >
        {children}
      </Typography>
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

  const stepBody = () => {
    if (step === 0) {
      return (
        <>
          <Box key="h0">
            <StepHeading eyebrow={eyebrow}>What kind of league?</StepHeading>
            <Typography sx={{ ...dimSx, mt: 0.5 }}>
              You can turn pick&apos;em on later in a fantasy league. A pick&apos;em league can&apos;t add a draft.
            </Typography>
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
          <TextField
            id="create-league-name"
            inputRef={nameRef}
            label="League name"
            required
            fullWidth
            sx={inputSx}
            value={leagueName}
            error={Boolean(shown.leagueName)}
            helperText={shown.leagueName}
            onChange={(event) => update({ leagueName: event.target.value })}
          />
          <TextField
            id="create-league-team-name"
            inputRef={teamRef}
            label="Team name"
            required
            fullWidth
            inputProps={{ maxLength: 120 }}
            sx={inputSx}
            value={teamName}
            error={Boolean(shown.teamName)}
            helperText={shown.teamName
              || "Your team's identity in this league. Other managers never see your account email or username."}
            onChange={(event) => update({ teamName: event.target.value })}
          />
          <Box>
            <Stack direction="row" spacing={1} alignItems="flex-start" sx={{ flexWrap: 'wrap', rowGap: 1 }}>
              <IconButton
                aria-label={pickemOnly ? 'Fewer managers' : 'Fewer teams'}
                onClick={() => stepTeams(-1)}
                disabled={Number.isFinite(count) && numTeams !== '' && count <= MIN_TEAMS}
                sx={stepperButtonSx}
              >
                <RemoveIcon />
              </IconButton>
              <TextField
                id="create-league-size"
                inputRef={countRef}
                label={pickemOnly ? 'Managers' : 'Teams'}
                type="number"
                inputProps={{
                  min: MIN_TEAMS, max: cap, step: 1, 'aria-describedby': 'create-league-size-helper-text',
                }}
                sx={{
                  ...inputSx,
                  width: 120,
                  '& .MuiInputBase-input': { fontFamily: DISPLAY_FONT, fontSize: '22px', fontWeight: 700, fontVariantNumeric: 'tabular-nums' },
                }}
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
                spacing={1}
                role="group"
                aria-label={`Common league sizes, in ${sizeNoun}`}
                sx={{ pl: { sm: 1 }, pt: 0.5 }}
              >
                {presets.map((n) => (
                  <Button
                    key={n}
                    type="button"
                    variant={count === n ? 'contained' : 'outlined'}
                    aria-pressed={count === n ? 'true' : 'false'}
                    onClick={() => update({ numTeams: n })}
                    sx={presetSx(count === n)}
                  >
                    {n}
                  </Button>
                ))}
              </Stack>
            </Stack>
            {/* The count's helper sits under the whole row, tied to the
                number field so its error is read with it. */}
            <Typography
              id="create-league-size-helper-text"
              variant="body2"
              sx={{ ...helpSx, mt: 1, fontWeight: shown.numTeams ? 600 : 400, ...(shown.numTeams ? { color: 'var(--dash-danger)' } : {}) }}
            >
              {shown.numTeams || (pickemOnly
                ? `${MIN_TEAMS} to ${cap} managers. Pick'em pools have no schedule to balance.`
                : `${MIN_TEAMS} to ${cap} teams. Even numbers make a cleaner head-to-head schedule.`)}
            </Typography>
          </Box>
        </>
      );
    }
    if (step === 2) {
      return (
        <>
          <Box key="h2">
            <StepHeading eyebrow={eyebrow}>House rules</StepHeading>
            <Typography sx={{ ...dimSx, mt: 0.5 }}>
              All of these can change later in League settings, until the season locks them.
            </Typography>
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
                  <Box>
                    <Typography sx={{ fontSize: '15px', fontWeight: 600 }}>Best ball</Typography>
                    <Typography variant="body2" sx={helpSx}>
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
              <Typography variant="caption" sx={{ ...dimSx, fontSize: '12px', display: 'block', mt: 0.5 }}>
                The mode can only change before the season&apos;s first pick.
              </Typography>
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
                sx={{ mt: 1, minHeight: 44, color: 'var(--dash-ink)' }}
                control={(
                  <Checkbox
                    sx={choiceControlSx}
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
                <Box sx={draftScheduleSx}>
                  <DraftScheduleField
                    wallTime={draftDate}
                    onWallTimeChange={(value) => update({ draftDate: value })}
                    timeZone={draftTimezone}
                    onTimeZoneChange={(value) => update({ draftTimezone: value })}
                    acknowledged={draftAcknowledged}
                    onAcknowledgedChange={(value) => update({ draftAcknowledged: value })}
                    error={shown.draftDate}
                    acknowledgeError={shown.draftAcknowledged}
                  />
                </Box>
              )}
            </>
          ) : (
            <Box sx={{ p: 3, borderRadius: 'var(--dash-radius-sm)', backgroundColor: 'var(--dash-surface2)', border: HAIRLINE }}>
              <Typography sx={{ fontWeight: 600 }}>Pick&apos;em leagues don&apos;t draft.</Typography>
              <Typography variant="body2" sx={helpSx}>
                Managers start picking as soon as they join. Continue to review.
              </Typography>
            </Box>
          )}
        </>
      );
    }
    return (
      <>
        <StepHeading key="h4" eyebrow={eyebrow}>Look good?</StepHeading>
        {createError && (
          <Alert severity="error" sx={alertSx('danger', { titleTone: true })}>
            <AlertTitle>We couldn&apos;t create the league.</AlertTitle>
            {createError}
            {' '}
            Your answers are still here, so try again in a moment.
          </Alert>
        )}
        <Box component="dl" sx={{ m: 0, border: HAIRLINE, borderRadius: 'var(--dash-radius-sm)', overflow: 'hidden' }}>
          {reviewRows.map((row) => (
            <Box
              key={row.key}
              sx={{
                display: 'grid',
                gridTemplateColumns: { xs: 'minmax(0, 1fr) auto', sm: '140px minmax(0, 1fr) auto' },
                alignItems: 'center',
                columnGap: 2,
                py: 0.5,
                pl: 2,
                pr: 1,
                borderBottom: HAIRLINE,
                '&:last-of-type': { borderBottom: 0 },
              }}
            >
              <Typography component="dt" variant="body2" sx={{ ...dimSx, fontWeight: 600 }}>
                {row.key}
              </Typography>
              <Typography
                component="dd"
                sx={{
                  m: 0,
                  fontWeight: 500,
                  gridColumn: { xs: '1', sm: 'auto' },
                  gridRow: { xs: '2', sm: 'auto' },
                  color: row.ok ? 'var(--dash-ink)' : 'var(--dash-danger)',
                }}
              >
                {row.value}
              </Typography>
              <Button
                type="button"
                aria-label={`Edit ${row.key.toLowerCase()}`}
                onClick={() => goTo(row.step)}
                sx={{ ...quietButtonSx, ...MIN_TOUCH_TARGET_SX, gridRow: { xs: '1 / span 2', sm: 'auto' }, gridColumn: { xs: '2', sm: 'auto' } }}
              >
                Edit
              </Button>
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
      PaperProps={{ sx: dialogPaperSx('var(--dash-surface)', { fullScreen }) }}
    >
      <Box
        sx={{
          position: 'relative',
          display: 'grid',
          gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: '220px minmax(0, 1fr) 280px' },
          minHeight: { md: 640 },
        }}
      >
        <IconButton
          aria-label={done ? 'Close' : 'Close. Your answers are kept.'}
          onClick={handleClose}
          sx={{ ...MIN_TOUCH_TARGET_SX, position: 'absolute', top: 8, right: 8, zIndex: 1, color: 'var(--dash-dim)' }}
        >
          <CloseIcon />
        </IconButton>

        <Box
          component="nav"
          aria-label="Create league steps"
          sx={{
            backgroundColor: 'var(--dash-surface2)',
            borderRight: { md: 1 },
            borderBottom: { xs: 1, md: 0 },
            borderColor: 'var(--dash-line)',
            p: { xs: 2, md: 3 },
            pr: { xs: 7, md: 2 },
            display: 'flex',
            flexDirection: 'column',
            gap: 1,
          }}
        >
          <DialogTitle
            sx={{
              p: 0,
              mb: { md: 1.5 },
              fontFamily: DISPLAY_FONT,
              fontSize: { xs: '24px', md: '28px' },
              fontWeight: 700,
              lineHeight: 1,
              textTransform: 'uppercase',
            }}
          >
            Create a league
          </DialogTitle>
          <Box
            component="ol"
            sx={{
              listStyle: 'none',
              m: 0,
              p: 0,
              display: 'flex',
              flexDirection: { xs: 'row', md: 'column' },
              gap: 0.5,
              overflowX: { xs: 'auto', md: 'visible' },
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
              return (
                <Box component="li" key={label} sx={{ flexShrink: 0 }}>
                  <Button
                    type="button"
                    fullWidth
                    color="inherit"
                    aria-current={current ? 'step' : undefined}
                    aria-disabled={locked ? 'true' : 'false'}
                    onClick={() => goTo(i)}
                    // The current step lifts to `dash-surface` (a card), as
                    // does a hovered one; the rest sit on the rail's stat tile.
                    sx={{
                      minHeight: 56,
                      justifyContent: 'flex-start',
                      textAlign: 'left',
                      textTransform: 'none',
                      gap: 1.5,
                      px: 1.25,
                      borderRadius: 'var(--dash-radius-sm)',
                      color: 'var(--dash-ink)',
                      backgroundColor: current ? 'var(--dash-surface)' : 'transparent',
                      cursor: locked ? 'not-allowed' : 'pointer',
                      '&:hover': { backgroundColor: 'var(--dash-surface)' },
                    }}
                  >
                    <Box
                      component="span"
                      aria-hidden="true"
                      sx={{
                        width: 28,
                        height: 28,
                        flexShrink: 0,
                        borderRadius: '50%',
                        border: 2,
                        borderColor: current || past ? 'var(--dash-accent)' : (needsFix ? 'var(--dash-warning)' : 'var(--dash-dim)'),
                        backgroundColor: past ? 'var(--dash-accent)' : 'transparent',
                        color: past ? 'var(--dash-on-accent)' : (current ? 'var(--dash-accent)' : 'var(--dash-dim)'),
                        display: 'grid',
                        placeItems: 'center',
                        fontSize: 13,
                        fontWeight: 700,
                      }}
                    >
                      {past ? <CheckIcon sx={{ fontSize: 16 }} /> : i + 1}
                    </Box>
                    <Box component="span" sx={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                      <Box component="span" sx={{ fontSize: 14, fontWeight: 600 }}>
                        {label}
                        <Box component="span" sx={visuallyHidden}>{srState}</Box>
                      </Box>
                      <Box
                        component="span"
                        sx={{
                          display: { xs: 'none', md: 'block' },
                          fontSize: 12,
                          // Needs attention reads in ink, not the warning
                          // color: warning TEXT is registered on a card, not on
                          // the rail's stat tile. The ring carries the tone.
                          color: needsFix ? 'var(--dash-ink)' : 'var(--dash-dim)',
                          fontWeight: needsFix ? 600 : 400,
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                      >
                        {sub}
                      </Box>
                    </Box>
                  </Button>
                </Box>
              );
            })}
          </Box>
          <Typography variant="caption" sx={{ ...dimSx, fontSize: '12px', mt: 'auto', display: { xs: 'none', md: 'block' } }}>
            Your answers are kept if you close this and come back.
          </Typography>
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
              sx={{ flexGrow: 1, textAlign: 'center', px: { xs: 2, sm: 5 }, py: 5 }}
            >
              <Box
                aria-hidden="true"
                sx={{
                  width: 72,
                  height: 72,
                  borderRadius: '50%',
                  display: 'grid',
                  placeItems: 'center',
                  color: 'var(--dash-accent)',
                  border: '2px solid var(--dash-accent)',
                  backgroundColor: 'var(--dash-accent-soft)',
                }}
              >
                <CheckIcon sx={{ fontSize: 36 }} />
              </Box>
              <StepHeading key="done">{`${leagueName.trim() || 'Your league'} is ready`}</StepHeading>
              {inviteCode && (
                <>
                  <Typography sx={{ ...dimSx, maxWidth: 420 }}>
                    Share the invite code so managers can join. You&apos;ll see each one land in Activity.
                  </Typography>
                  <Stack
                    direction={{ xs: 'column', sm: 'row' }}
                    spacing={1.5}
                    alignItems="center"
                    sx={{ p: 1.25, pl: { sm: 2.5 }, borderRadius: 'var(--dash-radius-sm)', border: HAIRLINE, backgroundColor: 'var(--dash-surface2)' }}
                  >
                    <Box
                      component="code"
                      sx={{ fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace', fontSize: 22, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--dash-ink)' }}
                    >
                      {inviteCode}
                    </Box>
                    <Button
                      type="button"
                      variant="outlined"
                      aria-label={`Copy invite code ${inviteCode}`}
                      onClick={() => copy(inviteCode, 'Invite code copied')}
                      sx={{ ...ghostButtonSx, ...MIN_TOUCH_TARGET_SX }}
                    >
                      Copy
                    </Button>
                    <Button
                      type="button"
                      variant="outlined"
                      onClick={() => copy(joinLink(inviteCode), 'Invite link copied')}
                      sx={{ ...ghostButtonSx, ...MIN_TOUCH_TARGET_SX }}
                    >
                      Copy invite link
                    </Button>
                  </Stack>
                </>
              )}
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ pt: 1 }}>
                {createdId != null && (
                  <Button
                    component={RouterLink}
                    to={`/league/${createdId}`}
                    variant="contained"
                    size="large"
                    onClick={handleClose}
                    sx={{ ...primaryButtonSx, ...bigButtonSx }}
                  >
                    Go to league
                  </Button>
                )}
                <Button type="button" variant="outlined" size="large" onClick={handleClose} sx={{ ...ghostButtonSx, ...bigButtonSx }}>
                  Done
                </Button>
              </Stack>
            </Stack>
          ) : (
            <>
              <Stack spacing={3} sx={{ flexGrow: 1, px: { xs: 2, sm: 5 }, pt: { xs: 3, sm: 4.5 }, pb: 3 }}>
                {stepBody()}
              </Stack>
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: 1.5,
                  px: { xs: 2, sm: 5 },
                  py: 2,
                  borderTop: HAIRLINE,
                }}
              >
                <Typography role="status" variant="body2" sx={{ mr: 'auto', fontWeight: 600, color: 'var(--dash-danger)' }}>
                  {hint}
                </Typography>
                {step === 0 ? (
                  <Button type="button" variant="outlined" size="large" onClick={handleClose} sx={{ ...ghostButtonSx, ...bigButtonSx }}>
                    Cancel
                  </Button>
                ) : (
                  <Button type="button" variant="outlined" size="large" onClick={() => goTo(step - 1)} sx={{ ...ghostButtonSx, ...bigButtonSx }}>
                    Back
                  </Button>
                )}
                <Button
                  type="submit"
                  variant="contained"
                  size="large"
                  aria-disabled={pending ? 'true' : undefined}
                  sx={{ ...primaryButtonSx, ...bigButtonSx }}
                >
                  {submitLabel}
                </Button>
              </Box>
            </>
          )}
        </Box>

        <Box
          component="aside"
          aria-label="League preview"
          sx={{
            backgroundColor: 'var(--dash-surface2)',
            borderLeft: { md: 1 },
            borderTop: { xs: 1, md: 0 },
            borderColor: 'var(--dash-line)',
            p: { xs: 2, md: 2.5 },
            pt: { md: 9 },
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
          }}
        >
          <Typography
            variant="overline"
            component="p"
            sx={{ ...dimSx, fontSize: '12px', fontWeight: 700, letterSpacing: '0.08em', lineHeight: 1.6 }}
          >
            Preview
          </Typography>
          <Box sx={{ backgroundColor: 'var(--dash-surface)', border: HAIRLINE, borderRadius: 'var(--dash-radius)', overflow: 'hidden' }}>
            <Stack direction="row" spacing={1.25} alignItems="center" sx={{ p: 2, borderBottom: HAIRLINE }}>
              <Box
                aria-hidden="true"
                sx={{
                  width: 40,
                  height: 40,
                  flexShrink: 0,
                  borderRadius: 'var(--dash-radius-sm)',
                  backgroundColor: 'var(--dash-surface3)',
                  display: 'grid',
                  placeItems: 'center',
                  fontFamily: DISPLAY_FONT,
                  fontSize: 20,
                  fontWeight: 700,
                }}
              >
                {(leagueName.trim()[0] || '?').toUpperCase()}
              </Box>
              <Box sx={{ minWidth: 0 }}>
                <Typography noWrap sx={{ fontWeight: 600 }} title={leagueName || undefined}>
                  {leagueName || 'Untitled league'}
                </Typography>
                <Typography noWrap variant="caption" component="p" sx={{ ...dimSx, fontSize: '13px' }}>
                  {`${teamName || 'Your team'} · Commissioner`}
                </Typography>
              </Box>
            </Stack>
            <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 2, display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
              {chips.map((chip) => (
                <Box
                  component="li"
                  key={chip}
                  sx={{
                    px: 1.25,
                    py: 0.25,
                    borderRadius: 999,
                    border: '1px solid var(--dash-line-strong)',
                    fontSize: 12,
                    fontWeight: 600,
                    color: 'var(--dash-dim)',
                  }}
                >
                  {chip}
                </Box>
              ))}
            </Box>
          </Box>
          <Typography variant="body2" sx={helpSx}>
            This is how the league appears on your home screen. You&apos;ll be its commissioner.
          </Typography>
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
