using GoldValuation.Application.Abstractions;
using GoldValuation.Application.Workings;
using GoldValuation.Infrastructure.Operations;
using GoldValuation.Infrastructure.Persistence;
using Microsoft.Extensions.Logging;
using Npgsql;
using NpgsqlTypes;

namespace GoldValuation.Infrastructure.Workings;

/// <summary>Calls the database functions of migration 0067, one transaction per call, as the signed-in person.</summary>
public sealed class PostgresWorkingsStore(NpgsqlDataSource dataSource, ILogger<PostgresWorkingsStore> log) : IWorkingsStore
{
    public async Task<string> ListAsync(ICurrentContext me, string filtersJson, CancellationToken ct) => (await Scalar(me, "select gold.workings_list($1)", ct, Json(filtersJson)))!;
    public Task<string?> GetAsync(ICurrentContext me, Guid id, CancellationToken ct) => Scalar(me, "select gold.working_get($1)", ct, Uuid(id));
    public async Task<string> SaveAsync(ICurrentContext me, string payloadJson, CancellationToken ct) => (await Scalar(me, "select gold.working_save($1)", ct, Json(payloadJson)))!;
    public async Task<string> RenameAsync(ICurrentContext me, Guid id, string? name, CancellationToken ct) =>
        (await Scalar(me, "select gold.working_rename($1, $2)", ct, Uuid(id), new NpgsqlParameter { NpgsqlDbType = NpgsqlDbType.Text, Value = (object?)name ?? DBNull.Value }))!;
    public async Task<string> DeleteAsync(ICurrentContext me, Guid[] ids, CancellationToken ct) =>
        (await Scalar(me, "select gold.workings_delete($1)", ct, new NpgsqlParameter { NpgsqlDbType = NpgsqlDbType.Array | NpgsqlDbType.Uuid, Value = ids }))!;

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
    private static NpgsqlParameter Json(string json) => new() { NpgsqlDbType = NpgsqlDbType.Jsonb, Value = json };
}