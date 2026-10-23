import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import apiClient from '../../../api/apiClient';
import AdvanceWeek from './AdvanceWeek';

jest.mock('../../../api/apiClient', () => ({
  __esModule: true,
  default: { post: jest.fn() },
}));

afterEach(() => {
  jest.clearAllMocks();
});

test('Confirm posts the week the commissioner saw, so a stale confirm is refused', async () => {
  apiClient.post.mockResolvedValue({ data: {} });
  render(<AdvanceWeek leagueId={42} currentWeek={5} onAdvanced={jest.fn()} />);

  await userEvent.click(screen.getByRole('button', { name: 'Advance to Week 6' }));
  await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));

  await waitFor(() => expect(apiClient.post).toHaveBeenCalledTimes(1));
  expect(apiClient.post).toHaveBeenCalledWith('/api/scoring/league/42/advance-week', { week: 5 });
});

test('a disabledReason disables the button and shows the reason, linked by aria-describedby', () => {
  render(<AdvanceWeek leagueId={42} currentWeek={5} disabledReason="Opens when every Week 5 game is final" />);

  const button = screen.getByRole('button', { name: 'Advance to Week 6' });
  expect(button).toBeDisabled();
  const reason = screen.getByText('Opens when every Week 5 game is final');
  expect(button).toHaveAttribute('aria-describedby', reason.id);
});

test('without a disabledReason the button is enabled and nothing is described', () => {
  render(<AdvanceWeek leagueId={42} currentWeek={5} />);

  const button = screen.getByRole('button', { name: 'Advance to Week 6' });
  expect(button).toBeEnabled();
  expect(button).not.toHaveAttribute('aria-describedby');
});

describe('the playselect look', () => {
  test('is a ghost button, never filled, with the sentence beside it', () => {
    const { container } = render(<AdvanceWeek leagueId={42} currentWeek={5} />);

    const button = screen.getByRole('button', { name: 'Advance to Week 6' });
    expect(button).toBeEnabled();
    expect(screen.getByText(/^Advancing closes Week 5 matchups and opens Week 6/)).toBeInTheDocument();
    // eslint-disable-next-line testing-library/no-container, testing-library/no-node-access
    expect(container.querySelector('[data-filled="true"]')).toBeNull();
  });

  test('a disabledReason replaces the sentence, disables the button and is its description', () => {
    render(<AdvanceWeek leagueId={42} currentWeek={5} disabledReason="Opens when every Week 5 game is final" />);

    const button = screen.getByRole('button', { name: 'Advance to Week 6' });
    expect(button).toBeDisabled();
    const reason = screen.getByText('Opens when every Week 5 game is final');
    expect(button).toHaveAttribute('aria-describedby', reason.id);
    expect(screen.queryByText(/^Advancing closes/)).not.toBeInTheDocument();
  });

  test('Confirm posts the week, and a refusal shows the server sentence', async () => {
    apiClient.post.mockRejectedValue({ response: { status: 409, data: { error: 'week 5 was already advanced' } } });
    render(<AdvanceWeek leagueId={42} currentWeek={5} />);

    await userEvent.click(screen.getByRole('button', { name: 'Advance to Week 6' }));
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));

    expect(apiClient.post).toHaveBeenCalledWith('/api/scoring/league/42/advance-week', { week: 5 });
    expect(await screen.findByRole('alert')).toHaveTextContent('week 5 was already advanced');
  });
});
