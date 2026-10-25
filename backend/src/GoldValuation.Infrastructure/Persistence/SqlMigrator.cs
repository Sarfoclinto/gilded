using System.Security.Cryptography;
using System.Text;
using Microsoft.Extensions.Logging;
using Npgsql;

namespace GoldValuation.Infrastructure.Persistence;

/// <summary>
/// Applies db/migrations/*.sql in name order, once each, each in its own transaction, under a database-wide lock so two
/// instances starting together cannot collide. A script that was already applied must not change afterwards: its checksum
/// is checked, because editing an applied migration means every database drifts differently. Add a new file instead.
/// Run with the OWNER login (gold_migrator), never the application login.
/// </summary>
public sealed class SqlMigrator(NpgsqlDataSource dataSource, ILogger<SqlMigrator> log)
{
    private const long LockKey = 727_001;

    public async Task<IReadOnlyList<string>> MigrateAsync(CancellationToken ct = default)
    {
        var scripts = LoadScripts();
        await using var conn = await dataSource.OpenConnectionAsync(ct);
        await Run(conn, $"select pg_advisory_lock({LockKey})", ct);
        try
        {
            await Run(conn, """
                create schema if not exists gold;
                create table if not exists gold.schema_migrations (
                    version    text primary key,
                    checksum   text not null,
                    applied_at timestamptz not null default now());
                """, ct);

            var applied = new Dictionary<string, string>();
            await using (var read = new NpgsqlCommand("select version, checksum from gold.schema_migrations", conn))
            await using (var reader = await read.ExecuteReaderAsync(ct))
            {
                while (await reader.ReadAsync(ct)) applied[reader.GetString(0)] = reader.GetString(1);
            }

            var ran = new List<string>();
            foreach (var (name, sql) in scripts)
            {
                var checksum = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(sql)));
                if (applied.TryGetValue(name, out var existing))
                {
                    if (existing != checksum)
                        throw new InvalidOperationException($"Migration {name} was changed after it was applied. Revert it and add a new migration instead.");
                    continue;
                }

                log.LogInformation("Applying migration {Migration}", name);
                await using var tx = await conn.BeginTransactionAsync(ct);
                await using (var cmd = new NpgsqlCommand(sql, conn, tx)) await cmd.ExecuteNonQueryAsync(ct);
                await using (var journal = new NpgsqlCommand("insert into gold.schema_migrations (version, checksum) values ($1, $2)", conn, tx)
                {
                    Parameters = { new NpgsqlParameter { Value = name }, new NpgsqlParameter { Value = checksum } },
                })
                {
                    await journal.ExecuteNonQueryAsync(ct);
                }
                await tx.CommitAsync(ct);
                ran.Add(name);
            }
            return ran;
        }
        finally
        {
            await Run(conn, $"select pg_advisory_unlock({LockKey})", CancellationToken.None);
        }
    }

    /// <summary>
    /// For a database whose migrations were applied by hand (pgAdmin): records every script up to and including <paramref name="upToInclusive"/>
    /// as already applied, without running it, so <see cref="MigrateAsync"/> continues from the next one. Refuses to run if the journal
    /// already has entries, and checks that the scripts exist, because a wrong baseline would hide migrations that never ran.
    /// </summary>
    public async Task<IReadOnlyList<string>> BaselineAsync(string upToInclusive, CancellationToken ct = default)
    {
        var scripts = LoadScripts();
        var last = scripts.FindIndex(s => s.Name.Equals(upToInclusive, StringComparison.OrdinalIgnoreCase));
        if (last < 0)
            throw new InvalidOperationException($"No migration named {upToInclusive}. Known: {string.Join(", ", scripts.Select(s => s.Name))}");

        await using var conn = await dataSource.OpenConnectionAsync(ct);
        await Run(conn, $"select pg_advisory_lock({LockKey})", ct);
        try
        {
            await Run(conn, """
                create schema if not exists gold;
                create table if not exists gold.schema_migrations (
                    version    text primary key,
                    checksum   text not null,
                    applied_at timestamptz not null default now());
                """, ct);

            await using (var count = new NpgsqlCommand("select count(*) from gold.schema_migrations", conn))
            {
                if ((long)(await count.ExecuteScalarAsync(ct) ?? 0L) > 0)
                    throw new InvalidOperationException("The migration journal already has entries; baseline is only for a database the runner has never touched.");
            }

            var recorded = new List<string>();
            await using var tx = await conn.BeginTransactionAsync(ct);
            foreach (var (name, sql) in scripts.Take(last + 1))
            {
                var checksum = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(sql)));
                await using var cmd = new NpgsqlCommand("insert into gold.schema_migrations (version, checksum) values ($1, $2)", conn, tx)
                {
                    Parameters = { new NpgsqlParameter { Value = name }, new NpgsqlParameter { Value = checksum } },
                };
                await cmd.ExecuteNonQueryAsync(ct);
                recorded.Add(name);
            }
            await tx.CommitAsync(ct);
            return recorded;
        }
        finally
        {
            await Run(conn, $"select pg_advisory_unlock({LockKey})", CancellationToken.None);
        }
    }

    private static async Task Run(NpgsqlConnection conn, string sql, CancellationToken ct)
    {
        await using var cmd = new NpgsqlCommand(sql, conn);
        await cmd.ExecuteNonQueryAsync(ct);
    }

    private static List<(string Name, string Sql)> LoadScripts()
    {
        var assembly = typeof(SqlMigrator).Assembly;
        return assembly.GetManifestResourceNames()
            .Where(n => n.StartsWith("migrations.", StringComparison.Ordinal) && n.EndsWith(".sql", StringComparison.Ordinal))
            .OrderBy(n => n, StringComparer.Ordinal)
            .Select(n =>
            {
                using var stream = assembly.GetManifestResourceStream(n)!;
                using var reader = new StreamReader(stream, Encoding.UTF8);
                return (n["migrations.".Length..], reader.ReadToEnd());
            })
            .ToList();
    }
}
