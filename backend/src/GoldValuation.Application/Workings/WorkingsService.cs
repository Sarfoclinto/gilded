using System.Text.Json.Nodes;
using GoldValuation.Application.Abstractions;

namespace GoldValuation.Application.Workings;

/// <summary>Persistence for Workings (database functions of migration 0067). Every call runs as the signed-in person; the database lets only the owner in.</summary>
public interface IWorkingsStore
{
    Task<string> ListAsync(ICurrentContext me, string filtersJson, CancellationToken ct);
    Task<string?> GetAsync(ICurrentContext me, Guid id, CancellationToken ct);
    /// <summary>Saves a sheet; JSON { data, copy } where copy is a second sheet made when the versions clashed.</summary>
    Task<string> SaveAsync(ICurrentContext me, string payloadJson, CancellationToken ct);
    Task<string> RenameAsync(ICurrentContext me, Guid id, string? name, CancellationToken ct);
    Task<string> DeleteAsync(ICurrentContext me, Guid[] ids, CancellationToken ct);
}

/// <summary>
/// Workings: a person's own scratch sheets for rough calculations. Scratch only: nothing here touches the books. Private to the owner;
/// no permission is needed and none widens it. The sheet's contents are an opaque document the app understands; the server only sizes it.
/// </summary>
public sealed class WorkingsService(IWorkingsStore store)
{
    public const int MaxDocBytes = 2 * 1024 * 1024;

    public Task<string> ListAsync(ICurrentContext me, IReadOnlyDictionary<string, string?> q, CancellationToken ct)
    {
        var f = new JsonObject();
        if (q.TryGetValue("q", out var v) && !string.IsNullOrWhiteSpace(v)) f["q"] = v.Length > 80 ? v[..80] : v;
        return store.ListAsync(me, f.ToJsonString(), ct);
    }

    public async Task<string> GetAsync(ICurrentContext me, Guid id, CancellationToken ct) =>
        await store.GetAsync(me, id, ct) ?? throw AppException.NotFound("That sheet");

    public Task<string> SaveAsync(ICurrentContext me, Guid id, JsonObject body, CancellationToken ct)
    {
        if (body["doc"] is not JsonObject doc || doc["notes"] is not JsonArray) throw AppException.Invalid("The sheet is not in a shape that can be saved.");
        var payload = new JsonObject { ["id"] = id.ToString(), ["name"] = Clean((string?)body["name"], 120), ["doc"] = doc.DeepClone(), ["baseVersion"] = Int(body["baseVersion"]) };
        var json = payload.ToJsonString();
        if (json.Length > MaxDocBytes) throw AppException.Invalid("This sheet is too big to save.");
        return store.SaveAsync(me, json, ct);
    }

    public Task<string> RenameAsync(ICurrentContext me, Guid id, string? name, CancellationToken ct) => store.RenameAsync(me, id, Clean(name, 120), ct);

    public Task<string> DeleteAsync(ICurrentContext me, Guid[] ids, CancellationToken ct) =>
        ids.Length is 0 or > 200 ? throw AppException.Invalid("Choose between 1 and 200 sheets.") : store.DeleteAsync(me, ids, ct);

    private static int? Int(JsonNode? n) => n is JsonValue v && v.TryGetValue<int>(out var i) && i > 0 ? i : null;
    private static string? Clean(string? s, int max) => string.IsNullOrWhiteSpace(s) ? null : (s.Trim().Length > max ? s.Trim()[..max] : s.Trim());
}