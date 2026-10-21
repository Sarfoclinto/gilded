import { request, requestVoid } from '@/shared/api/client';
import { sessionSchema, userSchema, type LoginInput } from './schemas';

export const authApi = {
  login: (input: LoginInput) => request({ method: 'post', url: '/auth/login', data: input }, sessionSchema),
  refresh: () => request({ method: 'post', url: '/auth/refresh' }, sessionSchema),
  logout: () => requestVoid({ method: 'post', url: '/auth/logout' }),
  me: () => request({ method: 'get', url: '/me' }, userSchema),
};
