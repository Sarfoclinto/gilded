using System.Text.Json;
using GoldValuation.Application.Abstractions;
using GoldValuation.Application.Operations;
using GoldValuation.Application.Transfers;
using GoldValuation.Infrastructure.Operations;
using GoldValuation.Infrastructure.Persistence;
using Microsoft.Extensions.Logging;
using Npgsql;
using NpgsqlTypes;

namespace GoldValuation.Infrastructure.Transfers;

/// <summary>Calls the database functions of migration 0015. One transaction per call; the caller's branch ids go with every call so the database checks scope itself.</summary>
public sealed class PostgresTransfersStore(NpgsqlDataSource dataSource, ILogger<PostgresTransfersStore> log) : ITransfersStore
{
    public async Task<string> ListAsync(ICurrentContext me, Guid branchId, string? status, string direction, CancellationToken ct) =>
        (await Scalar(me, "select gold.transfers_json($1, $2, $3)", ct, Uuid(branchId), Text(status), Text(direction)))!;

    public async Task<string> TransferableItemsAsync(ICurrentContext me, Guid branchId, CancellationToken ct) =>
        (await Scalar(me, "select gold.transferable_items_json($1)", ct, Uuid(branchId)))!;

    public async Task<string> StaffAsync(ICurrentContext me, CancellationToken ct) => (await Scalar(me, "select gold.staff_json()", ct))!;

    public Task<string?> GetAsync(ICurrentContext me, Guid id, CancellationToken ct) =>
        Scalar(me, "select gold.transfer_json($1)", ct, Uuid(id));

    public async Task<DbResult> CreateAsync(ICurrentContext me, string payloadJson, CancellationToken ct) =>
        Result(await Scalar(me, "select gold.create_transfer($1, $2)", ct, Json(payloadJson), Scope(me)));

    public async Task<string> EditAsync(ICurrentContext me, Guid id, string payloadJson, CancellationToken ct) =>
        (await Scalar(me, "select gold.transfer_edit($1, $2, $3)", ct, Uuid(id), Json(payloadJson), Scope(me)))!;

    public async Task<string> ReleaseAsync(ICurrentContext me, Guid id, string payloadJson, CancellationToken ct) =>
        (await Scalar(me, "select gold.release_transfer($1, $2, $3)", ct, Uuid(id), Json(payloadJson), Scope(me)))!;

    public async Task<string> RecordPaymentAsync(ICurrentContext me, Guid id, string payloadJson, CancellationToken ct) =>
        (await Scalar(me, "select gold.record_transfer_payment($1, $2, $3)", ct, Uuid(id), Json(payloadJson), Scope(me)))!;

    public async Task<string> ReceiveAsync(ICurrentContext me, Guid id, string payloadJson, CancellationToken ct) =>
        (await Scalar(me, "select gold.receive_transfer($1, $2, $3)", ct, Uuid(id), Json(payloadJson), Scope(me)))!;

    public async Task<string> CancelAsync(ICurrentContext me, Guid id, string reason, CancellationToken ct) =>
        (await Scalar(me, "select gold.cancel_transfer($1, $2, $3)", ct, Uuid(id), Text(reason), Scope(me)))!;

    public async Task<string> AddNoteAsync(ICurrentContext me, Guid id, string text, CancellationToken ct) =>
        (await Scalar(me, "select gold.transfer_note($1, $2, $3)", ct, Uuid(id), Text(text), Scope(me)))!;

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
    private static NpgsqlParameter Json(string json) => new() { NpgsqlDbType = NpgsqlDbType.Jsonb, Value = json };
    private static NpgsqlParameter Text(string? text) => new() { NpgsqlDbType = NpgsqlDbType.Text, Value = (object?)text ?? DBNull.Value };
    private static NpgsqlParameter Scope(ICurrentContext me) => new() { NpgsqlDbType = NpgsqlDbType.Array | NpgsqlDbType.Uuid, Value = me.BranchIds.ToArray() };

    private static DbResult Result(string? json)
    {
        using var doc = JsonDocument.Parse(json ?? throw new InvalidOperationException("The database returned nothing."));
        return new DbResult(doc.RootElement.GetProperty("replayed").GetBoolean(), doc.RootElement.GetProperty("data").GetRawText());
    }
}
