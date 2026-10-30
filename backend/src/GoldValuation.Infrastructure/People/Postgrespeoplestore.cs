using System.Text.Json;
using GoldValuation.Application.Abstractions;
using GoldValuation.Application.Operations;
using GoldValuation.Application.People;
using GoldValuation.Infrastructure.Operations;
using GoldValuation.Infrastructure.Persistence;
using Microsoft.Extensions.Logging;
using Npgsql;
using NpgsqlTypes;

namespace GoldValuation.Infrastructure.People;

/// <summary>Calls the database functions of migration 0014. Same rules as the operations store: one transaction per call, refusals arrive as GVnnn errors.</summary>
public sealed class PostgresPeopleStore(NpgsqlDataSource dataSource, ILogger<PostgresPeopleStore> log) : IPeopleStore
{
    public async Task<string> ListUsersAsync(ICurrentContext me, CancellationToken ct) => (await Scalar(me, "select gold.users_admin_json()", ct))!;
    public async Task<DbResult> CreateRoleAsync(ICurrentContext me, string payloadJson, CancellationToken ct) =>
        Result(await Scalar(me, "select gold.create_role($1)", ct, Json(payloadJson)));

    public async Task<string> UpdateRoleAsync(ICurrentContext me, string key, string payloadJson, CancellationToken ct) =>
        (await Scalar(me, "select gold.update_role($1, $2)", ct, new NpgsqlParameter { NpgsqlDbType = NpgsqlDbType.Text, Value = key }, Json(payloadJson)))!;

    public async Task DeleteRoleAsync(ICurrentContext me, string key, CancellationToken ct) =>
        await Scalar(me, "select gold.delete_role($1)::text", ct, new NpgsqlParameter { NpgsqlDbType = NpgsqlDbType.Text, Value = key });

    public async Task<string> ListRolesAsync(ICurrentContext me, CancellationToken ct) => (await Scalar(me, "select gold.roles_json()", ct))!;

    public async Task<DbResult> CreateUserAsync(ICurrentContext me, string payloadJson, CancellationToken ct) =>
        Result(await Scalar(me, "select gold.create_user($1)", ct, Json(payloadJson)));

    public async Task<string> UpdateUserAsync(ICurrentContext me, Guid id, string payloadJson, CancellationToken ct) =>
        (await Scalar(me, "select gold.update_user($1, $2)", ct, Uuid(id), Json(payloadJson)))!;

    public async Task<string> ResetPasswordAsync(ICurrentContext me, Guid id, string passwordHash, CancellationToken ct) =>
        (await Scalar(me, "select gold.reset_user_password($1, $2)", ct, Uuid(id), Text(passwordHash)))!;

    public async Task<string> MySecurityAsync(ICurrentContext me, CancellationToken ct) => (await Scalar(me, "select gold.my_security_json()", ct))!;
    public async Task<string> MyPasswordHashAsync(ICurrentContext me, CancellationToken ct) => (await Scalar(me, "select gold.my_password_hash()", ct))!;
    public async Task ChangeMyPasswordAsync(ICurrentContext me, string passwordHash, CancellationToken ct) =>
        await Scalar(me, "select gold.change_my_password($1)", ct, Text(passwordHash));

    public async Task<string> ListCustomersAsync(ICurrentContext me, string filterJson, CancellationToken ct) =>
        (await Scalar(me, "select gold.customers_query_json($1)", ct, new NpgsqlParameter { NpgsqlDbType = NpgsqlDbType.Jsonb, Value = filterJson }))!;

    public async Task<string> GetCustomerAsync(ICurrentContext me, Guid id, CancellationToken ct) =>
        (await Scalar(me, "select gold.customer_detail_json($1)", ct, Uuid(id)))!;

    public async Task<DbResult> CreateCustomerAsync(ICurrentContext me, string payloadJson, CancellationToken ct) =>
        Result(await Scalar(me, "select gold.create_customer($1)", ct, Json(payloadJson)));

    public async Task<string> UpdateCustomerAsync(ICurrentContext me, Guid id, string payloadJson, CancellationToken ct) =>
        (await Scalar(me, "select gold.update_customer($1, $2)", ct, Uuid(id), Json(payloadJson)))!;

    public async Task<string> MergeCustomersAsync(ICurrentContext me, Guid keepId, Guid removeId, CancellationToken ct) =>
        (await Scalar(me, "select gold.merge_customers($1, $2)", ct, Uuid(keepId), Uuid(removeId)))!;

    public async Task<string> ListBranchesAsync(ICurrentContext me, CancellationToken ct) => (await Scalar(me, "select gold.branches_admin_json()", ct))!;

    public async Task<DbResult> CreateBranchAsync(ICurrentContext me, string payloadJson, CancellationToken ct) =>
        Result(await Scalar(me, "select gold.create_branch($1)", ct, Json(payloadJson)));

    public async Task<string> UpdateBranchAsync(ICurrentContext me, Guid id, string payloadJson, CancellationToken ct) =>
        (await Scalar(me, "select gold.update_branch($1, $2)", ct, Uuid(id), Json(payloadJson)))!;

    public async Task<string> BranchOverviewAsync(ICurrentContext me, Guid id, CancellationToken ct) =>
        (await Scalar(me, "select gold.branch_overview_json($1)", ct, Uuid(id)))!;

    public async Task<string> AuditSearchAsync(ICurrentContext me, IReadOnlyCollection<Guid>? scope, string filtersJson, CancellationToken ct) =>
        (await Scalar(me, "select gold.audit_search_json($1, $2)", ct,
            new NpgsqlParameter { NpgsqlDbType = NpgsqlDbType.Array | NpgsqlDbType.Uuid, Value = scope is null ? DBNull.Value : (object)scope.ToArray() },
            Json(filtersJson)))!;

    public async Task<string> CashOverviewAsync(ICurrentContext me, IReadOnlyCollection<Guid> scope, Guid? branchId, CancellationToken ct) =>
        (await Scalar(me, "select gold.branches_cash_json($1, $2)", ct,
            new NpgsqlParameter { NpgsqlDbType = NpgsqlDbType.Array | NpgsqlDbType.Uuid, Value = scope.ToArray() },
            new NpgsqlParameter { NpgsqlDbType = NpgsqlDbType.Uuid, Value = (object?)branchId ?? DBNull.Value }))!;

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
    private static NpgsqlParameter Text(string text) => new() { NpgsqlDbType = NpgsqlDbType.Text, Value = text };
    private static NpgsqlParameter Int(int n) => new() { NpgsqlDbType = NpgsqlDbType.Integer, Value = n };

    private static DbResult Result(string? json)
    {
        using var doc = JsonDocument.Parse(json ?? throw new InvalidOperationException("The database returned nothing."));
        return new DbResult(doc.RootElement.GetProperty("replayed").GetBoolean(), doc.RootElement.GetProperty("data").GetRawText());
    }
}