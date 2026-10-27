using GoldValuation.Application.Abstractions;

namespace GoldValuation.Application.Notifications;

/// <summary>A person's own notifications. Everyone signed in has an inbox, so there is no permission to check; the database only ever returns the caller's own.</summary>
public sealed class NotificationsService(INotificationsStore store)
{
    public Task<string> ListAsync(ICurrentContext me, int? limit, bool unreadOnly, CancellationToken ct) =>
        store.ListAsync(me, Math.Clamp(limit ?? 30, 1, 100), unreadOnly, ct);

    /// <summary>Mark the given notifications read, or all of the caller's when <paramref name="ids"/> is null.</summary>
    public Task<string> MarkReadAsync(ICurrentContext me, Guid[]? ids, CancellationToken ct)
    {
        if (ids is { Length: > 200 }) throw AppException.Invalid("Too many at once.");
        return store.MarkReadAsync(me, ids, ct);
    }
}
