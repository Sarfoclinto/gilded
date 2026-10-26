using GoldValuation.Application.Abstractions;

namespace GoldValuation.Application.Review;

/// <summary>Persistence for the review screens (database functions of migration 0018). Results are contract-shaped JSON text.</summary>
public interface IReviewStore
{
    Task<string> ListCasesAsync(ICurrentContext me, string? status, Guid? branchId, int limit, CancellationToken ct);
    Task<string> GetCaseAsync(ICurrentContext me, Guid id, CancellationToken ct);
    Task<string> ActOnCaseAsync(ICurrentContext me, Guid id, string payloadJson, CancellationToken ct);
    Task<string> TimelineAsync(ICurrentContext me, Guid branchId, DateTimeOffset? from, DateTimeOffset? to, string? asset, long? before, int limit, CancellationToken ct);
    Task<string> PositionAsync(ICurrentContext me, CancellationToken ct);
}
