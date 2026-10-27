using GoldValuation.Application.Abstractions;
using GoldValuation.Application.PriceFeed;
using GoldValuation.Infrastructure.Operations;
using GoldValuation.Infrastructure.Persistence;
using Microsoft.Extensions.Logging;
using Npgsql;
using NpgsqlTypes;

namespace GoldValuation.Infrastructure.PriceFeed;

/// <summary>Calls the database functions of migration 0023. The worker's calls name the company and the director the automatic price is recorded under.</summary>
public sealed class PostgresPriceFeedStore(NpgsqlDataSource dataSource, ILogger<PostgresPriceFeedStore> log) : IPriceFeedStore
{
    public async Task<string> GetAsync(ICurrentContext me, CancellationToken ct) =>
        (await Scalar(me.TenantId, me.UserId, "select gold.price_feed_json()", ct))!;

    public async Task<string> SaveAsync(ICurrentContext me, string settingsJson, CancellationToken ct) =>
        (await Scalar(me.TenantId, me.UserId, "select gold.set_price_feed_settings($1)", ct, Json(settingsJson)))!;

    public async Task<string> DecideAsync(ICurrentContext me, Guid eventId, bool accept, CancellationToken ct) =>
        (await Scalar(me.TenantId, me.UserId, "select gold.feed_decide($1, $2)", ct,
            new NpgsqlParameter { NpgsqlDbType = NpgsqlDbType.Uuid, Value = eventId }, new NpgsqlParameter { NpgsqlDbType = NpgsqlDbType.Boolean, Value = accept }))!;

    public async Task<IReadOnlyList<Guid>> EnabledCompaniesAsync(CancellationToken ct)
    {
        await using var cmd = dataSource.CreateCommand("select tenant_id from gold.price_feed_registry");
        await using var reader = await cmd.ExecuteReaderAsync(ct);
        var ids = new List<Guid>();
        while (await reader.ReadAsync(ct)) ids.Add(reader.GetGuid(0));
        return ids;
    }

    public Task<string?> StateAsync(Guid tenantId, CancellationToken ct) => Scalar(tenantId, null, "select gold.price_feed_state()", ct);

    public async Task<string> RecordAsync(Guid tenantId, Guid actor, string resultJson, CancellationToken ct) =>
        (await Scalar(tenantId, actor, "select gold.feed_record($1)", ct, Json(resultJson)))!;

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

    private static NpgsqlParameter Json(string json) => new() { NpgsqlDbType = NpgsqlDbType.Jsonb, Value = json };
}
