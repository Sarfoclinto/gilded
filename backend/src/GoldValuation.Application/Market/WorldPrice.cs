using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;
using GoldValuation.Application.Abstractions;

namespace GoldValuation.Application.Market;

/// <summary>The live world gold price: US dollars per troy ounce of pure gold, and when the source last updated it.</summary>
public sealed record WorldQuote(decimal UsdPerOunce, DateTimeOffset At, string Source);

/// <summary>Fetches the raw answer from the outside price source. The address is fixed in configuration (Market:WorldPriceUrl), never chosen by a user.</summary>
public interface IWorldPriceClient
{
    Task<string> FetchAsync(CancellationToken ct);
}

/// <summary>Reads xaus.com's spot answer: <c>{ "spot_usd_oz": 4007.20, "updated_at": "2026-07-02T09:00:00.000Z", ... }</c>.</summary>
public static class XausSpotParser
{
    public static WorldQuote? Parse(string json, DateTimeOffset now)
    {
        try
        {
            if (JsonNode.Parse(json) is not JsonObject o) return null;
            var price = Number(o["spot_usd_oz"]) ?? Number(o["xau"]?["price"]);
            // a world gold price outside this band is a broken answer, not a market move
            if (price is not { } p || p < 100m || p > 100_000m) return null;
            var at = o["updated_at"] is JsonValue uv && uv.TryGetValue<string>(out var s) && DateTimeOffset.TryParse(s, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var t) ? t : now;
            return new WorldQuote(decimal.Round(p, 2), at > now ? now : at, "xaus.com");
        }
        catch (Exception ex) when (ex is JsonException or InvalidOperationException or FormatException or OverflowException)
        {
            return null;
        }
    }

    private static decimal? Number(JsonNode? n)
    {
        if (n is not JsonValue v) return null;
        if (v.TryGetValue<decimal>(out var d)) return d;
        if (v.TryGetValue<double>(out var f)) return (decimal)f;
        return v.TryGetValue<string>(out var s) && decimal.TryParse(s, NumberStyles.Number, CultureInfo.InvariantCulture, out var x) ? x : null;
    }
}

/// <summary>
/// The live world price for the Gold market page, held for a minute so that however many people have the page open, the outside source
/// is asked at most once a minute (its terms ask for that). When the source cannot be reached, the last good price is given for up to
/// 30 minutes, marked as old; after that the answer says the price is not available. It is for watching only: never used for a valuation.
/// </summary>
public sealed class WorldPriceService(IWorldPriceClient client, IClock clock)
{
    public static readonly TimeSpan Fresh = TimeSpan.FromSeconds(60);
    public static readonly TimeSpan KeepLastGood = TimeSpan.FromMinutes(30);

    private readonly SemaphoreSlim gate = new(1, 1);
    private WorldQuote? lastGood;
    private DateTimeOffset lastGoodFetched;
    private DateTimeOffset lastTried = DateTimeOffset.MinValue;

    public async Task<string> GetAsync(CancellationToken ct)
    {
        await gate.WaitAsync(ct);
        try
        {
            var now = clock.UtcNow;
            if (now - lastTried >= Fresh)
            {
                lastTried = now;
                try
                {
                    var q = XausSpotParser.Parse(await client.FetchAsync(ct), now);
                    if (q is not null) { lastGood = q; lastGoodFetched = now; }
                }
                catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException && !ct.IsCancellationRequested)
                {
                    // keep the last good price; the answer below says how old it is
                }
            }
            var o = new JsonObject { ["checkedAt"] = now.ToString("o", CultureInfo.InvariantCulture) };
            if (lastGood is { } g && now - lastGoodFetched <= KeepLastGood)
            {
                o["available"] = true;
                o["usdPerOunce"] = g.UsdPerOunce.ToString(CultureInfo.InvariantCulture);
                o["at"] = g.At.ToString("o", CultureInfo.InvariantCulture);
                o["source"] = g.Source;
                o["stale"] = now - lastGoodFetched > Fresh + Fresh;
            }
            else
            {
                o["available"] = false;
                o["message"] = "The live world price could not be fetched just now.";
            }
            return o.ToJsonString();
        }
        finally
        {
            gate.Release();
        }
    }
}