using System.Net;
using GoldValuation.Application.Auth;
using GoldValuation.Infrastructure.Persistence;
using Npgsql;
using NpgsqlTypes;

namespace GoldValuation.Infrastructure.Auth;

/// <summary>
/// Sign-in queries. Everything runs inside a company-scoped transaction (row-level security), except finding the company itself,
/// which uses the one-row sign-in policy from migration 0010. Each method commits before it returns.
/// </summary>
public sealed class PostgresAuthStore(NpgsqlDataSource dataSource) : IAuthStore
{
    public async Task<Guid?> FindTenantAsync(string company, CancellationToken ct)
    {
        await using var conn = await dataSource.OpenConnectionAsync(ct);
        await using var tx = await conn.BeginTransactionAsync(ct);
        await using (var set = new NpgsqlCommand("select set_config('app.login_company', $1, true)", conn, tx)
        {
            Parameters = { new NpgsqlParameter { Value = company } },
        })
        {
            await set.ExecuteNonQueryAsync(ct);
        }
        await using var cmd = new NpgsqlCommand("select id from gold.tenants where is_active", conn, tx);
        var id = await cmd.ExecuteScalarAsync(ct);
        return id is Guid g ? g : null;
    }

    public Task<LoginUser?> FindLoginUserAsync(Guid tenantId, string username, CancellationToken ct) =>
        InTenant(tenantId, null, async (conn, tx) =>
        {
            await using var cmd = new NpgsqlCommand("""
                select u.id, u.username::text, u.display_name, u.password_hash, u.is_active, u.locked_until, r.key
                from gold.users u
                join gold.roles r on r.id = u.role_id and r.tenant_id = u.tenant_id
                where u.username = $1::citext
                """, conn, tx)
            {
                Parameters = { new NpgsqlParameter { Value = username } },
            };
            await using var reader = await cmd.ExecuteReaderAsync(ct);
            if (!await reader.ReadAsync(ct)) return null;
            return new LoginUser(
                reader.GetGuid(0), reader.GetString(1), reader.GetString(2), reader.GetString(3), reader.GetBoolean(4),
                reader.IsDBNull(5) ? null : reader.GetFieldValue<DateTimeOffset>(5), reader.GetString(6));
        }, ct);

    public Task RecordLoginFailureAsync(Guid tenantId, Guid userId, int maxFailures, DateTimeOffset lockUntil, CancellationToken ct) =>
        InTenant<object?>(tenantId, userId, async (conn, tx) =>
        {
            // Reaching the limit locks the account and restarts the count, so one more typo after the lock expires does not lock it again at once.
            await using var cmd = new NpgsqlCommand("""
                update gold.users set
                  locked_until = case when failed_login_count + 1 >= $2 then $3 else locked_until end,
                  failed_login_count = case when failed_login_count + 1 >= $2 then 0 else failed_login_count + 1 end
                where id = $1
                """, conn, tx)
            {
                Parameters =
                {
                    new NpgsqlParameter { Value = userId },
                    new NpgsqlParameter { Value = maxFailures },
                    new NpgsqlParameter { Value = lockUntil.ToUniversalTime() },
                },
            };
            await cmd.ExecuteNonQueryAsync(ct);
            return null;
        }, ct);

    public Task RecordLoginSuccessAsync(Guid tenantId, Guid userId, DateTimeOffset now, string? newPasswordHash, CancellationToken ct) =>
        InTenant<object?>(tenantId, userId, async (conn, tx) =>
        {
            await using var cmd = new NpgsqlCommand("""
                update gold.users set failed_login_count = 0, locked_until = null, last_login_at = $2,
                  password_hash = coalesce($3, password_hash)
                where id = $1
                """, conn, tx)
            {
                Parameters =
                {
                    new NpgsqlParameter { Value = userId },
                    new NpgsqlParameter { Value = now.ToUniversalTime() },
                    new NpgsqlParameter { NpgsqlDbType = NpgsqlDbType.Text, Value = (object?)newPasswordHash ?? DBNull.Value },
                },
            };
            await cmd.ExecuteNonQueryAsync(ct);
            return null;
        }, ct);

