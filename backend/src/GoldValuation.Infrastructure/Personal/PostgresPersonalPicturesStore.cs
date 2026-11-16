using System.Text.Json;
using GoldValuation.Application.Abstractions;
using GoldValuation.Application.Operations;
using GoldValuation.Application.Personal;
using GoldValuation.Infrastructure.Operations;
using GoldValuation.Infrastructure.Persistence;
using Microsoft.Extensions.Logging;
using Npgsql;
using NpgsqlTypes;

namespace GoldValuation.Infrastructure.Personal;

/// <summary>Calls the database functions of migration 0064, one transaction per call, as the signed-in person.</summary>
public sealed class PostgresPersonalPicturesStore(NpgsqlDataSource dataSource, ILogger<PostgresPersonalPicturesStore> log) : IPersonalPicturesStore
{
    public async Task<DbResult> AddAsync(ICurrentContext me, string payloadJson, CancellationToken ct)
    {
        var json = await Scalar(me.TenantId, me.UserId, "select gold.personal_add($1)", ct, Json(payloadJson));
        using var doc = JsonDocument.Parse(json ?? throw new InvalidOperationException("The database returned nothing."));
        return new DbResult(doc.RootElement.GetProperty("replayed").GetBoolean(), doc.RootElement.GetProperty("data").GetRawText());
    }

    public async Task<string> ListAsync(ICurrentContext me, string filtersJson, CancellationToken ct) =>
        (await Scalar(me.TenantId, me.UserId, "select gold.personal_list($1)", ct, Json(filtersJson)))!;

    public async Task<string> SetCaptionAsync(ICurrentContext me, Guid id, string? caption, CancellationToken ct) =>
        (await Scalar(me.TenantId, me.UserId, "select gold.personal_set_caption($1, $2)", ct, Uuid(id), new NpgsqlParameter { NpgsqlDbType = NpgsqlDbType.Text, Value = (object?)caption ?? DBNull.Value }))!;

    public async Task<string> DeleteAsync(ICurrentContext me, Guid[] ids, CancellationToken ct) =>
        (await Scalar(me.TenantId, me.UserId, "select gold.personal_delete($1)", ct, new NpgsqlParameter { NpgsqlDbType = NpgsqlDbType.Array | NpgsqlDbType.Uuid, Value = ids }))!;

    public Task<string?> OpenAsync(ICurrentContext me, Guid id, CancellationToken ct) => Scalar(me.TenantId, me.UserId, "select gold.personal_open($1)", ct, Uuid(id));

    public async Task<IReadOnlyList<Guid>> PurgeCompaniesAsync(CancellationToken ct)
    {
        await using var cmd = dataSource.CreateCommand("select tenant_id from gold.personal_purge_registry");
        await using var reader = await cmd.ExecuteReaderAsync(ct);
        var ids = new List<Guid>();
        while (await reader.ReadAsync(ct)) ids.Add(reader.GetGuid(0));
        return ids;
    }

    public async Task<string> PurgeAsync(Guid tenantId, CancellationToken ct) => (await Scalar(tenantId, null, "select gold.personal_pictures_purge()", ct))!;

    private async Task<string?> Scalar(Guid tenantId, Guid? userId, string sql, CancellationToken ct, params NpgsqlParameter[] args)
    {
        try
        {
            await using var session = await TenantSession.BeginAsync(dataSource, tenantId, userId, ct);
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