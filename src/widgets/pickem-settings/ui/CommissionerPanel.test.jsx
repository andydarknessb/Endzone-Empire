/* eslint-disable testing-library/no-node-access, testing-library/no-container -- the cursor frame, the pixel marks and the sticky strip are classes, svgs and styles with no role */
import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CommissionerPanel from './CommissionerPanel';

const settings = (overrides = {}) => ({ enabled: true, mode: 'straight', isCommissioner: true, ...overrides });
const renderPanel = (props = {}) => render(
  <CommissionerPanel settings={settings()} saving={false} error={null} onSave={jest.fn()} {...props} />
);
const edit = () => screen.getByRole('button', { name: /Edit commissioner settings/ });

test('collapsed by default to one row with a ghost Edit, and no form controls', () => {
  renderPanel({ modeLocked: true });
  expect(screen.getByRole('heading', { level: 2, name: 'Commissioner settings' })).toBeInTheDocument();
  expect(screen.getByTestId('pickem-settings-summary')).toHaveTextContent("Pick'em on · Straight up · locked for the season");
  expect(edit()).toHaveAttribute('aria-expanded', 'false');
  expect(edit()).toHaveTextContent('Edit');
  expect(screen.queryByRole('radio')).not.toBeInTheDocument();
  expect(screen.queryByRole('switch')).not.toBeInTheDocument();
});

test('Edit opens the body and reads Hide; Hide closes it again', async () => {
  const user = userEvent.setup();
  renderPanel();
  await user.click(edit());
  const hide = screen.getByRole('button', { name: /Hide commissioner settings/ });
  expect(hide).toHaveAttribute('aria-expanded', 'true');
  expect(hide).toHaveTextContent('Hide');
  expect(screen.getAllByRole('radio')).toHaveLength(2);
  expect(screen.getByText(/Pick'em runs for the whole league alongside fantasy/)).toBeInTheDocument();
  await user.click(hide);
  expect(screen.queryByRole('radio')).not.toBeInTheDocument();
});

test('with Pick\'em off the panel opens on the switch, and the switch turns it on', async () => {
  const user = userEvent.setup();
  const onSave = jest.fn();
  renderPanel({ settings: settings({ enabled: false }), onSave });
  const toggle = screen.getByRole('switch', { name: /Enable Pick'em for this league/i });
  expect(toggle).not.toBeChecked();
  await user.click(toggle);
  expect(onSave).toHaveBeenCalledWith({ enabled: true });
});

test('the summary names Pick\'em on, the mode, and the lock only once the mode is locked', () => {
  const { rerender } = renderPanel({ settings: settings({ mode: 'confidence' }) });
  expect(screen.getByTestId('pickem-settings-summary')).toHaveTextContent("Pick'em on · Confidence");
  expect(screen.getByTestId('pickem-settings-summary')).not.toHaveTextContent('locked');
  rerender(<CommissionerPanel settings={settings({ mode: 'confidence' })} saving={false} error={null} onSave={jest.fn()} modeLocked />);
  expect(screen.getByTestId('pickem-settings-summary')).toHaveTextContent('locked for the season');
});

test('a pick\'em-only league drops "Pick\'em on" and the switch, and only exposes the scoring mode', async () => {
  const user = userEvent.setup();
  renderPanel({ lockedOn: true });
  expect(screen.getByTestId('pickem-settings-summary')).toHaveTextContent('Straight up');
  expect(screen.getByTestId('pickem-settings-summary')).not.toHaveTextContent("Pick'em on");
  await user.click(edit());
  expect(screen.queryByRole('switch')).not.toBeInTheDocument();
  expect(screen.getByText("Pick'em is always on in this league.")).toBeInTheDocument();
  expect(screen.getByRole('radio', { name: /Straight up/ })).toBeChecked();
});

test('after the season\'s first pick the scoring cards are disabled, the selected one says Locked, and the reason shows', async () => {
  const user = userEvent.setup();
  renderPanel({ modeLocked: true });
  await user.click(edit());
  const radios = screen.getAllByRole('radio');
  radios.forEach((radio) => expect(radio).toBeDisabled());
  expect(screen.getByRole('radio', { name: /Straight up/ }).closest('label')).toHaveTextContent('Locked');
  expect(screen.getByRole('radio', { name: /Confidence/ }).closest('label')).not.toHaveTextContent('Locked');
  expect(screen.getByRole('button', { name: /Save scoring mode/i })).toBeDisabled();
  expect(screen.getByText("The mode can only change before the season's first pick.")).toBeInTheDocument();
  // The switch stays usable.
  expect(screen.getByRole('switch')).not.toBeDisabled();
});

test('saving the scoring mode is disabled until a different mode is chosen, and posts it on click', async () => {
  const user = userEvent.setup();
  const onSave = jest.fn();
  renderPanel({ onSave });
  await user.click(edit());

  const save = screen.getByRole('button', { name: /Save scoring mode/i });
  expect(save).toBeDisabled();
  await user.click(screen.getByRole('radio', { name: /Confidence/ }));
  expect(save).toBeEnabled();
  await user.click(save);
  expect(onSave).toHaveBeenCalledWith({ mode: 'confidence' });
});

// Accessibility risk review, #1267: a successful mode save disables the Save button the click is
// still focused on (mode === settings.mode once the write-through lands), so a confirmation must
// pick up the focus instead of letting it fall to <body> (WCAG 4.1.3).
test('a successful scoring-mode save moves focus onto a confirmation instead of stranding it', async () => {
  const user = userEvent.setup();
  let current = settings();
  const onSave = jest.fn(async (patch) => {
    current = { ...current, ...patch };
    return { ok: true };
  });
  const { rerender } = renderPanel({ settings: current, onSave });
  await user.click(edit());

  await user.click(screen.getByRole('radio', { name: /Confidence/ }));
  await user.click(screen.getByRole('button', { name: /Save scoring mode/i }));
  rerender(<CommissionerPanel settings={current} saving={false} error={null} onSave={onSave} />);

  const confirmation = await screen.findByTestId('pickem-settings-mode-saved');
  expect(confirmation).toHaveTextContent('Scoring mode saved');
  expect(confirmation).toHaveFocus();
  expect(screen.getByRole('button', { name: /Save scoring mode/i })).toBeDisabled();
});

test('a rejected save surfaces the server error', async () => {
  const user = userEvent.setup();
  renderPanel({ error: "Pick'em settings could not be saved." });
  await user.click(edit());
  expect(screen.getByRole('alert')).toHaveTextContent("Pick'em settings could not be saved.");
});

test('paints no dash token and uses no opacity, open or closed', async () => {
  const user = userEvent.setup();
  const { container } = renderPanel({ modeLocked: true });
  await user.click(edit());
  expect(container.innerHTML).not.toMatch(/dash-|opacity/);
});
