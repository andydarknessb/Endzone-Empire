import apiClient from '../../../api/apiClient';
import { submitClaim, editClaim, cancelClaim, moveClaim } from './claimWrites';

jest.mock('../../../api/apiClient', () => ({
  __esModule: true,
  default: { post: jest.fn(), patch: jest.fn(), delete: jest.fn(), put: jest.fn() },
}));

beforeEach(() => jest.clearAllMocks());

test('submitClaim posts the claim and returns the created claim with its id', async () => {
  apiClient.post.mockResolvedValue({ data: { id: 42, status: 'pending' } });
  const created = await submitClaim({ leagueId: '7', playerId: 10, dropPlayerId: '99', bid: '12' });
  expect(apiClient.post).toHaveBeenCalledWith('/api/waivers/claim', {
    leagueId: 7,
    playerId: 10,
    dropPlayerId: 99,
    bid: 12,
  });
  expect(created).toEqual({ id: 42, status: 'pending' });
});

test('submitClaim sends a null drop and a zero bid when none is given', async () => {
  apiClient.post.mockResolvedValue({ data: { id: 1 } });
  await submitClaim({ leagueId: 7, playerId: 10, dropPlayerId: '', bid: '' });
  expect(apiClient.post).toHaveBeenCalledWith('/api/waivers/claim', {
    leagueId: 7,
    playerId: 10,
    dropPlayerId: null,
    bid: 0,
  });
});

test('submitClaim rejects with the refusal', async () => {
  const err = new Error('nope');
  apiClient.post.mockRejectedValue(err);
  await expect(submitClaim({ leagueId: 7, playerId: 10 })).rejects.toBe(err);
});

test('editClaim patches the bid and drop', async () => {
  apiClient.patch.mockResolvedValue({});
  await editClaim({ claimId: 5, bid: '8', dropPlayerId: '3' });
  expect(apiClient.patch).toHaveBeenCalledWith('/api/waivers/claim/5', { bid: 8, dropPlayerId: 3 });
  await editClaim({ claimId: 5, bid: 0, dropPlayerId: null });
  expect(apiClient.patch).toHaveBeenLastCalledWith('/api/waivers/claim/5', { bid: 0, dropPlayerId: null });
});

test('cancelClaim deletes the claim in its league', async () => {
  apiClient.delete.mockResolvedValue({});
  await cancelClaim({ leagueId: '7', claimId: 5 });
  expect(apiClient.delete).toHaveBeenCalledWith('/api/waivers/claim/5?leagueId=7');
});

test('moveClaim puts the full id list', async () => {
  apiClient.put.mockResolvedValue({});
  await moveClaim({ leagueId: '7', claimIds: [2, 1, 3] });
  expect(apiClient.put).toHaveBeenCalledWith('/api/waivers/claims/order', { leagueId: 7, claimIds: [2, 1, 3] });
});
