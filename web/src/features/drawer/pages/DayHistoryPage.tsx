import { Link } from 'react-router-dom';
import { Table, Tag } from 'antd';
import { lineTotal } from '@gold/core';
import paths from '@/config/paths';
import { PERMISSIONS } from '@/config/permissions';
import { useAuth } from '@/features/auth/store';
import { useHasPermission } from '@/features/auth/useHasPermission';
import { cedis } from '@/features/calculator/format';
import { errorMessage } from '@/shared/api/errors';
import { useApiMutation } from '@/shared/api/hooks';
import { Button } from '@/shared/ui/Button';
import { dayKeys, daysApi } from '../api';
import { dayFlagText, signed } from '../format';
import { useDayHistory } from '../hooks';
import type { Day } from '../schemas';

const signoffTag = (d: Day) => {
  const s = d.closing?.signoff.status;
  if (!d.closing) return <Tag color="blue">Open</Tag>;
  if (s === 'pending') return <Tag color="orange">Waiting for sign-off</Tag>;
  if (s === 'signed') return <Tag color="green">Signed by {d.closing.signoff.by?.displayName}</Tag>;
  return <Tag>Matched</Tag>;
};

export default function DayHistoryPage() {
  const branchId = useAuth((s) => s.activeBranchId);
  const history = useDayHistory(branchId);
  const canSign = useHasPermission(PERMISSIONS.DAYS_SIGNOFF);
  const sign = useApiMutation({
    mutationFn: (id: string) => daysApi.signOff(id),
    invalidates: [dayKeys.all],
    successMessage: 'Signed off',
  });

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4 pb-8">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-bold">Day history</h1>
        <Link to={paths.drawer.home.href} className="text-sm underline">
          Cash drawer
        </Link>
      </div>
      {history.error ? <p className="text-sm text-red-600">{errorMessage(history.error)}</p> : null}
      <Table<Day>
        size="middle"
        rowKey="id"
        loading={history.isLoading}
        dataSource={history.data ?? []}
        pagination={{ pageSize: 15, hideOnSinglePage: true }}
        scroll={{ x: 760 }}
        locale={{ emptyText: 'No days yet' }}
        columns={[
          {
            title: 'Date',
            dataIndex: 'businessDate',
            render: (v: string, d) => (
              <div>
                <div className="font-medium">{v}</div>
                {d.flags.map((f) => (
                  <Tag key={f} color="gold" className="mt-1">
                    {dayFlagText[f]}
                  </Tag>
                ))}
              </div>
            ),
          },
          { title: 'Opened by', render: (_: unknown, d) => d.openedBy.displayName },
          { title: 'Opening', align: 'right', render: (_: unknown, d) => cedis(lineTotal(d.opening.lines)) },
          { title: 'Expected', align: 'right', render: (_: unknown, d) => (d.closing ? cedis(lineTotal(d.closing.expected)) : '—') },
          { title: 'Counted', align: 'right', render: (_: unknown, d) => (d.closing ? cedis(lineTotal(d.closing.counted)) : '—') },
          {
            title: 'Difference',
            align: 'right',
            render: (_: unknown, d) => {
              if (!d.closing) return '—';
              const n = Number(d.closing.varianceAmount);
              return <span className={n < 0 ? 'text-red-600' : n > 0 ? 'text-amber-600' : ''} title={d.closing.reason ?? ''}>{n === 0 ? '0' : signed(n)}</span>;
            },
          },
          {
            title: 'Status',
            render: (_: unknown, d) => (
              <div className="space-y-1">
                {signoffTag(d)}
                {d.closing?.reason ? <div className="max-w-56 text-xs text-muted-foreground">“{d.closing.reason}”</div> : null}
              </div>
            ),
          },
          {
            title: '',
            render: (_: unknown, d) =>
              canSign && d.closing?.signoff.status === 'pending' ? (
                <Button variant="secondary" loading={sign.isPending && sign.variables === d.id} onClick={() => sign.mutate(d.id)}>
                  Sign off
                </Button>
              ) : null,
          },
        ]}
      />
    </div>
  );
}
