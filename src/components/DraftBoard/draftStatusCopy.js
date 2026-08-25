/**
 * How a draft's stored status is spoken to a manager (issue #123 acceptance
 * criterion 6).
 *
 * `leagues.draft_status` holds one of three enum values, and the status
 * readout used to print whichever one it held. "pending" is a database word:
 * it names a row's state, not anything the product has ever taught a manager
 * to read, and it sits in the same chip row as "On the clock: Ridge Runners",
 * which is product language. This module is the one place the two vocabularies
 * meet, so a surface never has to decide for itself how to say a status.
 *
 * An unrecognised status is deliberately NOT echoed. Echoing it would put a
 * database value back on screen at exactly the moment the contract has
 * changed underneath the client, which is the failure this module exists to
 * prevent; naming it unknown is honest and visible instead.
 */

/** The pending draft's product-language name. See CONTEXT.md: Draft. */
export const DRAFT_NOT_STARTED_LABEL = 'Draft not started';

/**
 * One entry per stored status, holding everything the status readout says
 * about it. The chip's color lives here beside its label rather than in a
 * second cascade at the call site: they are one presentation fact about one
 * status, and splitting them is how they drift.
 */
const STATUS_READOUT = {
  pending: { label: DRAFT_NOT_STARTED_LABEL, chipColor: 'default' },
  active: { label: 'Draft in progress', chipColor: 'warning' },
  complete: { label: 'Draft complete', chipColor: 'success' },
};

const UNKNOWN = { label: 'Draft status unknown', chipColor: 'default' };

const readoutFor = (draftStatus) => STATUS_READOUT[draftStatus] || UNKNOWN;

/** The product-language label for a stored `draft_status`. */
export function draftStatusLabel(draftStatus) {
  return readoutFor(draftStatus).label;
}

/** The MUI Chip color the status readout wears for a stored `draft_status`. */
export function draftStatusChipColor(draftStatus) {
  return readoutFor(draftStatus).chipColor;
}
