using GoldValuation.Application.Abstractions;
using GoldValuation.Application.Notifications;
using GoldValuation.Infrastructure.Operations;
using GoldValuation.Infrastructure.Persistence;
using Microsoft.Extensions.Logging;
using Npgsql;
using NpgsqlTypes;

namespace GoldValuation.Infrastructure.Notifications;

public sealed class PostgresNotificationsStore(NpgsqlDataSource dataSource, ILogger<PostgresNotificationsStore> log) : INotificationsStore
{
    public async Task<string> ListAsync(ICurrentContext me, int limit, bool unreadOnly, CancellationToken ct) =>
        (await Scalar(me, "select gold.notifications_json($1, $2)", ct,
            new NpgsqlParameter { NpgsqlDbType = NpgsqlDbType.Integer, Value = limit },
            new NpgsqlParameter { NpgsqlDbType = NpgsqlDbType.Boolean, Value = unreadOnly }))!;

    public async Task<string> MarkReadAsync(ICurrentContext me, Guid[]? ids, CancellationToken ct) =>
        (await Scalar(me, "select gold.notifications_mark_read($1)", ct,
            new NpgsqlParameter { NpgsqlDbType = NpgsqlDbType.Array | NpgsqlDbType.Uuid, Value = (object?)ids ?? DBNull.Value }))!;

    private async Task<string?> Scalar(ICurrentContext me, string sql, CancellationToken ct, params NpgsqlParameter[] args)
    {
        try
        {
            await using var session = await TenantSession.BeginAsync(dataSource, me.TenantId, me.UserId, ct);
            await using var cmd = new NpgsqlCommand(sql, session.Connection, session.Transaction);
            foreach (var a in args) cmd.Parameters.Add(a);
            var value = await cmd.ExecuteScalarAsync(ct);
            await session.CommitAsync(ct);
            return value is null or DBNull ? null : (string)value;
        }
        catch (PostgresException ex) when (PostgresOperationsStore.Translate(ex, log) is { } app)
        {
            throw app;
        }
    }
}
