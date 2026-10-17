/* eslint-disable testing-library/no-node-access, testing-library/no-container, testing-library/prefer-presence-queries -- the Play-select cursor, fill and live-region facts are DOM structure (a class, a data attribute, "no button inside this region"), which Testing Library has no query for */
import React from 'react';
import { render, screen } from '@testing-library/react';
import DropConfirmationDialog from './DropConfirmationDialog';

const ENTRY = { name: 'Puka Nacua' };

describe('DropConfirmationDialog', () => {
  test('the default look keeps the contained red Drop button and no Play-select class', () => {
    render(<DropConfirmationDialog entry={ENTRY} onClose={() => {}} onConfirm={() => {}} />);
    const drop = screen.getByRole('button', { name: 'Drop' });
    expect(drop.className).toMatch(/MuiButton-contained/);
    expect(drop).not.toHaveAttribute('data-variant');
    expect(document.querySelector('.ps-root')).toBeNull();
  });

  test('the playselect look: Cancel holds the default focus and Drop is a ghost with Danger text', () => {
    render(<DropConfirmationDialog entry={ENTRY} look="playselect" onClose={() => {}} onConfirm={() => {}} />);
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
    const drop = screen.getByRole('button', { name: 'Drop' });
    expect(drop).toHaveAttribute('data-variant', 'ghost');
    expect(document.querySelector('[data-variant="fill"]')).toBeNull();
    expect(screen.getByRole('dialog')).toHaveAccessibleName('Drop Puka Nacua?');
  });
});
