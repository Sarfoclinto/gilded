using System.Text.Json.Nodes;
using GoldValuation.Application.Abstractions;
using GoldValuation.Application.Sync;

namespace GoldValuation.Api.Endpoints;

/// <summary>
/// Offline sync. A signed-in person registers each device they use; commands made offline arrive in signed batches (from the device itself or a
/// branch computer relaying for others); managers review what could not be applied (sync:review).
/// </summary>
public static class SyncEndpoints
{
    private static IResult Data(string json) => new RawJsonResult(200, $"{{\"data\":{json}}}");

    public static RouteGroupBuilder MapSync(this RouteGroupBuilder api)
    {
        api.MapPost("/sync/devices", async (JsonObject body, ICurrentContext me, SyncService svc, CancellationToken ct) => Data(await svc.RegisterDeviceAsync(me, body, ct)));
        api.MapPost("/sync/commands", async (JsonObject body, ICurrentContext me, SyncService svc, CancellationToken ct) => Data(await svc.SubmitAsync(me, body, ct)));
        api.MapGet("/sync/review", async (ICurrentContext me, SyncService svc, CancellationToken ct) => Data(await svc.ReviewAsync(me, ct)));
        api.MapPost("/sync/review/{id:guid}", async (Guid id, JsonObject body, ICurrentContext me, SyncService svc, CancellationToken ct) => Data(await svc.ResolveAsync(me, id, body, ct)));
        return api;
    }
}