import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CommissionerPanel from './CommissionerPanel';

const settings = (overrides = {}) => ({ enabled: false, mode: 'straight', isCommissioner: true, ...overrides });

test('a standalone panel renders in a titled card and can turn Pick\'em on', async () => {
  const user = userEvent.setup();
  const onSave = jest.fn();
  render(<CommissionerPanel settings={settings()} saving={false} error={null} onSave={onSave} />);

  expect(screen.getByRole('heading', { name: 'Commissioner settings' })).toBeInTheDocument();
  const toggle = screen.getByRole('checkbox', { name: /Enable Pick'em for this league/i });
  expect(toggle).not.toBeChecked();

  await user.click(toggle);
  expect(onSave).toHaveBeenCalledWith({ enabled: true });
});

test('embedded drops the card shell and heading', () => {
  render(<CommissionerPanel settings={settings()} saving={false} error={null} onSave={jest.fn()} embedded />);
  expect(screen.queryByRole('heading', { name: 'Commissioner settings' })).not.toBeInTheDocument();
  expect(screen.getByTestId('pickem-settings')).toBeInTheDocument();
});

test('a pick\'em-only league locks the enable switch and only exposes the scoring mode', () => {
  render(
    <CommissionerPanel settings={settings({ enabled: true })} saving={false} error={null} onSave={jest.fn()} lockedOn />
  );
  expect(screen.queryByRole('checkbox', { name: /Enable Pick'em for this league/i })).not.toBeInTheDocument();
  expect(screen.getByText("Pick'em is always on in this league.")).toBeInTheDocument();
  expect(screen.getByRole('radio', { name: /Straight up/ })).toBeChecked();
});

test('saving the scoring mode is disabled until a different mode is chosen, and posts it on click', async () => {
  const user = userEvent.setup();
  const onSave = jest.fn();
  render(<CommissionerPanel settings={settings({ enabled: true })} saving={false} error={null} onSave={onSave} />);

  const save = screen.getByRole('button', { name: /Save scoring mode/i });
  expect(save).toBeDisabled();

  await user.click(screen.getByRole('radio', { name: /Confidence/ }));
  expect(save).toBeEnabled();
  await user.click(save);
  expect(onSave).toHaveBeenCalledWith({ mode: 'confidence' });
});

// Accessibility risk review, #1267: a successful mode save disables the Save
// button the click is still focused on (mode === settings.mode once the
// write-through lands), so a confirmation must pick up the focus instead of
// letting it fall to <body> with no announcement (WCAG 4.1.3) - the same
// fix widgets/pickem-board's SaveBar already carries (#1265).
test('a successful scoring-mode save moves focus onto a confirmation instead of stranding it', async () => {
  const user = userEvent.setup();
  let currentSettings = settings({ enabled: true });
  const onSave = jest.fn(async (patch) => {
    currentSettings = { ...currentSettings, ...patch };
    return { ok: true };
  });
  const { rerender } = render(
    <CommissionerPanel settings={currentSettings} saving={false} error={null} onSave={onSave} />
  );

  await user.click(screen.getByRole('radio', { name: /Confidence/ }));
  await user.click(screen.getByRole('button', { name: /Save scoring mode/i }));
  rerender(<CommissionerPanel settings={currentSettings} saving={false} error={null} onSave={onSave} />);

  const confirmation = await screen.findByTestId('pickem-settings-mode-saved');
  expect(confirmation).toHaveTextContent('Scoring mode saved');
  expect(confirmation).toHaveFocus();
  expect(screen.getByRole('button', { name: /Save scoring mode/i })).toBeDisabled();
});

test('a rejected save surfaces the server error', () => {
  render(
    <CommissionerPanel
      settings={settings({ enabled: true })}
      saving={false}
      error="Pick'em settings could not be saved."
      onSave={jest.fn()}
    />
  );
  expect(screen.getByRole('alert')).toHaveTextContent("Pick'em settings could not be saved.");
});
