import React, { useState } from 'react';
import {
  IconButton,
  Tooltip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  List,
  ListItem,
  ListItemText,
} from '@mui/material';
import HelpOutlineIcon from '@mui/icons-material/HelpOutline';
import { STAT_DEFINITIONS } from '../common/AbbreviationTooltip';
import { MIN_TOUCH_TARGET_SX } from '../../lib/a11y';

// The pool's per-column abbreviation tooltips (see AbbreviationTooltip) are
// individually keyboard-focusable, but a keyboard/screen-reader user has no
// way to discover the injury-status codes (Q/D/O/IR) the same way a mouse
// user can hover InjuryBadge's Tooltip - and no single place lists everything
// at once. This is that one place.
const STATUS_DEFINITIONS = [
  { term: 'Q', definition: 'Questionable' },
  { term: 'D', definition: 'Doubtful' },
  { term: 'O', definition: 'Out' },
  { term: 'IR', definition: 'Injured Reserve' },
];

const COLUMN_TERMS = ['Bye', 'ADP', 'Pos rank', '17-game pace'];

/** A keyboard-accessible "Column guide" button + dialog explaining the pool
 * table's abbreviations (ADP, Pos rank, Bye, 17-game pace) and injury-status
 * vocabulary (Q/D/O/IR) in one place. */
function ColumnGuide() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Tooltip title="Column guide">
        <IconButton aria-label="Column guide" size="small" onClick={() => setOpen(true)} sx={MIN_TOUCH_TARGET_SX}>
          <HelpOutlineIcon fontSize="small" />
        </IconButton>
      </Tooltip>
      <Dialog open={open} onClose={() => setOpen(false)} aria-labelledby="column-guide-title">
        <DialogTitle id="column-guide-title">Column guide</DialogTitle>
        <DialogContent>
          <List dense>
            {COLUMN_TERMS.map((term) => (
              <ListItem key={term} disableGutters>
                <ListItemText primary={term} secondary={STAT_DEFINITIONS[term]} />
              </ListItem>
            ))}
            {STATUS_DEFINITIONS.map(({ term, definition }) => (
              <ListItem key={term} disableGutters>
                <ListItemText primary={term} secondary={definition} />
              </ListItem>
            ))}
          </List>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)} sx={{ minHeight: 44 }}>Close</Button>
        </DialogActions>
      </Dialog>
    </>
  );
}

export default ColumnGuide;
