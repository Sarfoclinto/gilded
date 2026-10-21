import type { Role } from '@/features/auth/schemas';

export const KUMASI = '11111111-1111-4111-8111-111111111111';
export const TARKWA = '22222222-2222-4222-8222-222222222222';

export const branches = [
  { id: KUMASI, name: 'Kumasi', code: 'KSI', isMain: true },
  { id: TARKWA, name: 'Tarkwa', code: 'TKW', isMain: false },
];

const base = ['calculator.use', 'transactions.view', 'transactions.create'];

export const users: Array<{
  id: string;
  username: string;
  displayName: string;
  role: Role;
  permissions: string[];
  branchIds: string[];
}> = [
  {
    id: 'aaaaaaaa-0000-4000-8000-000000000001',
    username: 'director',
    displayName: 'Director',
    role: 'director',
    permissions: [...base, 'prices.approve', 'kumasi.setValue', 'reports.view', 'users.manage'],
    branchIds: [KUMASI, TARKWA],
  },
  {
    id: 'aaaaaaaa-0000-4000-8000-000000000002',
    username: 'manager',
    displayName: 'Manager',
    role: 'manager',
    permissions: [...base, 'kumasi.setValue', 'reports.view'],
    branchIds: [KUMASI, TARKWA],
  },
  {
    id: 'aaaaaaaa-0000-4000-8000-000000000003',
    username: 'teller',
    displayName: 'Teller (Tarkwa)',
    role: 'teller',
    permissions: base,
    branchIds: [TARKWA],
  },
];

export const prices: Record<string, { basePrice: string; margin: string; status: 'approved' | 'provisional' }> = {
  [KUMASI]: { basePrice: '11458', margin: '192', status: 'approved' },
  [TARKWA]: { basePrice: '11458', margin: '190', status: 'provisional' },
};
