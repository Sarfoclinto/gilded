import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { projectDrawer, type Pending } from '@/features/drawer/projection';
import type { DayState } from '@/features/drawer/schemas';
import { gate, takenMessage, usePeers } from './hubShare';
import { useHubState } from '@/shared/platform/platform';

const submit = vi.fn();
const setWindow = (hub: boolean) => {
  (globalThis as { window?: unknown }).window = hub ? { gilded: { hub: { share: { submit } } } } : undefined;
};
const connected = () => useHubState.setState({ hub: { role: 'member', member: { hubName: 'H', address: 'x', state: 'connected', lastOk: null }, selfId: 'me' } });
const cmd = { id: 'c1', type: 'transaction.create', payload: { branchId: 'b', payout: { lines: { '100': 2 } } } };

beforeEach(() => {
  submit.mockReset();
  usePeers.getState().reset();
  useHubState.setState({ hub: { role: 'off' } });
});
afterEach(() => setWindow(false));

describe('gate (reserving notes with the hub before saving)', () => {
  it('does nothing without a hub: the computer works alone as before', async () => {
    setWindow(true);
    expect(await gate(cmd, 'u', 't')).toEqual({ status: 'solo' });
    expect(submit).not.toHaveBeenCalled();
  });

  it('in a browser (no desktop app) it is always solo', async () => {
    setWindow(false);
    connected();
    expect(await gate(cmd, 'u', 't')).toEqual({ status: 'solo' });
  });

  it('a member that already knows the hub is away does not wait for it', async () => {
    setWindow(true);
    useHubState.setState({ hub: { role: 'member', member: { hubName: 'H', address: 'x', state: 'unreachable', lastOk: null } } });
    expect(await gate(cmd, 'u', 't')).toEqual({ status: 'solo' });
    expect(submit).not.toHaveBeenCalled();
  });

  it('asks the hub strictly and returns its number when the notes are reserved', async () => {
    setWindow(true);
    connected();
    submit.mockResolvedValue({ ok: true, data: { seq: 7, covered: true, short: {}, duplicate: false } });
    expect(await gate(cmd, 'u', 't')).toEqual({ status: 'shared', seq: 7 });
    expect(submit.mock.calls[0]![0]).toMatchObject({ command: cmd, userId: 'u', strict: true });
  });

  it('refuses when another computer took the notes, and says which', async () => {
    setWindow(true);
    connected();
    submit.mockResolvedValue({ ok: true, data: { seq: 0, covered: false, short: { '100': 1 }, duplicate: false, taken: true } });
    const g = await gate(cmd, 'u', 't');
    expect(g).toEqual({ status: 'taken', short: { '100': 1 } });
    expect(takenMessage({ '100': 1, '50': 2 })).toBe('Another computer just used some of those notes (short by 1 × GHS 100, 2 × GHS 50). Choose the notes again.');
  });

  it('an unreachable or failing hub never blocks a save', async () => {
    setWindow(true);
    connected();
    submit.mockResolvedValue({ ok: false, unreachable: true, message: 'x' });
    expect(await gate(cmd, 'u', 't')).toEqual({ status: 'solo' });
    submit.mockRejectedValue(new Error('ipc'));
    expect(await gate(cmd, 'u', 't')).toEqual({ status: 'solo' });
  });

  it('things that do not move notes are not sent to the hub', async () => {
    setWindow(true);
    connected();
    expect(await gate({ id: 'x', type: 'something.else', payload: {} }, 'u', 't')).toEqual({ status: 'solo' });
    expect(submit).not.toHaveBeenCalled();
  });
});

describe('peers', () => {
  it('keeps each command once and remembers the highest number seen', () => {
    const add = usePeers.getState().add;
    add([{ seq: 1, deviceId: 'a', command: { id: 'x', type: 't', payload: {} } }]);
    add([{ seq: 1, deviceId: 'a', command: { id: 'x', type: 't', payload: {} } }, { seq: 2, deviceId: 'b', command: { id: 'y', type: 't', payload: {} } }]);
    expect(usePeers.getState().entries.map((e) => e.command.id)).toEqual(['x', 'y']);
    expect(usePeers.getState().lastSeq).toBe(2);
  });

  it("a colleague's saved payout comes off this computer's drawer, so the same notes are not offered twice", () => {
    const state = { day: { id: 'd1', status: 'open', businessDate: '2026-11-05', opening: { lines: { '100': 5 } }, closing: null }, balance: { '100': 5 }, appliedIds: [], carryOver: null } as unknown as DayState;
    const mine: Pending = { id: 't1', type: 'transaction.create', payload: { branchId: 'b', payout: { lines: { '100': 2 } } } };
    const theirs: Pending = { id: 't2', type: 'transaction.create', payload: { branchId: 'b', payout: { lines: { '100': 2 } } } };
    expect(projectDrawer(state, [mine, theirs], 'b').balance).toEqual({ '100': 1 });
    // once the server has applied the colleague's command, it stops counting twice
    expect(projectDrawer({ ...state, balance: { '100': 3 }, appliedIds: ['t2'] }, [mine, theirs], 'b').balance).toEqual({ '100': 1 });
  });
});