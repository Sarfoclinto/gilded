import { http } from '@/shared/api/client';
import { mockAdapter } from './adapter';

export function installMock() {
  http.defaults.adapter = mockAdapter;
  console.info('[mock] Using the in-browser mock API. Logins: director / manager / teller, password "gold".');
}
