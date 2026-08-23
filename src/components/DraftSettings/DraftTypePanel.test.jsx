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
