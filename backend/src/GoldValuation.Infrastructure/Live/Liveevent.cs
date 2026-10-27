using System.Text.Json;

namespace GoldValuation.Infrastructure.Live;

/// <summary>One message from the database channel <c>gold_events</c> (see migration 0019), and where it should be delivered.</summary>
public sealed record LiveEvent(
    string Kind,                 // "changed" | "notification"
    Guid TenantId,
    string? Topic,               // changed: transfers, review, days, payments, prices, ledger, transactions, debts
    IReadOnlyList<Guid>? Branches,   // changed: null = the whole company
    Guid? UserId,                // notification: who it is for
    Guid? NotificationId,
    string? NotificationKind,
    string? Title,
    string? Link)
{
    public const string Channel = "gold_events";

    /// <summary>Parse a payload; anything malformed is ignored (returns null) rather than breaking the relay.</summary>
    public static LiveEvent? Parse(string? payload)
    {
        if (string.IsNullOrWhiteSpace(payload)) return null;
        try
        {
            using var doc = JsonDocument.Parse(payload);
            var o = doc.RootElement;
            if (o.ValueKind != JsonValueKind.Object) return null;
            var kind = Str(o, "type");
            if (!Guid.TryParse(Str(o, "t"), out var tenant)) return null;
            switch (kind)
            {
                case "changed":
                    {
                        var topic = Str(o, "topic");
                        if (string.IsNullOrEmpty(topic)) return null;
                        List<Guid>? branches = null;
                        if (o.TryGetProperty("b", out var b) && b.ValueKind == JsonValueKind.Array)
                        {
                            branches = [];
                            foreach (var x in b.EnumerateArray())
                                if (x.ValueKind == JsonValueKind.String && Guid.TryParse(x.GetString(), out var id)) branches.Add(id);
                        }
                        return new LiveEvent(kind, tenant, topic, branches, null, null, null, null, null);
                    }
                case "notification":
                    {
                        if (!Guid.TryParse(Str(o, "u"), out var user) || !Guid.TryParse(Str(o, "n"), out var n)) return null;
                        return new LiveEvent(kind, tenant, null, null, user, n, Str(o, "kind"), Str(o, "title"), Str(o, "link"));
                    }
                default:
                    return null;
            }
        }
        catch (JsonException)
        {
            return null;
        }
    }

    private static string? Str(JsonElement o, string name) =>
        o.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

    /// <summary>The SignalR groups this event goes to. A branch event reaches people who work at those branches; a company-wide one reaches everyone signed in to the company.</summary>
    public IReadOnlyList<string> Groups()
    {
        if (Kind == "notification") return new[] { LiveGroups.User(UserId!.Value) };
        if (Branches is null) return new[] { LiveGroups.Tenant(TenantId) };
        return Branches.Select(b => LiveGroups.Branch(TenantId, b)).ToArray();
    }
}

public static class LiveGroups
{
    public static string Tenant(Guid tenant) => $"t:{tenant}";
    public static string Branch(Guid tenant, Guid branch) => $"b:{tenant}:{branch}";
    public static string User(Guid user) => $"u:{user}";
}
