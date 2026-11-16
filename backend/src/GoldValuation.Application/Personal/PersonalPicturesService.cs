using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Nodes;
using GoldValuation.Application.Abstractions;
using GoldValuation.Application.Attachments;
using GoldValuation.Application.Operations;

namespace GoldValuation.Application.Personal;

/// <summary>Persistence for personal pictures (database functions of migration 0064). Every call runs as the signed-in person; the database lets only the owner in.</summary>
public interface IPersonalPicturesStore
{
    Task<DbResult> AddAsync(ICurrentContext me, string payloadJson, CancellationToken ct);
    Task<string> ListAsync(ICurrentContext me, string filtersJson, CancellationToken ct);
    Task<string> SetCaptionAsync(ICurrentContext me, Guid id, string? caption, CancellationToken ct);
    /// <summary>Deletes the person's own pictures; returns the files to remove as JSON [{ storageKey, thumbKey }].</summary>
    Task<string> DeleteAsync(ICurrentContext me, Guid[] ids, CancellationToken ct);
    Task<string?> OpenAsync(ICurrentContext me, Guid id, CancellationToken ct);
    Task<string> ColleaguesAsync(ICurrentContext me, CancellationToken ct);
    Task<string> SharedListAsync(ICurrentContext me, string filtersJson, CancellationToken ct);
    Task<string> ShareAsync(ICurrentContext me, Guid[] ids, Guid to, CancellationToken ct);
    /// <summary>Stops sharing the person's own pictures with one colleague, or with everyone when <paramref name="to"/> is null.</summary>
    Task<string> UnshareAsync(ICurrentContext me, Guid[] ids, Guid? to, CancellationToken ct);
    Task<string> HideSharedAsync(ICurrentContext me, Guid[] ids, CancellationToken ct);
    Task<IReadOnlyList<Guid>> PurgeCompaniesAsync(CancellationToken ct);
    Task<string> PurgeAsync(Guid tenantId, CancellationToken ct);
}

/// <summary>
/// "My pictures": a private camera. Anyone signed in may keep pictures for themselves; nobody else can see them (the database enforces this,
/// no permission opens them). Files live under tenant/p/owner/id.jpg, apart from the company's photos.
/// </summary>
public sealed class PersonalPicturesService(IPersonalPicturesStore store, IBlobStore blobs)
{
    public async Task<(bool Replayed, string DataJson)> AddAsync(ICurrentContext me, Upload u, CancellationToken ct)
    {
        var m = u.Meta;
        if (!Guid.TryParse((string?)m["id"], out var id)) throw AppException.Invalid("The picture needs an id.");
        if (u.File.Length is 0 or > AttachmentsService.MaxFileBytes) throw AppException.Invalid("The picture is empty or too big.");
        if (!IsJpeg(u.File)) throw AppException.Invalid("Only photos (JPEG) can be kept.");
        if (u.Thumb is { Length: > AttachmentsService.MaxThumbBytes } || (u.Thumb is { } t && !IsJpeg(t))) throw AppException.Invalid("The small preview is not valid.");
        var folder = $"{me.TenantId:N}/p/{me.UserId:N}";
        var key = $"{folder}/{id:N}.jpg";
        var thumbKey = u.Thumb is null ? null : $"{folder}/{id:N}.t.jpg";
        var payload = new JsonObject
        {
            ["id"] = id.ToString(), ["fileName"] = Clean((string?)m["fileName"], 120), ["size"] = u.File.Length,
            ["sha256"] = Convert.ToHexString(SHA256.HashData(u.File)).ToLowerInvariant(), ["storageKey"] = key, ["thumbKey"] = thumbKey,
            ["width"] = Int(m["width"]), ["height"] = Int(m["height"]), ["takenAt"] = (string?)m["takenAt"],
        };
        // The database decides first (switched off, over the limit, someone else's id); the bytes follow.
        var r = await store.AddAsync(me, payload.ToJsonString(), ct);
        await blobs.WriteAsync(key, u.File, ct);
        if (u.Thumb is not null) await blobs.WriteAsync(thumbKey!, u.Thumb, ct);
        return (r.Replayed, r.DataJson);
    }

    public Task<string> ListAsync(ICurrentContext me, IReadOnlyDictionary<string, string?> q, CancellationToken ct)
    {
        var f = new JsonObject();
        foreach (var k in new[] { "q", "page", "size" })
            if (q.TryGetValue(k, out var v) && !string.IsNullOrWhiteSpace(v)) f[k] = v.Length > 80 ? v[..80] : v;
        return store.ListAsync(me, f.ToJsonString(), ct);
    }

