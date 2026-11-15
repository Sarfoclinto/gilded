using System.Text.Json;
using GoldValuation.Application.Abstractions;
using GoldValuation.Application.Attachments;
using GoldValuation.Application.Operations;
using GoldValuation.Infrastructure.Operations;
using GoldValuation.Infrastructure.Persistence;
using Microsoft.Extensions.Logging;
using Npgsql;
using NpgsqlTypes;

namespace GoldValuation.Infrastructure.Attachments;

/// <summary>Calls the database functions of migration 0060. One transaction per call; the caller's branch ids go with every call so the database checks scope itself.</summary>
public sealed class PostgresAttachmentsStore(NpgsqlDataSource dataSource, ILogger<PostgresAttachmentsStore> log) : IAttachmentsStore
{
    public async Task<DbResult> AddAsync(ICurrentContext me, string payloadJson, CancellationToken ct)
    {
        var json = await Scalar(me, "select gold.add_attachment($1, $2)", ct, Json(payloadJson), Scope(me));
        using var doc = JsonDocument.Parse(json ?? throw new InvalidOperationException("The database returned nothing."));
        return new DbResult(doc.RootElement.GetProperty("replayed").GetBoolean(), doc.RootElement.GetProperty("data").GetRawText());
    }

    public async Task<string> ListAsync(ICurrentContext me, string entityType, Guid entityId, CancellationToken ct) =>
        (await Scalar(me, "select gold.attachments_json($1, $2, $3)", ct, Text(entityType), Uuid(entityId), Scope(me)))!;

    public Task<string?> FileAsync(ICurrentContext me, Guid id, CancellationToken ct) =>
        Scalar(me, "select gold.attachment_file($1, $2)", ct, Uuid(id), Scope(me));

    public async Task<Guid?> ProfilePictureAsync(ICurrentContext me, Guid userId, CancellationToken ct)
    {
        try
        {
            await using var session = await TenantSession.BeginAsync(dataSource, me.TenantId, me.UserId, ct);
            await using var cmd = new NpgsqlCommand("select gold.profile_picture_id($1)", session.Connection, session.Transaction);
            cmd.Parameters.Add(Uuid(userId));
            var value = await cmd.ExecuteScalarAsync(ct);
            await session.CommitAsync(ct);
            return value is null or DBNull ? null : (Guid)value;
        }
        catch (PostgresException ex) when (PostgresOperationsStore.Translate(ex, log) is { } app)
        {
            throw app;
        }
    }

    public async Task<string> RemoveAsync(ICurrentContext me, Guid id, string? reason, bool canRemoveAny, CancellationToken ct) =>
        (await Scalar(me, "select gold.remove_attachment($1, $2, $3, $4)", ct, Uuid(id), Text(reason),
            new NpgsqlParameter { NpgsqlDbType = NpgsqlDbType.Boolean, Value = canRemoveAny }, Scope(me)))!;

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
    private static NpgsqlParameter Text(string? text) => new() { NpgsqlDbType = NpgsqlDbType.Text, Value = (object?)text ?? DBNull.Value };
    private static NpgsqlParameter Scope(ICurrentContext me) => new() { NpgsqlDbType = NpgsqlDbType.Array | NpgsqlDbType.Uuid, Value = me.BranchIds.ToArray() };
}