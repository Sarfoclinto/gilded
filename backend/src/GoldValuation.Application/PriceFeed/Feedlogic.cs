using System.Globalization;
using System.Text.Json.Nodes;

namespace GoldValuation.Application.PriceFeed;

public sealed record FeedWindow(TimeOnly Start, TimeOnly End, int EveryMinutes);

/// <summary>What the worker knows about a company's feed. Read from the database; times are UTC.</summary>
public sealed record FeedState(
    bool Enabled, IReadOnlyList<FeedWindow> Windows, IReadOnlySet<int> Weekdays, string TimeZone, decimal MaxJumpPct, Guid? Actor,
    DateTimeOffset? LastCheckedAt, DateTimeOffset? LastCapturedAt, DateTimeOffset? LatestFeedPublishedAt, decimal? LatestBase, decimal PoundGrams, decimal ReferenceKarat)
{
    public static FeedState FromJson(string json)
    {
        var n = JsonNode.Parse(json)!.AsObject();
        DateTimeOffset? At(string k) => n[k] is JsonValue v && v.TryGetValue<string>(out var s) && DateTimeOffset.TryParse(s, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var d) ? d : null;
        decimal? Dec(string k) => n[k] is JsonValue v && decimal.TryParse(v.ToString().Trim('"'), NumberStyles.Number, CultureInfo.InvariantCulture, out var d) ? d : null;
        var windows = (n["windows"] as JsonArray ?? [])
            .Select(w => new FeedWindow(TimeOnly.Parse((string)w!["start"]!, CultureInfo.InvariantCulture), TimeOnly.Parse((string)w["end"]!, CultureInfo.InvariantCulture), (int)w["everyMinutes"]!))
            .ToList();
        var days = (n["weekdays"] as JsonArray ?? []).Select(d => (int)d!).ToHashSet();
        return new FeedState((bool?)n["enabled"] ?? false, windows, days, (string?)n["timezone"] ?? "Africa/Accra", Dec("maxJumpPct") ?? 10,
            Guid.TryParse((string?)n["actor"], out var a) ? a : null, At("lastCheckedAt"), At("lastCapturedAt"), At("latestFeedPublishedAt"), Dec("latestBase"),
            Dec("poundGrams") ?? 7.75m, Dec("referenceKarat") ?? 23m);
    }
}

public static class FeedSchedule
{
    public static TimeZoneInfo Zone(string id)
    {
        try { return TimeZoneInfo.FindSystemTimeZoneById(id); } catch (TimeZoneNotFoundException) { return TimeZoneInfo.Utc; }
    }

    /// <summary>
    /// Is it time to look? Yes when now falls inside one of the company's check windows on a chosen weekday, a price has not already been
    /// captured since that window opened, and the last look was at least "every N minutes" ago. So a window ends itself the moment its price arrives.
    /// </summary>
    public static bool IsDue(FeedState s, DateTimeOffset nowUtc)
    {
        if (!s.Enabled || s.Actor is null) return false;
        var zone = Zone(s.TimeZone);
        var local = TimeZoneInfo.ConvertTime(nowUtc, zone);
        var isoDay = local.DayOfWeek == DayOfWeek.Sunday ? 7 : (int)local.DayOfWeek;
        if (!s.Weekdays.Contains(isoDay)) return false;
        var t = TimeOnly.FromDateTime(local.DateTime);
        foreach (var w in s.Windows)
        {
            if (t < w.Start || t >= w.End) continue;
            var opened = new DateTimeOffset(local.Date + w.Start.ToTimeSpan(), zone.GetUtcOffset(local.Date + w.Start.ToTimeSpan()));
            if (s.LastCapturedAt is { } c && c >= opened) return false;
            return s.LastCheckedAt is not { } last || nowUtc - last >= TimeSpan.FromMinutes(w.EveryMinutes);
        }
        return false;
    }
}

public sealed record FeedDecision(string Kind, string Message, decimal? Computed);

public static class FeedDecider
{
    public const decimal TroyOunceGrams = 31.1034768m;
    /// <summary>How far the page's cedi price may be from the one worked out from its own dollar price and rate before a person must confirm it.</summary>
    public const decimal ToleranceFraction = 0.015m;

    /// <summary>The cedi price per pound that follows from the LBMA price, the rate and the discount, at the company's reference karat.</summary>
    public static decimal? Expected(ParsedPrice p, FeedState s) =>
        p.UsdPerOunce is { } usd && p.Rate is { } rate
            ? usd * rate * (1 - (p.DiscountPct ?? 0) / 100m) * (s.PoundGrams / TroyOunceGrams) * (s.ReferenceKarat / 24m)
            : null;

    public static FeedDecision Decide(ParsedPrice p, FeedState s)
    {
        var shown = $"GH₵ {p.GhsPerPound.ToString("N2", CultureInfo.InvariantCulture)}";
        if (p.PublishedAt is { } at)
        {
            if (s.LatestFeedPublishedAt is { } prev && at <= prev) return new FeedDecision("unchanged", $"Still the {at:HH:mm} price ({shown}).", null);
        }
        else if (s.LatestBase == p.GhsPerPound) return new FeedDecision("unchanged", $"Still {shown}.", null);

        var expected = Expected(p, s);
        if (expected is { } e && Math.Abs(p.GhsPerPound - e) / e > ToleranceFraction)
            return new FeedDecision("held", $"The page shows {shown} per pound, but its own LBMA price and rate give about GH₵ {e.ToString("N2", CultureInfo.InvariantCulture)}. Check before using it.", e);
        if (s.LatestBase is { } b && b > 0 && Math.Abs(p.GhsPerPound - b) / b * 100m > s.MaxJumpPct)
            return new FeedDecision("held", $"{shown} per pound is more than {s.MaxJumpPct:0.##}% away from the current price (GH₵ {b.ToString("N2", CultureInfo.InvariantCulture)}). Confirm it.", expected);
        return new FeedDecision("applied", $"New GoldBod price {shown} per pound.", expected);
    }
}
