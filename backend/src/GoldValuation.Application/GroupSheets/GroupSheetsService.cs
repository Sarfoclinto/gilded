using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Nodes;
using GoldValuation.Application.Abstractions;
using GoldValuation.Application.Attachments;

namespace GoldValuation.Application.GroupSheets;

/// <summary>Persistence for Group Sheets (migration 0072). Every call runs as the signed-in person; the database decides what they may see and do.</summary>
public interface IGroupSheetsStore
{
    /// <summary>Runs one action of <c>gold.group_sheets(action, payload)</c>; null when the action returned nothing.</summary>
    Task<string?> CallAsync(ICurrentContext me, string action, string payloadJson, CancellationToken ct);
}

/// <summary>
/// Group Sheets: private running records (kitchen fees, mercury sales…) for a chosen group. Only the group's members see them: no
/// company role or permission opens a group, and that rule lives in the database (row-level security), not here. This service only
/// checks the request's shape and size and passes it to the one database entry point.
/// </summary>
public sealed class GroupSheetsService(IGroupSheetsStore store, IBlobStore blobs)
{
    public const int MaxPayloadChars = 20_000;

    public static readonly IReadOnlySet<string> Actions = new HashSet<string>
    {
        "home", "group_get", "group_create", "group_rename", "member_set", "member_remove", "member_unexclude", "leave", "rule_set", "rule_remove",
        "name_keeper", "sheet_create", "sheet_update", "sheet_delete", "access_set", "sheet_get", "entry_add", "entry_take_back", "activity",
        "person_add", "person_rename", "alert_set", "photo_remove",
        // photo_add and photo_open are not here on purpose: only this service calls them, with storage keys it made itself
    };

    public async Task<string> CallAsync(ICurrentContext me, string action, JsonObject? payload, CancellationToken ct)
    {
        if (!Actions.Contains(action)) throw AppException.NotFound("That page");
        var json = (payload ?? new JsonObject()).ToJsonString();
        if (json.Length > MaxPayloadChars) throw AppException.Invalid("The request is too big.");
        return await store.CallAsync(me, action, json, ct) ?? throw AppException.NotFound("That page");
    }

    /// <summary>
    /// A receipt photo on an entry. The database decides first (the entry is there, the caller may write on its sheet, not over 5 photos); the
    /// bytes follow. Files live under tenant/g/entry/id.jpg, apart from the company's photos, and are served only to people who can see the sheet.
    /// </summary>
    public async Task<(bool Replayed, string DataJson)> AddPhotoAsync(ICurrentContext me, Guid entryId, Upload u, CancellationToken ct)
    {
        var m = u.Meta;
        if (!Guid.TryParse((string?)m["id"], out var id)) throw AppException.Invalid("The photo needs an id.");
        if (u.File.Length is 0 or > AttachmentsService.MaxFileBytes) throw AppException.Invalid("The photo is empty or too big.");
        if (!IsJpeg(u.File)) throw AppException.Invalid("Only photos (JPEG) can be added.");
        if (u.Thumb is { Length: > AttachmentsService.MaxThumbBytes } || (u.Thumb is { } t && !IsJpeg(t))) throw AppException.Invalid("The small preview is not valid.");
        var folder = $"{me.TenantId:N}/g/{entryId:N}";
        var key = $"{folder}/{id:N}.jpg";
        var thumbKey = u.Thumb is null ? null : $"{folder}/{id:N}.t.jpg";
        var payload = new JsonObject
        {
            ["id"] = id.ToString(), ["entryId"] = entryId.ToString(), ["size"] = u.File.Length,
            ["sha256"] = Convert.ToHexString(SHA256.HashData(u.File)).ToLowerInvariant(), ["storageKey"] = key, ["thumbKey"] = thumbKey,
            ["width"] = Int(m["width"]), ["height"] = Int(m["height"]), ["takenAt"] = (string?)m["takenAt"],
        };
        var json = await store.CallAsync(me, "photo_add", payload.ToJsonString(), ct) ?? throw AppException.NotFound("That entry");
        using var doc = JsonDocument.Parse(json);
        var replayed = doc.RootElement.GetProperty("replayed").GetBoolean();
        if (!replayed)
        {
            await blobs.WriteAsync(key, u.File, ct);
            if (u.Thumb is not null) await blobs.WriteAsync(thumbKey!, u.Thumb, ct);
        }
        return (replayed, doc.RootElement.GetProperty("data").GetRawText());
    }

    /// <summary>A receipt photo (or its preview) for someone who may see its sheet; null otherwise.</summary>
    public async Task<Served?> OpenPhotoAsync(ICurrentContext me, Guid photoId, bool thumb, CancellationToken ct)
    {
        var json = await store.CallAsync(me, "photo_open", new JsonObject { ["photoId"] = photoId.ToString() }.ToJsonString(), ct);
        if (json is null) return null;
        using var doc = JsonDocument.Parse(json);
        var root = doc.RootElement;
        var key = thumb && root.TryGetProperty("thumbKey", out var tk) && tk.ValueKind == JsonValueKind.String ? tk.GetString()! : root.GetProperty("storageKey").GetString()!;
        var stream = blobs.Open(key);
        return stream is null ? null : new Served(stream, "image/jpeg", root.GetProperty("sha256").GetString() + (thumb ? "-t" : ""), root.GetProperty("fileName").GetString() ?? "receipt.jpg");
    }

    private static bool IsJpeg(byte[] b) => b.Length > 4 && b[0] == 0xFF && b[1] == 0xD8 && b[2] == 0xFF;
    private static int? Int(JsonNode? n) => n is JsonValue v && v.TryGetValue<int>(out var i) && i is > 0 and < 20000 ? i : null;
}