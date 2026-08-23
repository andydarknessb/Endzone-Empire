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

const LABELS = {
  pending: DRAFT_NOT_STARTED_LABEL,
  active: 'Draft in progress',
  complete: 'Draft complete',
};

const UNKNOWN_LABEL = 'Draft status unknown';

/** The product-language label for a stored `draft_status`. */
export function draftStatusLabel(draftStatus) {
  return LABELS[draftStatus] || UNKNOWN_LABEL;
}
