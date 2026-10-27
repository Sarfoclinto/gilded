using GoldValuation.Application.Abstractions;

namespace GoldValuation.Application.Notifications;

/// <summary>Persistence for the notification inbox (database functions of migration 0019). Results are contract-shaped JSON text.</summary>
public interface INotificationsStore
{
    Task<string> ListAsync(ICurrentContext me, int limit, bool unreadOnly, CancellationToken ct);
    Task<string> MarkReadAsync(ICurrentContext me, Guid[]? ids, CancellationToken ct);
}
