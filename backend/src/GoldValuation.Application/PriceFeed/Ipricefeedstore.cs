using GoldValuation.Application.Abstractions;

namespace GoldValuation.Application.PriceFeed;

/// <summary>Persistence for the automatic price (database functions of migration 0023).</summary>
public interface IPriceFeedStore
{
    Task<string> GetAsync(ICurrentContext me, CancellationToken ct);
    Task<string> SaveAsync(ICurrentContext me, string settingsJson, CancellationToken ct);
    Task<string> DecideAsync(ICurrentContext me, Guid eventId, bool accept, CancellationToken ct);
    /// <summary>The companies that have the feed switched on.</summary>
    Task<IReadOnlyList<Guid>> EnabledCompaniesAsync(CancellationToken ct);
    /// <summary>One company's feed state, read without a signed-in person (null when it has no settings).</summary>
    Task<string?> StateAsync(Guid tenantId, CancellationToken ct);
    /// <summary>Records what a look found, acting as the director the automatic price is recorded under.</summary>
    Task<string> RecordAsync(Guid tenantId, Guid actor, string resultJson, CancellationToken ct);
}

public interface IGoldbodClient
{
    /// <summary>The home page's HTML. Throws when GoldBod cannot be reached.</summary>
    Task<string> FetchPageAsync(CancellationToken ct);
}
