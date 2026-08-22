import React from 'react';
import {
  Box, FormControl, FormControlLabel, FormLabel, Radio, RadioGroup, Typography,
} from '@mui/material';
import { LEAGUE_TYPE_OPTIONS, includesPickem } from '../../lib/leagueType';
import { PICKEM_MODE_OPTIONS } from '../LeaguePickem/PickemSettingsPanel';

/**
 * The league-type choice at the top of both create dialogs, plus the pick'em
 * scoring-mode picker that applies once the chosen type includes pick'em.
 * Shared so the two dialogs (UserPage, LeagueManagement) can never drift on
 * the copy or on when the mode picker shows.
 */
export default function LeagueTypeFields({ leagueType, onLeagueTypeChange, pickemMode, onPickemModeChange }) {
  return (
    <Box>
      <FormControl component="fieldset" fullWidth sx={{ mt: 1 }}>
        <FormLabel id="create-league-type-label">League type</FormLabel>
        <RadioGroup
          aria-labelledby="create-league-type-label"
          value={leagueType}
          onChange={(event) => onLeagueTypeChange(event.target.value)}
        >
          {LEAGUE_TYPE_OPTIONS.map((option) => (
            <FormControlLabel
              key={option.value}
              value={option.value}
              control={<Radio />}
              sx={{ alignItems: 'flex-start', mt: 0.5 }}
              label={(
                <Box>
                  <Typography variant="body1">{option.label}</Typography>
                  <Typography variant="caption" color="text.secondary" component="div">
                    {option.helper}
                  </Typography>
                </Box>
              )}
            />
          ))}
        </RadioGroup>
      </FormControl>

      {includesPickem(leagueType) && (
        <FormControl component="fieldset" fullWidth sx={{ mt: 1 }}>
          <FormLabel id="create-pickem-mode-label">Pick&apos;em scoring</FormLabel>
          <RadioGroup
            aria-labelledby="create-pickem-mode-label"
            value={pickemMode}
            onChange={(event) => onPickemModeChange(event.target.value)}
          >
            {PICKEM_MODE_OPTIONS.map((option) => (
              <FormControlLabel
                key={option.value}
                value={option.value}
                control={<Radio />}
                label={option.label}
              />
            ))}
          </RadioGroup>
          <Typography variant="caption" color="text.secondary">
            The mode can only change before the season&apos;s first pick.
          </Typography>
        </FormControl>
      )}
    </Box>
  );
}
