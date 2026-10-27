using System.Text.Json.Nodes;
using GoldValuation.Application.Abstractions;
using GoldValuation.Application.Auth;
using GoldValuation.Application.Operations;

namespace GoldValuation.Application.Review;

/// <summary>
/// What a manager looks at after the fact: the discrepancy inbox, one branch's timeline, and what the branches hold for each other.
/// Cases are worked with <see cref="Permissions.DiscrepanciesReview"/>; the timeline and the position need <see cref="Permissions.ReportsRead"/>.
/// The database applies the caller's branch scope to every case, so a case outside it simply is not found.
/// </summary>
public sealed class ReviewService(IReviewStore store)
{
    private static readonly string[] CaseStatuses = ["active", "all", "open", "under_review", "resolved", "written_off"];
    private static readonly string[] Actions = ["take", "note", "resolve", "reopen"];
    private static readonly string[] ResolutionTypes = ["explained", "found", "recovered", "corrected_entry", "written_off"];
    private static readonly string[] Assets = ["cash", "goods", "debt", "payable"];

    public Task<string> ListCasesAsync(ICurrentContext me, string? status, Guid? branchId, int? limit, CancellationToken ct)
    {
        me.Require(Permissions.DiscrepanciesReview);
        if (branchId is { } b) me.RequireBranch(b);
        if (status is not null && !CaseStatuses.Contains(status)) throw AppException.Invalid("Unknown status.");
        return store.ListCasesAsync(me, status ?? "active", branchId, Math.Clamp(limit ?? 100, 1, 300), ct);
    }

    public Task<string> GetCaseAsync(ICurrentContext me, Guid id, CancellationToken ct)
    {
        me.Require(Permissions.DiscrepanciesReview);
        return store.GetCaseAsync(me, id, ct);
    }

    public Task<string> ActOnCaseAsync(ICurrentContext me, Guid id, JsonObject body, CancellationToken ct)
    {
        me.Require(Permissions.DiscrepanciesReview);
        var action = (string?)body["action"];
        if (action is null || !Actions.Contains(action)) throw AppException.Invalid("action must be take, note, resolve or reopen.");
        if (action == "resolve" && ((string?)body["resolutionType"] is not { } t || !ResolutionTypes.Contains(t)))
            throw AppException.Invalid("Choose how the case was resolved.");
        var payload = new JsonObject { ["action"] = action };
        foreach (var key in new[] { "note", "resolutionType", "summary" })
            if (body[key] is JsonValue v && v.TryGetValue<string>(out var text)) payload[key] = text.Length > 2000 ? text[..2000] : text;
        return store.ActOnCaseAsync(me, id, payload.ToJsonString(), ct);
    }

    public Task<string> TimelineAsync(ICurrentContext me, Guid branchId, DateTimeOffset? from, DateTimeOffset? to, string? asset, long? before, int? limit, CancellationToken ct)
    {
        me.Require(Permissions.ReportsRead);
        me.RequireBranch(branchId);
        if (asset is not null && !Assets.Contains(asset)) throw AppException.Invalid("asset must be cash, goods, debt or payable.");
        if (from is { } f && to is { } t && t <= f) throw AppException.Invalid("The end of the range must be after its start.");
        return store.TimelineAsync(me, branchId, from, to, asset, before, Math.Clamp(limit ?? 100, 1, 300), ct);
    }

    /// <summary>Flat purchase rows for a spreadsheet (up to 5000, oldest first). Needs reports:read and the branch.</summary>
    public Task<string> ExportTransactionsAsync(ICurrentContext me, Guid branchId, DateTimeOffset? from, DateTimeOffset? to, CancellationToken ct)
    {
        me.Require(Permissions.ReportsRead);
        me.RequireBranch(branchId);
        if (from is { } f && to is { } t && t <= f) throw AppException.Invalid("The end of the range must be after its start.");
        return store.ExportTransactionsAsync(me, branchId, from, to, ct);
    }

    public Task<string> PositionAsync(ICurrentContext me, CancellationToken ct)
    {
        me.Require(Permissions.ReportsRead);
        return store.PositionAsync(me, ct);
    }
}
