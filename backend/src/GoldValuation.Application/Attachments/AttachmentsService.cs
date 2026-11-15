using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Nodes;
using GoldValuation.Application.Abstractions;
using GoldValuation.Application.Auth;

namespace GoldValuation.Application.Attachments;

/// <summary>A picture the person just sent: the facts (JSON from the app), the picture, and its small preview.</summary>
public sealed record Upload(JsonObject Meta, byte[] File, byte[]? Thumb);

/// <summary>A picture ready to send back: where to read it and how to describe it.</summary>
public sealed record Served(Stream Content, string ContentType, string Etag, string FileName);

/// <summary>
/// Pictures on transfers, closing days, held gold and people. No picture is ever required: this only stores, lists and serves them.
/// Taking one needs the permission for the thing it is attached to (the sending end acts with transfers:create, the receiving end with
/// transfers:receive); a profile picture is always your own. Seeing one follows the database: the branches of the transfer, or everyone for a profile.
/// </summary>
public sealed class AttachmentsService(IAttachmentsStore store, IBlobStore blobs, IClock clock)
{
    public const int MaxFileBytes = 8 * 1024 * 1024;
    public const int MaxThumbBytes = 512 * 1024;
    private static readonly string[] Types = ["transfer", "user", "day", "collateral", "transaction", "customer"];
    private static readonly string[] Slots = ["release", "receive", "other", "profile", "closing", "opening", "collateral", "goods", "id"];

    public async Task<(bool Replayed, string DataJson)> UploadAsync(ICurrentContext me, Upload u, CancellationToken ct)
    {
        var m = u.Meta;
        var type = (string?)m["entityType"];
        if (type is null || !Types.Contains(type)) throw AppException.Invalid("Pictures cannot be attached to that.");
        if (type == "transfer" && !me.Has(Permissions.TransfersCreate) && !me.Has(Permissions.TransfersReceive)) throw AppException.Forbidden();
        if (type == "day" && !me.Has(Permissions.DaysManage)) throw AppException.Forbidden();
        if (type == "collateral" && !me.Has(Permissions.DebtsManage)) throw AppException.Forbidden();
        if ((type is "transaction" or "customer") && !me.Has(Permissions.TransactionsCreate)) throw AppException.Forbidden();
        if (!Guid.TryParse((string?)m["id"], out var id)) throw AppException.Invalid("The picture needs an id.");
        if (!Guid.TryParse((string?)m["entityId"], out _)) throw AppException.Invalid("Say what the picture belongs to.");
        var slot = (string?)m["slot"] ?? (type == "user" ? "profile" : "other");
        if (!Slots.Contains(slot)) throw AppException.Invalid("That is not a place for a picture.");
        if (u.File.Length is 0 or > MaxFileBytes) throw AppException.Invalid("The picture is empty or too big.");
        if (!IsJpeg(u.File)) throw AppException.Invalid("Only photos (JPEG) can be attached.");
        if (u.Thumb is { Length: > MaxThumbBytes } || (u.Thumb is { } t && !IsJpeg(t))) throw AppException.Invalid("The small preview is not valid.");

        var year = clock.UtcNow.Year;
        var folder = $"{me.TenantId:N}/{year}";
        var key = $"{folder}/{id:N}.jpg";
        var thumbKey = u.Thumb is null ? null : $"{folder}/{id:N}.t.jpg";
        // Only the fields the database reads are passed on, and the storage facts are ours, never the caller's.
        var payload = new JsonObject
        {
            ["id"] = id.ToString(), ["entityType"] = type, ["entityId"] = (string?)m["entityId"], ["slot"] = slot,
            ["fileName"] = Clean((string?)m["fileName"], 120), ["contentType"] = "image/jpeg", ["size"] = u.File.Length,
            ["sha256"] = Convert.ToHexString(SHA256.HashData(u.File)).ToLowerInvariant(), ["storageKey"] = key, ["thumbKey"] = thumbKey,
            ["originalSha"] = Hex64((string?)m["originalSha"]), ["width"] = Int(m["width"]), ["height"] = Int(m["height"]), ["takenAt"] = (string?)m["takenAt"],
            ["source"] = ((string?)m["source"] is "camera" or "library" or "native") ? (string?)m["source"] : null, ["stamped"] = (bool?)m["stamped"] ?? false,
        };
        // The database decides first (who, which transfer, a used id); the bytes follow. Sending the same picture again just writes the same bytes.
        var r = await store.AddAsync(me, payload.ToJsonString(), ct);
        await blobs.WriteAsync(key, u.File, ct);
        if (u.Thumb is not null) await blobs.WriteAsync(thumbKey!, u.Thumb, ct);
        return (r.Replayed, r.DataJson);
    }

