using GoldValuation.Application.Market;

namespace GoldValuation.Api.Endpoints;

/// <summary>The live world gold price beside GoldBod's figure on the Gold market page (signed-in users; for watching only).</summary>
public static class MarketEndpoints
{
    public static RouteGroupBuilder MapMarket(this RouteGroupBuilder api)
    {
        api.MapGet("/market/world-price", async (WorldPriceService svc, CancellationToken ct) => new RawJsonResult(200, $"{{\"data\":{await svc.GetAsync(ct)}}}"));
        return api;
    }
}