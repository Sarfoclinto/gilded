using Xunit;

namespace GoldValuation.Infrastructure.Tests;

/// <summary>
/// A test that needs a real PostgreSQL. It runs only when GOLD_TEST_ADMIN_CONNECTION is set to a login that may create
/// databases, for example "Host=localhost;Username=postgres;Password=...". Otherwise it shows as skipped, not passed.
/// </summary>
public sealed class DatabaseFactAttribute : FactAttribute
{
    public const string Variable = "GOLD_TEST_ADMIN_CONNECTION";

    public DatabaseFactAttribute()
    {
        if (string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable(Variable)))
            Skip = $"Set {Variable} to run database tests.";
    }
}
