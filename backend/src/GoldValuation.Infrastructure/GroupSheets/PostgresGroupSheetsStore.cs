using GoldValuation.Application.Abstractions;
using GoldValuation.Application.GroupSheets;
using GoldValuation.Infrastructure.Operations;
using GoldValuation.Infrastructure.Persistence;
using Microsoft.Extensions.Logging;
using Npgsql;
using NpgsqlTypes;

namespace GoldValuation.Infrastructure.GroupSheets;

/// <summary>Calls <c>gold.group_sheets</c> (migration 0072), one transaction per call, as the signed-in person.</summary>
public sealed class PostgresGroupSheetsStore(NpgsqlDataSource dataSource, ILogger<PostgresGroupSheetsStore> log) : IGroupSheetsStore
{
    public async Task<string?> CallAsync(ICurrentContext me, string action, string payloadJson, CancellationToken ct)
    {
        try
        {
            await using var session = await TenantSession.BeginAsync(dataSource, me.TenantId, me.UserId, ct);
            await using var cmd = new NpgsqlCommand("select gold.group_sheets($1, $2)", session.Connection, session.Transaction);
            cmd.Parameters.Add(new NpgsqlParameter { NpgsqlDbType = NpgsqlDbType.Text, Value = action });
            cmd.Parameters.Add(new NpgsqlParameter { NpgsqlDbType = NpgsqlDbType.Jsonb, Value = payloadJson });
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