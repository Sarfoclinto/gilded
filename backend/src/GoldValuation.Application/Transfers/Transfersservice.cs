using System.Text.Json;
using System.Text.Json.Nodes;
using GoldValuation.Application.Abstractions;
using GoldValuation.Application.Auth;
using GoldValuation.Application.Operations;

namespace GoldValuation.Application.Transfers;

/// <summary>
/// Goods or cash moving between branches. The service checks who is asking and that the request is well formed; the rules (stock must be on
/// hand, one open transfer per piece, every line confirmed on receipt, discrepancies) live in the database functions so they hold for every caller.
/// The sending end acts with <see cref="Permissions.TransfersCreate"/>, the receiving end with <see cref="Permissions.TransfersReceive"/>.
/// </summary>
public sealed class TransfersService(ITransfersStore store)
{
    private static readonly string[] Statuses = ["draft", "released", "received", "received_with_discrepancy", "cancelled"];
    private static readonly string[] CreateFields = ["id", "kind", "originBranchId", "destinationBranchId", "purpose", "purposeNote", "method", "expectedArrivalAt", "itemIds", "collector"];
    private static readonly string[] EditFields = ["addItemIds", "removeLineIds", "collector", "purpose", "purposeNote", "method", "expectedArrivalAt"];
    private static readonly string[] ReleaseFields = ["note", "collectedAt", "lines", "scaledTop", "scaledDown"];
    private static readonly string[] PaymentFields = ["id", "branchId", "direction", "amount", "method", "purpose", "externalRef", "note", "lines"];
    private static readonly string[] ReceiveFields = ["note", "lines"];

    public Task<string> ListAsync(ICurrentContext me, Guid branchId, string? status, string? direction, CancellationToken ct)
    {
        me.Require(Permissions.TransfersRead);
        me.RequireBranch(branchId);
        if (status is not null && !Statuses.Contains(status)) throw AppException.Invalid("Unknown status.");
        direction ??= "all";
        if (direction is not ("all" or "outgoing" or "incoming")) throw AppException.Invalid("direction must be all, outgoing or incoming.");
        return store.ListAsync(me, branchId, status, direction, ct);
    }

    /// <summary>Gold at this branch that can still be put on a transfer.</summary>
    public Task<string> TransferableItemsAsync(ICurrentContext me, Guid branchId, CancellationToken ct)
    {
        me.Require(Permissions.TransfersCreate);
        me.RequireBranch(branchId);
        return store.TransferableItemsAsync(me, branchId, ct);
    }

    /// <summary>Active staff who can be named as the person carrying a transfer.</summary>
    public Task<string> StaffAsync(ICurrentContext me, CancellationToken ct)
    {
        me.Require(Permissions.TransfersCreate);
        return store.StaffAsync(me, ct);
    }

    public async Task<string> GetAsync(ICurrentContext me, Guid id, CancellationToken ct)
    {
        me.Require(Permissions.TransfersRead);
        var json = await store.GetAsync(me, id, ct);
        if (json is null) throw AppException.NotFound("Transfer");
        using var doc = JsonDocument.Parse(json);
        var o = doc.RootElement;
        var sees = Reads(o, "originBranchId", me) || Reads(o, "destinationBranchId", me);
        return sees ? json : throw AppException.NotFound("Transfer");
    }

    public Task<DbResult> CreateAsync(ICurrentContext me, JsonObject body, string? key, CancellationToken ct)
    {
        me.Require(Permissions.TransfersCreate);
        var id = ReadId(body, "id");
        KeyMatches(key, id);
        var origin = ReadId(body, "originBranchId");
        ReadId(body, "destinationBranchId");
        me.RequireBranch(origin);
        return store.CreateAsync(me, Pick(body, CreateFields), ct);
    }

    public Task<string> EditAsync(ICurrentContext me, Guid id, JsonObject body, CancellationToken ct)
    {
        me.Require(Permissions.TransfersCreate);
        return store.EditAsync(me, id, Pick(body, EditFields), ct);
    }

