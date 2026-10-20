import { renderHook, waitFor } from '@testing-library/react';
import apiClient from '../../../api/apiClient';
import { useActionItems } from './useActionItems';

jest.mock('../../../api/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn() },
}));

test('reads the action items with the viewer time zone and returns the items', async () => {
  apiClient.get.mockResolvedValue({ data: { items: [{ id: 'a' }], counts: {} } });
  const { result } = renderHook(() => useActionItems());
  await waitFor(() => expect(result.current.loading).toBe(false));
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  expect(apiClient.get).toHaveBeenCalledWith(`/api/user/action-items?tz=${encodeURIComponent(tz)}`);
  expect(result.current.items).toEqual([{ id: 'a' }]);
  expect(typeof result.current.reload).toBe('function');
  expect(typeof result.current.fetchedAt).toBe('number');
});