    public Task<string> ListAsync(ICurrentContext me, string entityType, Guid entityId, CancellationToken ct)
    {
        if (!Types.Contains(entityType)) throw AppException.Invalid("Pictures are not kept for that.");
        if (entityType == "transfer") me.Require(Permissions.TransfersRead);
        if (entityType == "day") me.Require(Permissions.DaysRead);
        if (entityType == "collateral") me.Require(Permissions.DebtsRead);
        if (entityType == "transaction") me.Require(Permissions.TransactionsRead);
        if (entityType == "customer") me.Require(Permissions.AttachmentsIds);   // IDs are personal data
        return store.ListAsync(me, entityType, entityId, me.Has(Permissions.AttachmentsIds), ct);
    }

    /// <summary>One page of the library. Only the filters the database knows are passed on; customer IDs appear only for people who may see them.</summary>
    public Task<string> LibraryAsync(ICurrentContext me, IReadOnlyDictionary<string, string?> q, CancellationToken ct)
    {
        me.Require(Permissions.AttachmentsLibrary);
        var f = new JsonObject();
        foreach (var k in new[] { "branchId", "type", "from", "to", "uploaderId", "q", "page", "size" })
            if (q.TryGetValue(k, out var v) && !string.IsNullOrWhiteSpace(v)) f[k] = v.Length > 80 ? v[..80] : v;
        return store.LibraryAsync(me, f.ToJsonString(), me.Has(Permissions.AttachmentsIds), ct);
    }

    /// <summary>What reviewers have not been sent: closed days, hand-overs and held gold with no picture.</summary>
    public Task<string> GapsAsync(ICurrentContext me, string? days, CancellationToken ct)
    {
        me.Require(Permissions.AttachmentsLibrary);
        var f = new JsonObject();
        if (int.TryParse(days, out var d)) f["days"] = d;
        return store.GapsAsync(me, f.ToJsonString(), ct);
    }

    public async Task<Served?> OpenAsync(ICurrentContext me, Guid id, bool thumb, CancellationToken ct)
    {
        var json = await store.FileAsync(me, id, me.Has(Permissions.AttachmentsIds), ct);
        return json is null ? null : Open(json, thumb);
    }

    /// <summary>The newest profile picture of a person, or null.</summary>
    public async Task<Served?> OpenProfileAsync(ICurrentContext me, Guid userId, bool thumb, CancellationToken ct)
    {
        var id = await store.ProfilePictureAsync(me, userId, ct);
        return id is null ? null : await OpenAsync(me, id.Value, thumb, ct);
    }

    public Task<string> RemoveAsync(ICurrentContext me, Guid id, string? reason, CancellationToken ct) =>
        store.RemoveAsync(me, id, Clean(reason, 300), me.Has(Permissions.AttachmentsRemove), me.Has(Permissions.AttachmentsIds), ct);

    private Served? Open(string json, bool thumb)
    {
        using var doc = JsonDocument.Parse(json);
        var root = doc.RootElement;
        var key = thumb && root.TryGetProperty("thumbKey", out var tk) && tk.ValueKind == JsonValueKind.String ? tk.GetString()! : root.GetProperty("storageKey").GetString()!;
        var stream = blobs.Open(key);
        return stream is null ? null : new Served(stream, "image/jpeg", root.GetProperty("sha256").GetString() + (thumb ? "-t" : ""), root.GetProperty("fileName").GetString() ?? "photo.jpg");
    }

    private static string? Hex64(string? s) => s is { Length: 64 } && s.All(Uri.IsHexDigit) ? s.ToLowerInvariant() : null;
    private static bool IsJpeg(byte[] b) => b.Length > 4 && b[0] == 0xFF && b[1] == 0xD8 && b[2] == 0xFF;
    private static int? Int(JsonNode? n) => n is JsonValue v && v.TryGetValue<int>(out var i) && i is > 0 and < 20000 ? i : null;
    private static string? Clean(string? s, int max) => string.IsNullOrWhiteSpace(s) ? null : (s.Trim().Length > max ? s.Trim()[..max] : s.Trim());
}