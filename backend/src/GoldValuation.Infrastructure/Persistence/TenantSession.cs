using Npgsql;

namespace GoldValuation.Infrastructure.Persistence;

/// <summary>
/// One request's database work: a connection and a transaction that already carry the company and the user,
/// so row-level security filters everything to that company and triggers know who is acting.
/// Repositories receive the session and use <see cref="Connection"/> and <see cref="Transaction"/> for every command.
/// Commit once at the end of the use case; dispose without committing to roll back.
/// </summary>
public sealed class TenantSession : IAsyncDisposable
{
    private TenantSession(NpgsqlConnection connection, NpgsqlTransaction transaction)
    {
        Connection = connection;
        Transaction = transaction;
    }

    public NpgsqlConnection Connection { get; }
    public NpgsqlTransaction Transaction { get; }

    public static async Task<TenantSession> BeginAsync(NpgsqlDataSource dataSource, Guid tenantId, Guid? userId, CancellationToken ct = default)
    {
        var connection = await dataSource.OpenConnectionAsync(ct);
        try
        {
            var transaction = await connection.BeginTransactionAsync(ct);
            // set_config(..., true) lasts for this transaction only, so a pooled connection never carries a company into the next request.
            await using var cmd = new NpgsqlCommand(
                "select set_config('app.tenant_id', $1, true), set_config('app.user_id', $2, true)", connection, transaction)
            {
                Parameters =
                {
                    new NpgsqlParameter { Value = tenantId.ToString() },
                    new NpgsqlParameter { Value = userId?.ToString() ?? string.Empty },
                },
            };
            await cmd.ExecuteNonQueryAsync(ct);
            return new TenantSession(connection, transaction);
        }
        catch
        {
            await connection.DisposeAsync();
            throw;
        }
    }

    public Task CommitAsync(CancellationToken ct = default) => Transaction.CommitAsync(ct);

    public async ValueTask DisposeAsync()
    {
        await Transaction.DisposeAsync();
        await Connection.DisposeAsync();
    }
}
