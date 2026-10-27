using System.Globalization;
using System.Text.Json.Nodes;
using GoldValuation.Application.Abstractions;
using GoldValuation.Application.Auth;

namespace GoldValuation.Application.PriceFeed;

/// <summary>
/// The automatic reference price: the settings a director chooses (when to look, which days, what to do with margins), a manual
/// "look now", and the scheduled look the background worker makes. Everything needs <see cref="Permissions.PricesApprove"/>.
/// A price that does not check out is held for a director rather than used.
/// </summary>
public sealed class PriceFeedService(IPriceFeedStore store, IGoldbodClient client, IClock clock)
{
    public Task<string> GetAsync(ICurrentContext me, CancellationToken ct)
    {
        me.Require(Permissions.PricesApprove);
        return store.GetAsync(me, ct);
    }

    public Task<string> SaveAsync(ICurrentContext me, JsonObject body, CancellationToken ct)
    {
        me.Require(Permissions.PricesApprove);
        var windows = body["windows"] as JsonArray ?? throw AppException.Invalid("Give at least one check time.");
        if (windows.Count > 6) throw AppException.Invalid("Use at most 6 check times.");
        var clean = new JsonObject
        {
            ["enabled"] = (bool?)body["enabled"] ?? false,
            ["windows"] = new JsonArray(windows.Select(w => (JsonNode)new JsonObject
            {
                ["start"] = (string?)w?["start"],
                ["end"] = (string?)w?["end"],
                ["everyMinutes"] = (int?)w?["everyMinutes"],
            }).ToArray()),
            ["weekdays"] = new JsonArray((body["weekdays"] as JsonArray ?? []).Select(d => (JsonNode)JsonValue.Create((int)d!)!).ToArray()),
            ["timezone"] = (string?)body["timezone"],
            ["marginPolicy"] = (string?)body["marginPolicy"] ?? "approve",
            ["maxJumpPct"] = (decimal?)body["maxJumpPct"] ?? 10m,
        };
        return store.SaveAsync(me, clean.ToJsonString(), ct);
    }

    public Task<string> DecideAsync(ICurrentContext me, Guid eventId, bool accept, CancellationToken ct)
    {
        me.Require(Permissions.PricesApprove);
        return store.DecideAsync(me, eventId, accept, ct);
    }

    /// <summary>Reads the page and says what it found, recording nothing. Lets a director see exactly what the system would read.</summary>
    public async Task<string> PreviewAsync(ICurrentContext me, CancellationToken ct)
    {
        me.Require(Permissions.PricesApprove);
        var state = await StateOrNull(me.TenantId, ct);
        string html;
        try { html = await client.FetchPageAsync(ct); }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException) { return Reply(false, "GoldBod could not be reached from the server just now.", null, null, null); }
        var parsed = GoldbodPageParser.Parse(html);
        if (parsed is null) return Reply(false, "The price was not found on the page. The page may have changed; set the price by hand and tell us.", null, null, GoldbodPageParser.ToText(html)[..Math.Min(400, GoldbodPageParser.ToText(html).Length)]);
        var expected = state is null ? null : FeedDecider.Expected(parsed, state);
        return Reply(true, $"Found GH₵ {parsed.GhsPerPound.ToString("N2", CultureInfo.InvariantCulture)} per pound.", parsed, expected, null);
    }

    /// <summary>Looks now, as if the schedule had fired. Used by the "Check now" button.</summary>
    public async Task<string> CheckNowAsync(ICurrentContext me, CancellationToken ct)
    {
        me.Require(Permissions.PricesApprove);
        var state = await StateOrNull(me.TenantId, ct) ?? throw AppException.Invalid("Save the automatic price settings first.");
        return await LookAsync(me.TenantId, me.UserId, state, ct);
    }

    /// <summary>The worker's call: look if the schedule says it is time. Returns true when a look was made.</summary>
    public async Task<bool> RunIfDueAsync(Guid tenantId, CancellationToken ct)
    {
        var state = await StateOrNull(tenantId, ct);
        if (state is null || !FeedSchedule.IsDue(state, clock.UtcNow)) return false;
        await LookAsync(tenantId, state.Actor!.Value, state, ct);
        return true;
    }

    private async Task<string> LookAsync(Guid tenantId, Guid actor, FeedState state, CancellationToken ct)
    {
        string result;
        try
        {
            var html = await client.FetchPageAsync(ct);
            var parsed = GoldbodPageParser.Parse(html);
            if (parsed is null)
                result = new JsonObject { ["kind"] = "failed", ["message"] = "The price was not found on GoldBod's page. It may have been redesigned.", ["excerpt"] = GoldbodPageParser.ToText(html)[..Math.Min(1200, GoldbodPageParser.ToText(html).Length)] }.ToJsonString();
            else
            {
                var d = FeedDecider.Decide(parsed, state);
                result = new JsonObject
                {
                    ["kind"] = d.Kind,
                    ["message"] = d.Message,
                    ["basePrice"] = parsed.GhsPerPound,
                    ["publishedAt"] = (parsed.PublishedAt ?? clock.UtcNow).ToString("o", CultureInfo.InvariantCulture),
                    ["usdPerOunce"] = parsed.UsdPerOunce,
                    ["rate"] = parsed.Rate,
                    ["discountPct"] = parsed.DiscountPct,
                    ["computed"] = d.Computed is { } c ? decimal.Round(c, 2) : null,
                    ["excerpt"] = parsed.Excerpt,
                }.ToJsonString();
            }
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException)
        {
            result = new JsonObject { ["kind"] = "failed", ["message"] = "GoldBod's website could not be reached." }.ToJsonString();
        }
        return await store.RecordAsync(tenantId, actor, result, ct);
    }

    private async Task<FeedState?> StateOrNull(Guid tenantId, CancellationToken ct) =>
        await store.StateAsync(tenantId, ct) is { } json ? FeedState.FromJson(json) : null;

    private static string Reply(bool found, string message, ParsedPrice? p, decimal? expected, string? excerpt) =>
        new JsonObject
        {
            ["found"] = found,
            ["message"] = message,
            ["price"] = p is null ? null : new JsonObject
            {
                ["ghsPerPound"] = p.GhsPerPound,
                ["usdPerOunce"] = p.UsdPerOunce,
                ["rate"] = p.Rate,
                ["discountPct"] = p.DiscountPct,
                ["publishedAt"] = p.PublishedAt?.ToString("o", CultureInfo.InvariantCulture),
                ["expected"] = expected is { } e ? decimal.Round(e, 2) : null,
            },
            ["excerpt"] = excerpt,
        }.ToJsonString();
}
