import React, { useState } from 'react';
import {
  Tooltip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  List,
  ListItem,
  ListItemText,
} from '@mui/material';
import HelpOutlineIcon from '@mui/icons-material/HelpOutline';
import { STAT_DEFINITIONS } from '../../shared/ui/AbbreviationTooltip';
import { SORT_FIELDS } from './sortFields';
import { PsButton } from '../../shared/ui/playselect';
import { MENU_PAPER } from '../../shared/ui/playselect/CardControls';

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

// The pool's numeric column abbreviations, derived from the module that owns the
// sort-field facts (issue #951) rather than a hand-maintained copy that could
// drift: a numeric field added there appears in this guide automatically instead
// of being silently omitted from the one place a keyboard/screen-reader user can
// discover it. sortFields.test.js pins every numeric label to a STAT_DEFINITIONS
// entry, so each term here always has a definition to render.
const COLUMN_TERMS = SORT_FIELDS.filter((field) => field.numeric).map((field) => field.label);

const DIM = { sx: { color: 'var(--ps-dim)' } };

/** A keyboard-accessible "Column guide" button + dialog explaining the pool
 * table's abbreviations (ADP, Pos rank, Bye, 17-game pace) and injury-status
 * vocabulary (Q/D/O/IR) in one place. */
function ColumnGuide() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Tooltip title="Column guide">
        <span>
          <PsButton variant="quiet" ariaLabel="Column guide" onClick={() => setOpen(true)}>
            <HelpOutlineIcon fontSize="small" />
          </PsButton>
        </span>
      </Tooltip>
      <Dialog open={open} onClose={() => setOpen(false)} aria-labelledby="column-guide-title" PaperProps={MENU_PAPER}>
        <DialogTitle id="column-guide-title">Column guide</DialogTitle>
        <DialogContent>
          <List dense>
            {COLUMN_TERMS.map((term) => (
              <ListItem key={term} disableGutters>
                <ListItemText primary={term} secondary={STAT_DEFINITIONS[term]} secondaryTypographyProps={DIM} />
              </ListItem>
            ))}
            {STATUS_DEFINITIONS.map(({ term, definition }) => (
              <ListItem key={term} disableGutters>
                <ListItemText primary={term} secondary={definition} secondaryTypographyProps={DIM} />
              </ListItem>
            ))}
          </List>
        </DialogContent>
        <DialogActions>
          <PsButton variant="ghost" onClick={() => setOpen(false)}>Close</PsButton>
        </DialogActions>
      </Dialog>
    </>
  );
}

export default ColumnGuide;
