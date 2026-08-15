import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Box, Button, Card, CardActionArea, CardActions, CardContent, Chip,
  Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle,
  IconButton, Menu, MenuItem, Stack, Typography,
} from '@mui/material';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import Countdown from '../Countdown/Countdown';
import { deriveLeaguePhase, LEAGUE_PHASE, LEAGUE_PHASE_META } from '../../lib/leaguePhase';

function LeagueCard({ league, isOwner = false, onDelete, compact = false }) {
  const [anchorEl, setAnchorEl] = useState(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const phase = deriveLeaguePhase(league);
  const meta = LEAGUE_PHASE_META[phase] || { label: 'League', color: 'default' };

  const content = (
    <CardContent sx={{ height: '100%' }}>
      <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={1}>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="h6" sx={{ fontWeight: 700 }} noWrap>{league.name}</Typography>
          <Typography variant="body2" color="text.secondary">
            Team: {league.my_team_name || 'Team not assigned'}
          </Typography>
        </Box>
        <Chip size="small" label={meta.label} color={meta.color} />
      </Stack>
      <Stack direction="row" spacing={1} rowGap={1} flexWrap="wrap" useFlexGap sx={{ mt: 1.5 }}>
        {league.team_count != null && (
          <Chip size="small" variant="outlined" label={`${league.team_count}/${league.max_teams || '-'} teams`} />
        )}
        {league.pickem_only && <Chip size="small" color="secondary" label="Pick'em" />}
        {league.scoring_preset && (
          <Chip size="small" variant="outlined" label={league.scoring_preset.replace('_', ' ').toUpperCase()} />
        )}
        {(isOwner || league.is_commissioner) && (
          <Chip size="small" color="primary" variant="outlined" label={isOwner ? 'Commissioner' : 'Co-Commissioner'} />
        )}
        {phase === LEAGUE_PHASE.PRE_DRAFT && league.draft_date && (
          <Countdown variant="chip" date={league.draft_date} />
        )}
      </Stack>
    </CardContent>
  );

  return (
    <Card variant="outlined" sx={{ bgcolor: 'background.paper', height: '100%' }} data-testid="shared-league-card">
      {compact ? (
        <CardActionArea component={Link} to={`/league/${league.id}`} sx={{ height: '100%' }}>
          {content}
        </CardActionArea>
      ) : (
        <>
          <Stack direction="row" alignItems="flex-start">
            <Box sx={{ flexGrow: 1, minWidth: 0 }}>{content}</Box>
            {isOwner && onDelete && (
              <IconButton aria-label="League actions" size="small" onClick={(event) => setAnchorEl(event.currentTarget)} sx={{ m: 1 }}>
                <MoreVertIcon />
              </IconButton>
            )}
          </Stack>
          <CardActions sx={{ px: 2, pb: 2, pt: 0, flexWrap: 'wrap', gap: 1 }}>
            <Button component={Link} to={`/league/${league.id}`} variant="contained">Dashboard</Button>
            {league.pickem_only ? (
              <Button component={Link} to={`/league/${league.id}/pickem`} variant="outlined">Pick&apos;em</Button>
            ) : (
              <>
                <Button component={Link} to={`/league/${league.id}/draft`} variant="outlined">Draft Room</Button>
                <Button component={Link} to={`/league/${league.id}/game-center`} variant="outlined">Game Center</Button>
              </>
            )}
          </CardActions>
        </>
      )}

      <Menu anchorEl={anchorEl} open={Boolean(anchorEl)} onClose={() => setAnchorEl(null)}>
        <MenuItem sx={{ color: 'error.main' }} onClick={() => { setAnchorEl(null); setConfirmOpen(true); }}>
          Delete
        </MenuItem>
      </Menu>
      <Dialog open={confirmOpen} onClose={() => setConfirmOpen(false)}>
        <DialogTitle>Delete {league.name}?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            This permanently removes the league, its roster, and its history for every member. This can&apos;t be undone.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmOpen(false)}>Cancel</Button>
          <Button color="error" variant="contained" onClick={() => { setConfirmOpen(false); onDelete?.(league.id); }}>
            Delete League
          </Button>
        </DialogActions>
      </Dialog>
    </Card>
  );
}

export default LeagueCard;
