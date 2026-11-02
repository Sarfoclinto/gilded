using GoldValuation.Application.Abstractions;

namespace GoldValuation.Application.Guide;

/// <summary>Persistence for the Guide (database functions of migration 0046). Results are contract-shaped JSON text.</summary>
public interface IGuideStore
{
    Task<string> ReaderAsync(ICurrentContext me, CancellationToken ct);
    Task<string> ArticleAsync(ICurrentContext me, Guid id, bool includeDraft, CancellationToken ct);
    Task<string> MarkReadAsync(ICurrentContext me, Guid id, CancellationToken ct);
    Task<string> AdminAsync(ICurrentContext me, CancellationToken ct);
    Task<string> SaveCategoryAsync(ICurrentContext me, string json, CancellationToken ct);
    Task<string> DeleteCategoryAsync(ICurrentContext me, Guid id, CancellationToken ct);
    Task<string> SaveArticleAsync(ICurrentContext me, string json, CancellationToken ct);
    Task<string> PublishAsync(ICurrentContext me, Guid id, string json, CancellationToken ct);
    Task<string> UnpublishAsync(ICurrentContext me, Guid id, CancellationToken ct);
    Task<string> DeleteArticleAsync(ICurrentContext me, Guid id, CancellationToken ct);
    Task<string> ReadersAsync(ICurrentContext me, Guid id, CancellationToken ct);
    Task<string> SaveRemindersAsync(ICurrentContext me, string json, CancellationToken ct);
    /// <summary>The companies that have reminders switched on.</summary>
    Task<IReadOnlyList<Guid>> ReminderCompaniesAsync(CancellationToken ct);
    /// <summary>Sends one company's reminder if it is due. Safe to call every cycle. Returns how many people were reminded.</summary>
    Task<int> RunRemindersAsync(Guid tenantId, DateTimeOffset now, CancellationToken ct);
}