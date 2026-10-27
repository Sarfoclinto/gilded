using System.Text.Json.Nodes;
using GoldValuation.Application.Abstractions;
using GoldValuation.Application.PriceFeed;

namespace GoldValuation.Api.Endpoints;

/// <summary>Settings and history of the automatic price, a read-only preview of what the page says, and a manual look.</summary>
public static class PriceFeedEndpoints
{
    private static IResult Data(string json) => new RawJsonResult(200, $"{{\"data\":{json}}}");

    public static RouteGroupBuilder MapPriceFeed(this RouteGroupBuilder api)
    {
        api.MapGet("/price-feed", async (ICurrentContext me, PriceFeedService svc, CancellationToken ct) => Data(await svc.GetAsync(me, ct)));
        api.MapPut("/price-feed", async (JsonObject body, ICurrentContext me, PriceFeedService svc, CancellationToken ct) => Data(await svc.SaveAsync(me, body, ct)));
        api.MapPost("/price-feed/preview", async (ICurrentContext me, PriceFeedService svc, CancellationToken ct) => Data(await svc.PreviewAsync(me, ct)));
        api.MapPost("/price-feed/check", async (ICurrentContext me, PriceFeedService svc, CancellationToken ct) => Data(await svc.CheckNowAsync(me, ct)));
        api.MapPost("/price-feed/events/{id:guid}/accept", async (Guid id, ICurrentContext me, PriceFeedService svc, CancellationToken ct) => Data(await svc.DecideAsync(me, id, true, ct)));
        api.MapPost("/price-feed/events/{id:guid}/dismiss", async (Guid id, ICurrentContext me, PriceFeedService svc, CancellationToken ct) => Data(await svc.DecideAsync(me, id, false, ct)));
        return api;
    }
}
