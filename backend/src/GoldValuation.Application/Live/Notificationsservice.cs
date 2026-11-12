using System.Text.Json.Nodes;
using GoldValuation.Application.Abstractions;
using GoldValuation.Application.Auth;

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

    /// <summary>
    /// A computer reports that the branch hub found the drawer could not cover an entry it had saved while away from the hub.
    /// Body: { branchId, commandId, short: { "100": 7 }, capturedAt? }. Needs a permission to save drawer or purchase entries and a branch the caller works in.
    /// The entry itself is not touched; this only tells the branch's managers (once per entry).
    /// </summary>
    public Task<string> ReportHubShortAsync(ICurrentContext me, JsonObject body, CancellationToken ct)
    {
        if (!me.Has(Permissions.TransactionsCreate) && !me.Has(Permissions.DaysManage) && !me.Has(Permissions.NotesExchange)) throw AppException.Forbidden();
        if (!Guid.TryParse((string?)body["branchId"], out var branchId)) throw AppException.Invalid("branchId is needed.");
        me.RequireBranch(branchId);
        return store.ReportHubShortAsync(me, body.ToJsonString(), ct);
    }
}