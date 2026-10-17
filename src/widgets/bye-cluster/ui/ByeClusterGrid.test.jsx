import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import apiClient from '../../../api/apiClient';
import ByeClusterGrid from './ByeClusterGrid';

jest.mock('../../../api/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn() },
}));

afterEach(() => jest.clearAllMocks());

const entry = (over) => ({
  playerId: 1, name: 'A', position: 'RB', slot: 'RB', spent: false, byeWeek: 8, ...over,
});
const two = [entry({ playerId: 1, name: 'Jahmyr Gibbs' }), entry({ playerId: 2, name: 'Puka Nacua', position: 'WR' })];
const FUTURE = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();

const waiversBody = (clearAt) => ({ data: { league: { waivers_clear_at: clearAt }, myClaims: [], onWaivers: [] } });

test('draws seven tiles for the weeks after the viewed week, a count and the positions on each', () => {
  render(<ByeClusterGrid entries={two} fromWeek={7} isPastWeek={false} waiverPeriodHours={48} />);
  const tiles = screen.getAllByTestId('bye-cluster-tile');
  expect(tiles).toHaveLength(7);
  const wk8 = tiles[0];
  expect(wk8).toHaveAttribute('data-week', '8');
  expect(wk8).toHaveAttribute('data-severity', 'notable');
  expect(within(wk8).getByText(/^2/)).toHaveTextContent('2 on bye, notable');
  expect(wk8).toHaveTextContent('RB WR');
  expect(screen.getByRole('heading', { name: 'Bye clusters' })).toBeInTheDocument();
});

test('a past week draws nothing', () => {
  const { container } = render(<ByeClusterGrid entries={two} fromWeek={7} isPastWeek waiverPeriodHours={48} />);
  expect(container).toBeEmptyDOMElement();
  expect(apiClient.get).not.toHaveBeenCalled();
});

describe('waivers clear line', () => {
  test('with a league id and a clear time to come, the line names the weekday and time', async () => {
    apiClient.get.mockResolvedValue(waiversBody(FUTURE));
    render(<ByeClusterGrid entries={two} fromWeek={7} isPastWeek={false} waiverPeriodHours={48} leagueId={9} />);
    expect(apiClient.get).toHaveBeenCalledWith('/api/waivers?leagueId=9');
    await waitFor(() => expect(screen.getByTestId('bye-cluster-line')).toHaveTextContent(/Waivers clear \w{3} \d{1,2}:\d{2} [AP]M\.$/));
    expect(screen.getByTestId('bye-cluster-line')).not.toHaveTextContent('hours');
  });

  test('keeps "in {n} hours" while the read is out, when it fails, and when the league has no clear time', async () => {
    apiClient.get.mockResolvedValueOnce(waiversBody(null));
    const { unmount } = render(<ByeClusterGrid entries={two} fromWeek={7} isPastWeek={false} waiverPeriodHours={48} leagueId={9} />);
    expect(screen.getByTestId('bye-cluster-line')).toHaveTextContent('Waivers clear in 48 hours.');
    await waitFor(() => expect(apiClient.get).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId('bye-cluster-line')).toHaveTextContent('Waivers clear in 48 hours.');
    unmount();
    apiClient.get.mockRejectedValueOnce(new Error('boom'));
    render(<ByeClusterGrid entries={two} fromWeek={7} isPastWeek={false} waiverPeriodHours={48} leagueId={9} />);
    await waitFor(() => expect(apiClient.get).toHaveBeenCalledTimes(2));
    expect(screen.getByTestId('bye-cluster-line')).toHaveTextContent('Waivers clear in 48 hours.');
  });

  test('the waivers read is made only when the line renders: no cluster of two, no read', () => {
    render(<ByeClusterGrid entries={[entry({ byeWeek: 9 })]} fromWeek={7} isPastWeek={false} waiverPeriodHours={48} leagueId={9} />);
    expect(screen.queryByTestId('bye-cluster-line')).toBeNull();
    expect(apiClient.get).not.toHaveBeenCalled();
  });

  test('a caller that passes no league id (the Waivers page) makes no read', () => {
    render(<ByeClusterGrid entries={two} fromWeek={7} isPastWeek={false} waiverPeriodHours={48} />);
    expect(apiClient.get).not.toHaveBeenCalled();
    expect(screen.getByTestId('bye-cluster-line')).toHaveTextContent('Waivers clear in 48 hours.');
  });
});
