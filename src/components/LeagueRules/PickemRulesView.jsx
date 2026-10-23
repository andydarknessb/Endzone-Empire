import React from 'react';
import { Box } from '@mui/material';
import { ErrorPanel, Skel } from '../../shared/ui/playselect/Controls';
import { usePickemSettings } from '../../entities/pickem-game';
import RuleRow from './RuleRow';
import { SectionTitle } from './rulesParts';
import { PICKEM_MODE_OPTIONS } from '../../widgets/pickem-settings';

/**
 * The read-only rulebook of a pick'em-only league. Everything but the scoring
 * mode is fixed by the game itself; the mode is read from the league's pick'em
 * settings so this page always states the rule actually in force.
 */
export default function PickemRulesView({ league }) {
  // The same row the Pick'em page reads, so arriving from there (or a save
  // made there) states the mode in force with no request of its own.
  const { settings, error, refetch } = usePickemSettings(league.id);

  // RuleRow renders its value nowrap, so the value stays a word and the full
  // rule sentence goes in the detail line.
  const mode = PICKEM_MODE_OPTIONS.find((option) => option.value === settings?.mode);
  const modeName = mode ? mode.label.split(':')[0] : settings?.mode;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
      <Box>
        <SectionTitle>Scoring</SectionTitle>
        {error ? (
          <ErrorPanel
            title="Scoring mode"
            body={'We could not load the scoring mode.'}
            onRetry={refetch}
            retryAriaLabel="Try again to load the scoring mode"
          />
        ) : !settings ? (
          <Skel width="100%" height={48} />
        ) : (
          <RuleRow
            label="Scoring mode"
            value={modeName}
            detail={`${mode ? mode.label + '. ' : ''}The mode can only change before the season's first pick.`}
          />
        )}
        <RuleRow
          label="Tied game"
          value="Credits nobody"
          detail="A tied game credits nobody: it counts as neither correct nor incorrect."
        />
      </Box>

      <Box>
        <SectionTitle>Picks</SectionTitle>
        <RuleRow
          label="Picks lock"
          value="At kickoff"
          detail="Picks lock at kickoff, game by game. Everyone's picks are revealed as each game locks."
        />
        <RuleRow
          label="Every game, every week"
          value="Weeks 1 to 18"
          detail="Weeks follow the NFL calendar. Nothing to draft, no lineups to set."
        />
      </Box>

      <Box>
        <SectionTitle>Season</SectionTitle>
        <RuleRow
          label="Standings"
          value="Season-long"
          detail="Standings are cumulative for the season: every week's points add up. A manager who joins mid-season starts from zero."
        />
        <RuleRow
          label="Champion"
          value="Highest season total"
          detail="Most correct picks at the end of the season wins (highest points in confidence mode). Ties make co-champions. No playoffs."
        />
      </Box>
    </Box>
  );
}
