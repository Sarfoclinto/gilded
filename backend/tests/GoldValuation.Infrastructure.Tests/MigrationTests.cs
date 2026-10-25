using GoldValuation.Infrastructure.Persistence;
using Microsoft.Extensions.Logging.Abstractions;
using Npgsql;
using Xunit;

namespace GoldValuation.Infrastructure.Tests;

public class MigrationTests
{
    [DatabaseFact]
    public async Task Applies_every_migration_once_and_is_repeatable()
    {
        var admin = Environment.GetEnvironmentVariable(DatabaseFactAttribute.Variable)!;
        var dbName = "gold_it_" + Guid.NewGuid().ToString("N")[..8];

        await using (var adminDs = NpgsqlDataSource.Create(admin))
        {
            await Exec(adminDs, $"create database {dbName}");
        }

        try
        {
            var builder = new NpgsqlConnectionStringBuilder(admin) { Database = dbName };
            await using var ds = NpgsqlDataSource.Create(builder.ConnectionString);
            var migrator = new SqlMigrator(ds, NullLogger<SqlMigrator>.Instance);

            var first = await migrator.MigrateAsync();
            Assert.True(first.Count >= 8, "expected the 8 initial migrations");

            var second = await migrator.MigrateAsync();
            Assert.Empty(second);

            await using var cmd = ds.CreateCommand("select count(*) from information_schema.tables where table_schema = 'gold' and table_name in ('ledger_entries', 'transfers', 'discrepancies')");
            Assert.Equal(3L, await cmd.ExecuteScalarAsync());
        }
        finally
        {
            NpgsqlConnection.ClearAllPools();
            await using var adminDs = NpgsqlDataSource.Create(admin);
            await Exec(adminDs, $"drop database if exists {dbName} with (force)");
        }
    }

    private static async Task Exec(NpgsqlDataSource ds, string sql)
    {
        await using var cmd = ds.CreateCommand(sql);
        await cmd.ExecuteNonQueryAsync();
    }
}