    public Task<SessionUser?> LoadSessionUserAsync(Guid tenantId, Guid userId, CancellationToken ct) =>
        InTenant(tenantId, userId, async (conn, tx) =>
        {
            string username, displayName, role;
            await using (var cmd = new NpgsqlCommand("""
                select u.username::text, u.display_name, r.key
                from gold.users u join gold.roles r on r.id = u.role_id and r.tenant_id = u.tenant_id
                where u.id = $1 and u.is_active
                """, conn, tx) { Parameters = { new NpgsqlParameter { Value = userId } } })
            await using (var reader = await cmd.ExecuteReaderAsync(ct))
            {
                if (!await reader.ReadAsync(ct)) return null;
                username = reader.GetString(0);
                displayName = reader.GetString(1);
                role = reader.GetString(2);
            }

            var permissions = new List<string>();
            await using (var cmd = new NpgsqlCommand("select p from gold.effective_permissions($1) p", conn, tx)
                { Parameters = { new NpgsqlParameter { Value = userId } } })
            await using (var reader = await cmd.ExecuteReaderAsync(ct))
            {
                while (await reader.ReadAsync(ct)) permissions.Add(reader.GetString(0));
            }

            var branches = new List<Guid>();
            await using (var cmd = new NpgsqlCommand("select b from gold.user_branch_ids($1) b", conn, tx)
                { Parameters = { new NpgsqlParameter { Value = userId } } })
            await using (var reader = await cmd.ExecuteReaderAsync(ct))
            {
                while (await reader.ReadAsync(ct)) branches.Add(reader.GetGuid(0));
            }

            return new SessionUser(userId, username, displayName, role, permissions, branches);
        }, ct);

    public Task<IReadOnlyList<BranchInfo>> ListBranchesAsync(Guid tenantId, Guid userId, CancellationToken ct) =>
        InTenant<IReadOnlyList<BranchInfo>>(tenantId, userId, async (conn, tx) =>
        {
            var list = new List<BranchInfo>();
            await using var cmd = new NpgsqlCommand("""
                select b.id, b.name, b.code, b.is_main
                from gold.user_branch_ids($1) ids join gold.branches b on b.id = ids
                order by b.is_main desc, b.name
                """, conn, tx) { Parameters = { new NpgsqlParameter { Value = userId } } };
            await using var reader = await cmd.ExecuteReaderAsync(ct);
            while (await reader.ReadAsync(ct))
                list.Add(new BranchInfo(reader.GetGuid(0), reader.GetString(1), reader.GetString(2), reader.GetBoolean(3)));
            return list;
        }, ct)!;

    public Task<IReadOnlyList<BranchInfo>> ListAllBranchesAsync(Guid tenantId, Guid userId, CancellationToken ct) =>
        InTenant<IReadOnlyList<BranchInfo>>(tenantId, userId, async (conn, tx) =>
        {
            var list = new List<BranchInfo>();
            await using var cmd = new NpgsqlCommand("select id, name, code, is_main from gold.branches where is_active order by is_main desc, name", conn, tx);
            await using var reader = await cmd.ExecuteReaderAsync(ct);
            while (await reader.ReadAsync(ct))
                list.Add(new BranchInfo(reader.GetGuid(0), reader.GetString(1), reader.GetString(2), reader.GetBoolean(3)));
            return list;
        }, ct)!;

    public Task StartRefreshFamilyAsync(Guid tenantId, Guid userId, byte[] tokenHash, DateTimeOffset expiresAt, ClientInfo client, CancellationToken ct) =>
        InTenant<object?>(tenantId, userId, async (conn, tx) =>
        {
            await using var cmd = new NpgsqlCommand("""
                insert into gold.refresh_tokens (tenant_id, user_id, family_id, token_hash, expires_at, user_agent, ip)
                values ($1, $2, gen_random_uuid(), $3, $4, $5, $6)
                """, conn, tx)
            {
                Parameters =
                {
                    new NpgsqlParameter { Value = tenantId },
                    new NpgsqlParameter { Value = userId },
                    new NpgsqlParameter { Value = tokenHash },
                    new NpgsqlParameter { Value = expiresAt.ToUniversalTime() },
                    Text(client.UserAgent),
                    Inet(client.Ip),
                },
            };
            await cmd.ExecuteNonQueryAsync(ct);
            return null;
        }, ct);

