import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import DraftTypePanel from './DraftTypePanel';

const renderPanel = (draftType, onSave = jest.fn()) => {
  render(
    <DraftTypePanel
      league={{ draft_type: draftType, draft_rotation: 'snake' }}
      frozen={false}
      onSave={onSave}
      saving={false}
      onDirtyChange={jest.fn()}
    />
  );
  return { onSave };
};

test('hides and omits draft rotation when salary-cap auction is selected', () => {
  const { onSave } = renderPanel('snake');

  expect(screen.getByText('Draft rotation')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('radio', { name: /Salary-cap auction/i }));

  expect(screen.queryByText('Draft rotation')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Linear' })).not.toBeInTheDocument();
  expect(screen.getByText(/Scheduling and immediate start are unavailable/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Save draft type' }));
  expect(onSave).toHaveBeenCalledWith({ draftType: 'auction' }, 'Draft type saved');
});

test.each(['snake', 'autopick', 'offline'])('supports rotation for %s drafts', (draftType) => {
  const { onSave } = renderPanel(draftType);

  fireEvent.click(screen.getByRole('button', { name: 'Linear' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save draft type' }));

  expect(onSave).toHaveBeenCalledWith({ draftType, draftRotation: 'linear' }, 'Draft type saved');
});

// ADR 0021 / #695: "Draft rotation" names exactly one ToggleButtonGroup, so
// it is the group's label (component="p" + id + aria-labelledby) rather than
// a heading — no h5/h6 is introduced, and a bare render (no ThemeProvider)
// has no stray h6 either.
test('labels the draft rotation toggle group and introduces no heading', () => {
  renderPanel('snake');

  expect(screen.getByRole('group', { name: 'Draft rotation' })).toBeInTheDocument();
  expect(screen.queryAllByRole('heading')).toHaveLength(0);
});
