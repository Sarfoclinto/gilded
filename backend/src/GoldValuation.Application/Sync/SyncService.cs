using System.Text;
using System.Text.Json.Nodes;
using GoldValuation.Application.Abstractions;
using GoldValuation.Application.Auth;

namespace GoldValuation.Application.Sync;

/// <summary>
/// Commands made while offline reach the server in batches, possibly relayed by another computer (a branch hub). Every command is signed
/// by the device it was made on, for the person who made it. For each one, in order:
///   1. the signature must match the key that person registered for that device,
///   2. that person must still be active and allowed to do this kind of thing,
///   3. the database applies it as that person and records the result (applied, held or rejected for review, never lost).
/// A command that fails steps 1 or 2 is refused outright (nothing is recorded, the sender keeps it and shows why).
/// </summary>
public sealed class SyncService(ISyncStore store, ICommandVerifier verifier)
{
    public const int MaxBatch = 200;

    /// <summary>The exact text that is signed. The device builds the same text; the payload goes as the JSON text that was signed.</summary>
    public static string SigningMessage(string id, string type, string userId, string deviceId, string capturedAt, string payloadJson) =>
        $"gilded-cmd-v1\n{id}\n{type}\n{userId}\n{deviceId}\n{capturedAt}\n{payloadJson}";

    /// <summary>The permission a command needs (checked for the person who made it).</summary>
    public static string? PermissionFor(string type, JsonNode? payload) => type switch
    {
        "transaction.create" => Permissions.TransactionsCreate,
        "transaction.pay" => Permissions.DaysManage,
        "drawer.movement" => Permissions.DaysManage,
        "drawer.exchange" => payload?["transactionId"] is null ? Permissions.NotesExchange : Permissions.DaysManage,
        "day.open" => Permissions.DaysManage,
        "day.close" => Permissions.DaysManage,
        _ => null,
    };

    public Task<string> RegisterDeviceAsync(ICurrentContext me, JsonObject body, CancellationToken ct)
    {
        var device = Str(body, "deviceId");
        var key = Str(body, "publicKey");
        if (device is null || device.Length is < 8 or > 80) throw AppException.Invalid("deviceId must be 8 to 80 characters.");
        if (key is null || key.Length is < 80 or > 400) throw AppException.Invalid("publicKey is not valid.");
        return store.RegisterDeviceAsync(me, new JsonObject { ["deviceId"] = device, ["publicKey"] = key }.ToJsonString(), ct);
    }

    public async Task<string> SubmitAsync(ICurrentContext me, JsonObject body, CancellationToken ct)
    {
        if (body["commands"] is not JsonArray commands) throw AppException.Invalid("commands must be a list.");
        if (commands.Count > MaxBatch) throw AppException.Invalid($"Send at most {MaxBatch} commands at a time.");
        var results = new JsonArray();
        foreach (var node in commands)
        {
            ct.ThrowIfCancellationRequested();
            results.Add(await OneAsync(me.TenantId, node as JsonObject, ct));
        }
        return new JsonObject { ["results"] = results }.ToJsonString();
    }

    private async Task<JsonNode> OneAsync(Guid tenantId, JsonObject? c, CancellationToken ct)
    {
        var id = Str(c, "id");
        JsonNode Refused(string code, string message) => new JsonObject { ["id"] = id, ["status"] = "refused", ["code"] = code, ["message"] = message };

        var type = Str(c, "type");
        var userText = Str(c, "userId");
        var device = Str(c, "deviceId");
        var at = Str(c, "capturedAt");
        var payloadJson = Str(c, "payloadJson");
        var signature = Str(c, "signature");
        if (id is null || !Guid.TryParse(id, out _) || type is null || userText is null || !Guid.TryParse(userText, out var userId)
            || device is null || at is null || payloadJson is null || signature is null)
            return Refused("BAD_COMMAND", "The command is incomplete.");

        JsonObject? payload;
        try { payload = JsonNode.Parse(payloadJson) as JsonObject; }
        catch (System.Text.Json.JsonException) { payload = null; }
        if (payload is null) return Refused("BAD_COMMAND", "The command content is not valid.");

        var needed = PermissionFor(type, payload);
        if (needed is null) return Refused("BAD_COMMAND", "Unknown command type.");

        byte[] sig;
        try { sig = Convert.FromBase64String(signature); }
        catch (FormatException) { return Refused("BAD_SIGNATURE", "The signature is not valid."); }

        var key = await store.DeviceKeyAsync(tenantId, userId, device, ct);
        if (key is null) return Refused("UNKNOWN_DEVICE", "This device was not registered for that person. Sign in with a connection on it once.");
        if (!verifier.Verify(key, Encoding.UTF8.GetBytes(SigningMessage(id, type, userText, device, at, payloadJson)), sig))
            return Refused("BAD_SIGNATURE", "The signature does not match.");

        var author = await store.AuthorAsync(tenantId, userId, ct);
        if (author is null || !author.Active) return Refused("USER_INACTIVE", "The person who made this is no longer active.");
        if (!author.Permissions.Contains(needed)) return Refused("FORBIDDEN", "The person who made this is not allowed to do it.");

        var applied = new JsonObject { ["id"] = id, ["type"] = type, ["deviceId"] = device, ["capturedAt"] = at, ["payload"] = payload };
        var json = await store.ApplyAsync(tenantId, userId, applied.ToJsonString(), ct);
        return JsonNode.Parse(json)!;
    }

    public Task<string> ReviewAsync(ICurrentContext me, CancellationToken ct)
    {
        me.Require(Permissions.SyncReview);
        return store.ReviewAsync(me, ct);
    }

    public Task<string> ResolveAsync(ICurrentContext me, Guid id, JsonObject body, CancellationToken ct)
    {
        me.Require(Permissions.SyncReview);
        var action = Str(body, "action");
        if (action is not ("retry" or "dismiss")) throw AppException.Invalid("action must be retry or dismiss.");
        var p = new JsonObject { ["id"] = id.ToString(), ["action"] = action };
        if (Str(body, "note") is { } note) p["note"] = note;
        return store.ResolveAsync(me, p.ToJsonString(), ct);
    }

    private static string? Str(JsonObject? o, string name) => o?[name] is JsonValue v && v.TryGetValue<string>(out var s) ? s : null;
}