import { io } from 'socket.io-client';
import { getToken } from './apiClient';

export function createDraftSocket() {
  return io('/', { auth: { token: getToken() } });
}
