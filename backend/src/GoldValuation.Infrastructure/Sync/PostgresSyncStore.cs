using System.Text.Json.Nodes;
using GoldValuation.Application.Abstractions;
using GoldValuation.Application.Sync;
using GoldValuation.Infrastructure.Operations;
using GoldValuation.Infrastructure.Persistence;
using Microsoft.Extensions.Logging;
using Npgsql;
using NpgsqlTypes;

namespace GoldValuation.Infrastructure.Sync;

/// <summary>Calls the database functions of migration 0048. Each command runs in its own transaction, as the person who made it.</summary>
public sealed class PostgresSyncStore(NpgsqlDataSource dataSource, ILogger<PostgresSyncStore> log) : ISyncStore
{
    public async Task<string> RegisterDeviceAsync(ICurrentContext me, string json, CancellationToken ct) =>
        (await Run<string>(me.TenantId, me.UserId, "select gold.register_device_key($1)", ct, Json(json)))!;

    public Task<string?> DeviceKeyAsync(Guid tenantId, Guid userId, string deviceId, CancellationToken ct) =>
        Run<string>(tenantId, userId, "select gold.device_key($1, $2)", ct, Uuid(userId), Text(deviceId));

    public async Task<SyncAuthor?> AuthorAsync(Guid tenantId, Guid userId, CancellationToken ct)
    {
        var json = await Run<string>(tenantId, userId, "select gold.sync_author($1)", ct, Uuid(userId));
        if (json is null) return null;
        var node = JsonNode.Parse(json)!;
        var perms = (node["permissions"] as JsonArray)?.Select(p => p!.GetValue<string>()).ToHashSet() ?? [];
        return new SyncAuthor(node["active"]?.GetValue<bool>() ?? false, perms);
    }

    public async Task<string> ApplyAsync(Guid tenantId, Guid userId, string json, CancellationToken ct) =>
        (await Run<string>(tenantId, userId, "select gold.sync_apply($1)", ct, Json(json)))!;

    public async Task<string> ReviewAsync(ICurrentContext me, CancellationToken ct) =>
        (await Run<string>(me.TenantId, me.UserId, "select gold.sync_review_json()", ct))!;

    public async Task<string> ResolveAsync(ICurrentContext me, string json, CancellationToken ct) =>
        (await Run<string>(me.TenantId, me.UserId, "select gold.sync_resolve($1)", ct, Json(json)))!;

    private async Task<T?> Run<T>(Guid tenantId, Guid userId, string sql, CancellationToken ct, params NpgsqlParameter[] args)
    {
        try
        {
            await using var session = await TenantSession.BeginAsync(dataSource, tenantId, userId, ct);
            await using var cmd = new NpgsqlCommand(sql, session.Connection, session.Transaction);
            foreach (var a in args) cmd.Parameters.Add(a);
            var value = await cmd.ExecuteScalarAsync(ct);
            await session.CommitAsync(ct);
            return value is null or DBNull ? default : (T)value;
        }
        catch (PostgresException ex) when (PostgresOperationsStore.Translate(ex, log) is { } app)
        {
            throw app;
        }
    }

    private static NpgsqlParameter Uuid(Guid id) => new() { NpgsqlDbType = NpgsqlDbType.Uuid, Value = id };
    private static NpgsqlParameter Text(string s) => new() { NpgsqlDbType = NpgsqlDbType.Text, Value = s };
    private static NpgsqlParameter Json(string json) => new() { NpgsqlDbType = NpgsqlDbType.Jsonb, Value = json };
}