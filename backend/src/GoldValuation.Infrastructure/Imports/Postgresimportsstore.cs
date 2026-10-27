using GoldValuation.Application.Abstractions;
using GoldValuation.Application.Imports;
using GoldValuation.Application.Operations;
using GoldValuation.Domain.Calculation;
using GoldValuation.Infrastructure.Operations;
using GoldValuation.Infrastructure.Persistence;
using Microsoft.Extensions.Logging;
using Npgsql;
using NpgsqlTypes;

namespace GoldValuation.Infrastructure.Imports;

/// <summary>Calls the database functions of migration 0020. One transaction per call, so a chunk is imported whole or not at all.</summary>
public sealed class PostgresImportsStore(NpgsqlDataSource dataSource, IOperationsStore operations, ILogger<PostgresImportsStore> log) : IImportsStore
{
    public Task<CalcConfig> GetCalcConfigAsync(ICurrentContext me, string formulaVersion, CancellationToken ct) => operations.GetCalcConfigAsync(me, formulaVersion, ct);

    public async Task<string> ImportHistoryAsync(ICurrentContext me, string payloadJson, CancellationToken ct) =>
        (await Scalar(me, "select gold.import_history($1, $2)", ct, Json(payloadJson), Scope(me)))!;

    public async Task<string> ImportOpeningAsync(ICurrentContext me, string payloadJson, CancellationToken ct) =>
        (await Scalar(me, "select gold.import_opening($1, $2)", ct, Json(payloadJson), Scope(me)))!;

    public async Task<string> ImportCustomersAsync(ICurrentContext me, string payloadJson, CancellationToken ct) =>
        (await Scalar(me, "select gold.import_customers($1)", ct, Json(payloadJson)))!;

    public async Task<string> ListBatchesAsync(ICurrentContext me, CancellationToken ct) =>
        (await Scalar(me, "select gold.import_batches_json($1)", ct, Scope(me)))!;

    public async Task<string> UndoBatchAsync(ICurrentContext me, Guid batchId, string reason, CancellationToken ct) =>
        (await Scalar(me, "select gold.import_undo($1, $2, $3)", ct, new NpgsqlParameter { NpgsqlDbType = NpgsqlDbType.Uuid, Value = batchId },
            new NpgsqlParameter { NpgsqlDbType = NpgsqlDbType.Text, Value = reason }, Scope(me)))!;

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

    private static NpgsqlParameter Json(string json) => new() { NpgsqlDbType = NpgsqlDbType.Jsonb, Value = json };
    private static NpgsqlParameter Scope(ICurrentContext me) => new() { NpgsqlDbType = NpgsqlDbType.Array | NpgsqlDbType.Uuid, Value = me.BranchIds.ToArray() };
}
