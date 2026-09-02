import React, { useEffect, useState } from 'react';
import PropTypes from 'prop-types';
import { Alert, Box, Button, Stack, Typography } from '@mui/material';
import DraftScheduleField from '../common/DraftScheduleField';
import DraftStartControl from '../DraftBoard/DraftStartControl';
import { browserTimeZone, utcIsoToZonedWallTime, zonedWallTimeToUtcIso } from '../../lib/draftTimezone';

// A league's stored draft_timezone if it has one (a schedule saved through
// this feature); otherwise the viewer's own zone, so a legacy zone-less
// schedule and a fresh selector both start from a sensible default (#116
// AC3). The wall time is then read out of the *stored* instant in whichever
// zone that resolves to, never left desynced from it.
function initialZone(league) {
  return league.draft_timezone || browserTimeZone();
}

function validateDraftDate(wallTime, timeZone) {
  if (!wallTime) return '';
  const utcInstant = zonedWallTimeToUtcIso(wallTime, timeZone);
  if (!utcInstant) return 'Enter a valid draft date and time.';
  if (new Date(utcInstant).getTime() <= Date.now()) return 'Choose a draft date and time in the future.';
  return '';
}

export default function SchedulePanel({ league, teamCount, frozen, onSave, onStart, saving, onDirtyChange }) {
  const [timeZone, setTimeZone] = useState(() => initialZone(league));
  const [draftDate, setDraftDate] = useState(() => utcIsoToZonedWallTime(league.draft_date, initialZone(league)));
  const [acknowledged, setAcknowledged] = useState(false);
  const [draftDateError, setDraftDateError] = useState(() => validateDraftDate(draftDate, timeZone));
  useEffect(() => {
    const nextZone = initialZone(league);
    const nextDraftDate = utcIsoToZonedWallTime(league.draft_date, nextZone);
    setTimeZone(nextZone);
    setDraftDate(nextDraftDate);
    setAcknowledged(false);
    setDraftDateError(validateDraftDate(nextDraftDate, nextZone));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [league.draft_date, league.draft_timezone]);
  useEffect(() => {
    setDraftDateError(validateDraftDate(draftDate, timeZone));
  }, [draftDate, timeZone]);
  useEffect(() => {
    const dirty = draftDate !== utcIsoToZonedWallTime(league.draft_date, initialZone(league))
      || (draftDate && timeZone !== initialZone(league));
    onDirtyChange(Boolean(dirty));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftDate, timeZone, league.draft_date, league.draft_timezone, onDirtyChange]);
  const auctionUnavailable = league.draft_type === 'auction';
  const minimumTeams = Number.isInteger(Number(league.min_teams)) ? Number(league.min_teams) : 2;
  const insufficientTeams = teamCount < minimumTeams;
  // Saving a scheduled draft requires explicit acknowledgement of the zone
  // above (#116 AC3); clearing the date needs none, there is nothing to
  // confirm.
  const needsAcknowledgement = Boolean(draftDate) && !acknowledged;
  const handleSave = () => {
    const validationError = validateDraftDate(draftDate, timeZone);
    setDraftDateError(validationError);
    if (validationError || needsAcknowledgement) return;
    // Draft date and timezone move together as one save (#116 AC2): clearing
    // the date clears the zone with it (AC5), and a scheduled date always
    // carries the zone it was confirmed in.
    onSave(
      {
        draftDate: draftDate ? zonedWallTimeToUtcIso(draftDate, timeZone) : null,
        draftTimezone: draftDate ? timeZone : null,
      },
      'Draft schedule saved'
    );
  };
  return (
    <Stack spacing={2}>
      {frozen && <Alert severity="info">Scheduling is locked after the draft starts.</Alert>}
      {auctionUnavailable && <Alert severity="info">Live salary-cap auctions are coming soon. Scheduling and immediate start are unavailable.</Alert>}
      <DraftScheduleField
        wallTime={draftDate}
        onWallTimeChange={setDraftDate}
        timeZone={timeZone}
        onTimeZoneChange={setTimeZone}
        acknowledged={acknowledged}
        onAcknowledgedChange={setAcknowledged}
        disabled={frozen || auctionUnavailable}
        minWallTime={utcIsoToZonedWallTime(new Date(), timeZone)}
        error={draftDateError}
      />
      <Typography variant="caption" color={insufficientTeams ? 'error' : 'text.secondary'}>{teamCount} of {minimumTeams} required teams have joined.</Typography>
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
        <Button variant="contained" disabled={frozen || saving || auctionUnavailable || Boolean(draftDateError) || needsAcknowledgement} onClick={handleSave}>Save schedule</Button>
        <DraftStartControl
          teamCount={teamCount}
          minimumTeams={minimumTeams}
          auctionUnavailable={auctionUnavailable}
          market={league.market}
          onStart={onStart}
          label="Start Draft Now"
          variant="outlined"
          disabled={frozen || saving}
          showHints={false}
        />
      </Box>
    </Stack>
  );
}

SchedulePanel.propTypes = { league: PropTypes.object.isRequired, teamCount: PropTypes.number.isRequired, frozen: PropTypes.bool.isRequired, onSave: PropTypes.func.isRequired, onStart: PropTypes.func.isRequired, saving: PropTypes.bool, onDirtyChange: PropTypes.func.isRequired };
