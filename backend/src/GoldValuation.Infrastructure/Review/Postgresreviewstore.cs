using GoldValuation.Application.Abstractions;
using GoldValuation.Application.Review;
using GoldValuation.Infrastructure.Operations;
using GoldValuation.Infrastructure.Persistence;
using Microsoft.Extensions.Logging;
using Npgsql;
using NpgsqlTypes;

namespace GoldValuation.Infrastructure.Review;

/// <summary>Calls the database functions of migration 0018. One transaction per call; the caller's branch ids go with every call.</summary>
public sealed class PostgresReviewStore(NpgsqlDataSource dataSource, ILogger<PostgresReviewStore> log) : IReviewStore
{
    public async Task<string> ListCasesAsync(ICurrentContext me, string? status, Guid? branchId, int limit, CancellationToken ct) =>
        (await Scalar(me, "select gold.discrepancies_json($1, $2, $3, $4)", ct, Scope(me), Text(status), NullableUuid(branchId), Int(limit)))!;

    public async Task<string> GetCaseAsync(ICurrentContext me, Guid id, CancellationToken ct) =>
        (await Scalar(me, "select gold.discrepancy_json($1, $2)", ct, Uuid(id), Scope(me)))!;

    public async Task<string> ActOnCaseAsync(ICurrentContext me, Guid id, string payloadJson, CancellationToken ct) =>
        (await Scalar(me, "select gold.discrepancy_act($1, $2, $3)", ct, Uuid(id), Json(payloadJson), Scope(me)))!;

    public async Task<string> TimelineAsync(ICurrentContext me, Guid branchId, DateTimeOffset? from, DateTimeOffset? to, string? asset, long? before, int limit, CancellationToken ct) =>
        (await Scalar(me, "select gold.branch_timeline_json($1, $2, $3, $4, $5, $6)", ct, Uuid(branchId), Stamp(from), Stamp(to), Text(asset),
            new NpgsqlParameter { NpgsqlDbType = NpgsqlDbType.Bigint, Value = (object?)before ?? DBNull.Value }, Int(limit)))!;

    public async Task<string> ExportTransactionsAsync(ICurrentContext me, Guid branchId, DateTimeOffset? from, DateTimeOffset? to, CancellationToken ct) =>
        (await Scalar(me, "select gold.transactions_export_json($1, $2, $3, $4)", ct, Uuid(branchId), Stamp(from), Stamp(to), Int(5000)))!;

    public async Task<string> PositionAsync(ICurrentContext me, CancellationToken ct) =>
        (await Scalar(me, "select gold.interbranch_position_json($1)", ct, Scope(me)))!;

    // ------------------------------------------------------------------------------------------------
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

    private static NpgsqlParameter Uuid(Guid id) => new() { NpgsqlDbType = NpgsqlDbType.Uuid, Value = id };
    private static NpgsqlParameter NullableUuid(Guid? id) => new() { NpgsqlDbType = NpgsqlDbType.Uuid, Value = (object?)id ?? DBNull.Value };
    private static NpgsqlParameter Json(string json) => new() { NpgsqlDbType = NpgsqlDbType.Jsonb, Value = json };
    private static NpgsqlParameter Text(string? text) => new() { NpgsqlDbType = NpgsqlDbType.Text, Value = (object?)text ?? DBNull.Value };
    private static NpgsqlParameter Int(int n) => new() { NpgsqlDbType = NpgsqlDbType.Integer, Value = n };
    private static NpgsqlParameter Stamp(DateTimeOffset? t) => new() { NpgsqlDbType = NpgsqlDbType.TimestampTz, Value = t is { } v ? v.UtcDateTime : DBNull.Value };
    private static NpgsqlParameter Scope(ICurrentContext me) => new() { NpgsqlDbType = NpgsqlDbType.Array | NpgsqlDbType.Uuid, Value = me.BranchIds.ToArray() };
}
