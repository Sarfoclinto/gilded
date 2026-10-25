using GoldValuation.Application.Auth;
using Npgsql;

namespace GoldValuation.Infrastructure.Persistence;

public sealed record SeedRequest(
    string CompanySlug, string CompanyName, string AdminUsername, string AdminDisplayName, string AdminPassword,
    string MainBranchCode, string MainBranchName);

/// <summary>
/// Creates a company with its three standard roles, its main branch and its first director. Safe to run again:
/// whatever already exists is left alone (a password is only ever set when the user is created), and roles gain any
/// permission added in a newer release without losing what the company changed. Uses the owner login.
/// </summary>
public sealed class Seeder(NpgsqlDataSource ownerSource, IPasswordHasher hasher)
{
    public async Task<IReadOnlyList<string>> SeedAsync(SeedRequest r, CancellationToken ct = default)
    {
        var report = new List<string>();
        var slug = r.CompanySlug.Trim().ToLowerInvariant();
        if (slug.Length is < 2 or > 40 || !slug.All(c => char.IsAsciiLetterOrDigit(c) || c == '-'))
            throw new ArgumentException("The company short name must be 2 to 40 letters, digits or dashes.");
        if (r.AdminPassword.Length < 10)
            throw new ArgumentException("The first director's password must be at least 10 characters.");

        var tenantId = await FindTenant(slug, ct);
        var isNew = tenantId is null;
        tenantId ??= Guid.NewGuid();

        await using var s = await TenantSession.BeginAsync(ownerSource, tenantId.Value, null, ct);
        var c = s.Connection; var tx = s.Transaction;

        if (isNew)
        {
            await Run(c, tx, "insert into gold.tenants (id, slug, name) values ($1, $2, $3)", tenantId.Value, slug, r.CompanyName);
            report.Add($"Created company '{slug}'.");
        }
        else report.Add($"Company '{slug}' already exists; filling in what is missing.");

        foreach (var (key, (name, permissions)) in Permissions.DefaultRoles)
        {
            await Run(c, tx, "insert into gold.roles (tenant_id, key, name, is_system) values ($1, $2, $3, true) on conflict (tenant_id, key) do nothing",
                tenantId.Value, key, name);
            foreach (var permission in permissions)
                await Run(c, tx, """
                    insert into gold.role_permissions (tenant_id, role_id, permission)
                    select $1, id, $3 from gold.roles where tenant_id = $1 and key = $2
                    on conflict do nothing
                    """, tenantId.Value, key, permission);
        }
        report.Add("Standard roles are in place: director, manager, teller.");

        var f = GoldValuation.Domain.Calculation.CalcConfig.ExcelV1;
        await Run(c, tx, "insert into gold.formula_versions (tenant_id, key, params) values ($1, $2, $3::jsonb) on conflict (tenant_id, key) do nothing",
            tenantId.Value, f.FormulaVersion, System.Text.Json.JsonSerializer.Serialize(new Dictionary<string, string>
            {
                ["correctionRate"] = f.CorrectionRate.ToString(System.Globalization.CultureInfo.InvariantCulture),
                ["poundGrams"] = f.PoundGrams.ToString(System.Globalization.CultureInfo.InvariantCulture),
                ["priceReferenceKarat"] = f.PriceReferenceKarat.ToString(System.Globalization.CultureInfo.InvariantCulture),
                ["densityOffset"] = f.DensityOffset.ToString(System.Globalization.CultureInfo.InvariantCulture),
                ["densityScale"] = f.DensityScale.ToString(System.Globalization.CultureInfo.InvariantCulture),
            }));
        report.Add("Calculation settings (ExcelV1) are in place.");

        await Run(c, tx, """
            insert into gold.branches (tenant_id, code, name, is_main) values ($1, $2, $3, true)
            on conflict (tenant_id, code) do nothing
            """, tenantId.Value, r.MainBranchCode.Trim().ToUpperInvariant(), r.MainBranchName.Trim());

        var created = await Scalar(c, tx, """
            with new_user as (
              insert into gold.users (tenant_id, username, display_name, password_hash, role_id)
              select $1, $2::citext, $3, $4, id from gold.roles where tenant_id = $1 and key = 'director'
              on conflict (tenant_id, username) do nothing
              returning id)
            select count(*) from new_user
            """, tenantId.Value, r.AdminUsername.Trim(), r.AdminDisplayName.Trim(), hasher.Hash(r.AdminPassword));
        report.Add(Convert.ToInt32(created) == 1
            ? $"Created director '{r.AdminUsername.Trim()}'."
            : $"User '{r.AdminUsername.Trim()}' already exists; password left unchanged.");

        await Run(c, tx, """
            insert into gold.user_branches (tenant_id, user_id, branch_id, is_primary)
            select $1, u.id, b.id, b.is_main
            from gold.users u cross join gold.branches b
            where u.tenant_id = $1 and u.username = $2::citext and b.tenant_id = $1 and b.is_main
            on conflict do nothing
            """, tenantId.Value, r.AdminUsername.Trim());

        await s.CommitAsync(ct);
        return report;
    }

    private async Task<Guid?> FindTenant(string slug, CancellationToken ct)
    {
        await using var conn = await ownerSource.OpenConnectionAsync(ct);
        await using var tx = await conn.BeginTransactionAsync(ct);
        await Run(conn, tx, "select set_config('app.login_company', $1, true)", slug);
        var id = await Scalar(conn, tx, "select id from gold.tenants");
        return id is Guid g ? g : null;
    }

    private static async Task Run(NpgsqlConnection c, NpgsqlTransaction tx, string sql, params object[] values)
    {
        await using var cmd = Command(c, tx, sql, values);
        await cmd.ExecuteNonQueryAsync();
    }

    private static async Task<object?> Scalar(NpgsqlConnection c, NpgsqlTransaction tx, string sql, params object[] values)
    {
        await using var cmd = Command(c, tx, sql, values);
        return await cmd.ExecuteScalarAsync();
    }

    private static NpgsqlCommand Command(NpgsqlConnection c, NpgsqlTransaction tx, string sql, object[] values)
    {
        var cmd = new NpgsqlCommand(sql, c, tx);
        foreach (var v in values) cmd.Parameters.Add(new NpgsqlParameter { Value = v });
        return cmd;
    }
}
