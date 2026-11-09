using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using GoldValuation.Application.Abstractions;
using GoldValuation.Application.Auth;
using GoldValuation.Application.Operations;

namespace GoldValuation.Application.Sync;

/// <summary>
/// Commands made while offline reach the server in batches, possibly relayed by another computer (a branch hub). Every command is signed
/// by the device it was made on, for the person who made it. For each one, in order:
///   1. the signature must match the key that person registered for that device,
///   2. that person must still be active and allowed to do this kind of thing,
///   3. the database applies it as that person and records the result (applied, held or rejected for review, never lost).
/// A command that fails steps 1 or 2 is refused outright (nothing is recorded, the sender keeps it and shows why).
/// </summary>
public sealed class SyncService(ISyncStore store, ICommandVerifier verifier, IClock clock)
{
    public const int MaxBatch = 200;
    private const string Formula = "ExcelV1";
    private static readonly JsonSerializerOptions WebJson = new(JsonSerializerDefaults.Web);

    private sealed record PayInput(Guid TransactionId, Dictionary<string, int>? Lines, DateTimeOffset? CapturedAt, string? CheckAmount);

    /// <summary>
    /// What a device queued is what its screen sent to the normal save. The database functions want the worked-out form, so it goes through the
    /// same checks and calculation as the normal save first (a purchase is recalculated with the company's formula; the device's figures are only compared).
    /// Drawer movements and exchanges already have the database's shape.
    /// </summary>
    private async Task<JsonObject> PrepareAsync(Guid tenantId, Guid userId, string type, JsonObject payload, CancellationToken ct)
    {
        switch (type)
        {
            case "transaction.create":
            {
                var cmd = payload.Deserialize<CreateTransactionCommand>(WebJson) ?? throw AppException.Invalid("The purchase is not valid.");
                var config = await store.CalcConfigAsync(tenantId, userId, Formula, ct);
                return TransactionPlanner.Plan(cmd, config, clock.UtcNow);
            }
            case "transaction.pay":
            {
                var pay = payload.Deserialize<PayInput>(WebJson) ?? throw AppException.Invalid("The payment is not valid.");
                if (pay.TransactionId == Guid.Empty) throw AppException.Invalid("Say which purchase is being paid.");
                var lines = TransactionPlanner.ParseLines(pay.Lines);
                if (lines.Count == 0) throw AppException.Invalid("Enter the notes you are handing over.");
                var noteLines = new JsonObject();
                foreach (var (denom, count) in lines.OrderByDescending(kv => kv.Key)) noteLines[denom.ToString(CultureInfo.InvariantCulture)] = count;
                var o = new JsonObject { ["id"] = pay.TransactionId, ["lines"] = noteLines, ["capturedAt"] = pay.CapturedAt ?? clock.UtcNow };
                if (!string.IsNullOrWhiteSpace(pay.CheckAmount))
                {
                    if (!decimal.TryParse(pay.CheckAmount, NumberStyles.Number, CultureInfo.InvariantCulture, out var check)) throw AppException.Invalid("Enter the amount as a number.");
                    o["checkAmount"] = check;
                }
                return o;
            }
            default:
                return payload;
        }
    }

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

        // Worked out by the server's own rules. If that fails, the entry is still recorded (as rejected, with the reason) for a manager to see.
        var forDatabase = payload;
        JsonObject? planError = null;
        try
        {
            forDatabase = await PrepareAsync(tenantId, userId, type, payload, ct);
        }
        catch (AppException e)
        {
            var detail = e.FieldErrors?.Values.SelectMany(v => v).FirstOrDefault();
            planError = new JsonObject { ["code"] = e.Code, ["message"] = detail is null ? e.Message : $"{e.Message} {detail}" };
        }
        catch (Exception e) when (e is JsonException or InvalidOperationException or FormatException)
        {
            planError = new JsonObject { ["code"] = "VALIDATION_FAILED", ["message"] = "The entry content is not valid." };
        }

        var applied = new JsonObject { ["id"] = id, ["type"] = type, ["deviceId"] = device, ["capturedAt"] = at, ["payload"] = forDatabase };
        if (planError is not null) applied["planError"] = planError;
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