    public Task<string> ReleaseAsync(ICurrentContext me, Guid id, JsonObject body, CancellationToken ct)
    {
        me.Require(Permissions.TransfersCreate);
        return store.ReleaseAsync(me, id, Pick(body, ReleaseFields), ct);
    }

    /// <summary>Either end may record money that changed hands (paying the collector, or the collector paying on collection).</summary>
    public Task<string> RecordPaymentAsync(ICurrentContext me, Guid id, JsonObject body, CancellationToken ct)
    {
        if (!me.Has(Permissions.TransfersCreate) && !me.Has(Permissions.TransfersReceive)) throw AppException.Forbidden();
        ReadId(body, "branchId");
        if (body["amount"] is null) throw AppException.Invalid("Enter the amount.", new Dictionary<string, string[]> { ["amount"] = ["Enter the amount."] });
        return store.RecordPaymentAsync(me, id, Pick(body, PaymentFields), ct);
    }

    public Task<string> ReceiveAsync(ICurrentContext me, Guid id, JsonObject body, CancellationToken ct)
    {
        me.Require(Permissions.TransfersReceive);
        return store.ReceiveAsync(me, id, Pick(body, ReceiveFields), ct);
    }

    public Task<string> CancelAsync(ICurrentContext me, Guid id, string? reason, CancellationToken ct)
    {
        me.Require(Permissions.TransfersCreate);
        if (string.IsNullOrWhiteSpace(reason) || reason.Trim().Length < 5)
            throw AppException.Invalid("Write the reason (at least a few words).", new Dictionary<string, string[]> { ["reason"] = ["Write the reason."] });
        return store.CancelAsync(me, id, reason.Trim(), ct);
    }

    public Task<string> RecallAsync(ICurrentContext me, Guid id, string? reason, CancellationToken ct)
    {
        me.Require(Permissions.TransfersCreate);
        if (string.IsNullOrWhiteSpace(reason) || reason.Trim().Length < 5)
            throw AppException.Invalid("Write the reason (at least a few words).", new Dictionary<string, string[]> { ["reason"] = ["Write the reason."] });
        return store.RecallAsync(me, id, reason.Trim(), ct);
    }

    public Task<string> AddNoteAsync(ICurrentContext me, Guid id, string? text, CancellationToken ct)
    {
        me.Require(Permissions.TransfersRead);
        if (string.IsNullOrWhiteSpace(text)) throw AppException.Invalid("Write the note.", new Dictionary<string, string[]> { ["text"] = ["Write the note."] });
        return store.AddNoteAsync(me, id, text.Trim(), ct);
    }

    // ---------------------------------------------------------------- helpers
    private static bool Reads(JsonElement o, string name, ICurrentContext me) =>
        o.TryGetProperty(name, out var v) && v.TryGetGuid(out var g) && me.BranchIds.Contains(g);

    private static Guid ReadId(JsonObject body, string name)
    {
        if (body[name] is JsonValue v && v.TryGetValue<string>(out var s) && Guid.TryParse(s, out var g) && g != Guid.Empty) return g;
        throw AppException.Invalid($"{name} is needed.", new Dictionary<string, string[]> { [name] = ["Send a valid id."] });
    }

    /// <summary>Only the fields a caller may set go to the database; anything else is dropped.</summary>
    private static string Pick(JsonObject body, string[] allowed)
    {
        var o = new JsonObject();
        foreach (var name in allowed)
            if (body.TryGetPropertyValue(name, out var v)) o[name] = v?.DeepClone();
        return o.ToJsonString();
    }

    private static void KeyMatches(string? key, Guid id)
    {
        if (key is not null && !string.Equals(key.Trim(), id.ToString(), StringComparison.OrdinalIgnoreCase))
            throw AppException.Invalid("Idempotency-Key must equal the request's id.");
    }
}