    public Task<RotationResult> RotateRefreshTokenAsync(Guid tenantId, byte[] oldHash, byte[] newHash, DateTimeOffset expiresAt, ClientInfo client, CancellationToken ct) =>
        InTenant(tenantId, null, async (conn, tx) =>
        {
            await using var cmd = new NpgsqlCommand(
                "select o_outcome, o_user_id, o_family_id from gold.rotate_refresh_token($1, $2, $3, $4, $5)", conn, tx)
            {
                Parameters =
                {
                    new NpgsqlParameter { Value = oldHash },
                    new NpgsqlParameter { Value = newHash },
                    new NpgsqlParameter { Value = expiresAt.ToUniversalTime() },
                    Text(client.UserAgent),
                    Inet(client.Ip),
                },
            };
            await using var reader = await cmd.ExecuteReaderAsync(ct);
            await reader.ReadAsync(ct);
            var outcome = reader.GetString(0) switch
            {
                "ok" => RefreshOutcome.Ok,
                "race" => RefreshOutcome.Race,
                "reused" => RefreshOutcome.Reused,
                "expired" => RefreshOutcome.Expired,
                "revoked" => RefreshOutcome.Revoked,
                _ => RefreshOutcome.Unknown,
            };
            return new RotationResult(
                outcome,
                reader.IsDBNull(1) ? null : reader.GetGuid(1),
                reader.IsDBNull(2) ? null : reader.GetGuid(2));
        }, ct)!;

    public Task RevokeRefreshFamilyAsync(Guid tenantId, byte[] tokenHash, CancellationToken ct) =>
        InTenant<object?>(tenantId, null, async (conn, tx) =>
        {
            await using var cmd = new NpgsqlCommand("select gold.revoke_refresh_family($1)", conn, tx)
                { Parameters = { new NpgsqlParameter { Value = tokenHash } } };
            await cmd.ExecuteNonQueryAsync(ct);
            return null;
        }, ct);

    public Task AuditAsync(Guid tenantId, Guid? actorUserId, string action, string entityType, string entityId, ClientInfo client, CancellationToken ct) =>
        InTenant<object?>(tenantId, actorUserId, async (conn, tx) =>
        {
            await using var cmd = new NpgsqlCommand("""
                insert into gold.audit_events (tenant_id, actor_user_id, action, entity_type, entity_id, trace_id, ip)
                values ($1, $2, $3, $4, $5, $6, $7)
                """, conn, tx)
            {
                Parameters =
                {
                    new NpgsqlParameter { Value = tenantId },
                    new NpgsqlParameter { NpgsqlDbType = NpgsqlDbType.Uuid, Value = (object?)actorUserId ?? DBNull.Value },
                    new NpgsqlParameter { Value = action },
                    new NpgsqlParameter { Value = entityType },
                    new NpgsqlParameter { Value = entityId },
                    Text(client.TraceId),
                    Inet(client.Ip),
                },
            };
            await cmd.ExecuteNonQueryAsync(ct);
            return null;
        }, ct);

    private async Task<T> InTenant<T>(Guid tenantId, Guid? userId, Func<NpgsqlConnection, NpgsqlTransaction, Task<T>> work, CancellationToken ct)
    {
        await using var session = await TenantSession.BeginAsync(dataSource, tenantId, userId, ct);
        var result = await work(session.Connection, session.Transaction);
        await session.CommitAsync(ct);
        return result;
    }

    private static NpgsqlParameter Text(string? value) =>
        new() { NpgsqlDbType = NpgsqlDbType.Text, Value = (object?)value ?? DBNull.Value };

    private static NpgsqlParameter Inet(IPAddress? ip) =>
        new() { NpgsqlDbType = NpgsqlDbType.Inet, Value = (object?)ip ?? DBNull.Value };
}