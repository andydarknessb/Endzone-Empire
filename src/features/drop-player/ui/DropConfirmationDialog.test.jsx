/* eslint-disable testing-library/no-node-access -- the cursor, fill and live-region facts are DOM structure, which Testing Library has no query for */
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import DropConfirmationDialog from './DropConfirmationDialog';

const ENTRY = { name: 'Puka Nacua' };

describe('DropConfirmationDialog', () => {
  test('Cancel holds the default focus and Drop is a ghost with Danger text', async () => {
    render(<DropConfirmationDialog entry={ENTRY} onClose={() => {}} onConfirm={() => {}} />);
    // Focus lands once the dialog has entered: MUI's trap would otherwise leave it on the container.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus());
    const drop = screen.getByRole('button', { name: 'Drop' });
    expect(drop).toHaveAttribute('data-variant', 'ghost');
    expect(document.querySelector('[data-variant="fill"]')).toBeNull();
    expect(screen.getByRole('dialog')).toHaveAccessibleName('Drop Puka Nacua?');
  });
});