    public Task<string> SetCaptionAsync(ICurrentContext me, Guid id, string? caption, CancellationToken ct) => store.SetCaptionAsync(me, id, Clean(caption, 200), ct);

    public async Task<int> DeleteAsync(ICurrentContext me, Guid[] ids, CancellationToken ct)
    {
        if (ids.Length is 0 or > 200) throw AppException.Invalid("Choose between 1 and 200 pictures.");
        var removed = await store.DeleteAsync(me, ids, ct);
        return RemoveFiles(removed);
    }

    public async Task<Served?> OpenAsync(ICurrentContext me, Guid id, bool thumb, CancellationToken ct)
    {
        var json = await store.OpenAsync(me, id, ct);
        if (json is null) return null;
        using var doc = JsonDocument.Parse(json);
        var root = doc.RootElement;
        var key = thumb && root.TryGetProperty("thumbKey", out var tk) && tk.ValueKind == JsonValueKind.String ? tk.GetString()! : root.GetProperty("storageKey").GetString()!;
        var stream = blobs.Open(key);
        return stream is null ? null : new Served(stream, "image/jpeg", root.GetProperty("sha256").GetString() + (thumb ? "-t" : ""), root.GetProperty("fileName").GetString() ?? "picture.jpg");
    }

    public Task<string> ColleaguesAsync(ICurrentContext me, CancellationToken ct) => store.ColleaguesAsync(me, ct);

    public Task<string> SharedListAsync(ICurrentContext me, IReadOnlyDictionary<string, string?> q, CancellationToken ct)
    {
        var f = new JsonObject();
        foreach (var k in new[] { "page", "size" })
            if (q.TryGetValue(k, out var v) && !string.IsNullOrWhiteSpace(v)) f[k] = v.Length > 80 ? v[..80] : v;
        return store.SharedListAsync(me, f.ToJsonString(), ct);
    }

    public Task<string> ShareAsync(ICurrentContext me, Guid[] ids, Guid to, CancellationToken ct) =>
        ids.Length is 0 or > 100 ? throw AppException.Invalid("Choose between 1 and 100 pictures.") : store.ShareAsync(me, ids, to, ct);

    public Task<string> UnshareAsync(ICurrentContext me, Guid[] ids, Guid? to, CancellationToken ct) =>
        ids.Length is 0 or > 200 ? throw AppException.Invalid("Choose between 1 and 200 pictures.") : store.UnshareAsync(me, ids, to, ct);

    public Task<string> HideSharedAsync(ICurrentContext me, Guid[] ids, CancellationToken ct) =>
        ids.Length is 0 or > 200 ? throw AppException.Invalid("Choose between 1 and 200 pictures.") : store.HideSharedAsync(me, ids, ct);

    /// <summary>For the worker: companies to look at, and the clean-up of one (people who left more than the set days ago).</summary>
    public Task<IReadOnlyList<Guid>> PurgeCompaniesAsync(CancellationToken ct) => store.PurgeCompaniesAsync(ct);
    public async Task<int> PurgeAsync(Guid tenantId, CancellationToken ct) => RemoveFiles(await store.PurgeAsync(tenantId, ct));

    // The rows are already gone; a file that cannot be removed now is only left behind, never shown.
    private int RemoveFiles(string json)
    {
        using var doc = JsonDocument.Parse(json);
        var n = 0;
        foreach (var e in doc.RootElement.EnumerateArray())
        {
            foreach (var name in new[] { "storageKey", "thumbKey" })
            {
                if (e.TryGetProperty(name, out var k) && k.ValueKind == JsonValueKind.String)
                {
                    try { blobs.Delete(k.GetString()!); } catch (Exception) { /* left for a later clean-up */ }
                }
            }
            n++;
        }
        return n;
    }

    private static bool IsJpeg(byte[] b) => b.Length > 4 && b[0] == 0xFF && b[1] == 0xD8 && b[2] == 0xFF;
    private static int? Int(JsonNode? n) => n is JsonValue v && v.TryGetValue<int>(out var i) && i is > 0 and < 20000 ? i : null;
    private static string? Clean(string? s, int max) => string.IsNullOrWhiteSpace(s) ? null : (s.Trim().Length > max ? s.Trim()[..max] : s.Trim());
}