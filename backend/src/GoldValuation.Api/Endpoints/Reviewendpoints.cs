using System.Text.Json.Nodes;
using GoldValuation.Application.Abstractions;
using GoldValuation.Application.Review;

namespace GoldValuation.Api.Endpoints;

/// <summary>The discrepancy inbox, a branch's timeline, and the between-branches position.</summary>
public static class ReviewEndpoints
{
    private static IResult Data(string json) => new RawJsonResult(200, $"{{\"data\":{json}}}");

    public static RouteGroupBuilder MapReview(this RouteGroupBuilder api)
    {
        api.MapGet("/discrepancies", async (string? status, Guid? branchId, int? limit, ICurrentContext me, ReviewService svc, CancellationToken ct) =>
            Data(await svc.ListCasesAsync(me, status, branchId, limit, ct)));
        api.MapGet("/discrepancies/{id:guid}", async (Guid id, ICurrentContext me, ReviewService svc, CancellationToken ct) =>
            Data(await svc.GetCaseAsync(me, id, ct)));
        api.MapPost("/discrepancies/{id:guid}/actions", async (Guid id, JsonObject body, ICurrentContext me, ReviewService svc, CancellationToken ct) =>
            Data(await svc.ActOnCaseAsync(me, id, body, ct)));
        api.MapGet("/branches/{id:guid}/timeline", async (Guid id, DateTimeOffset? from, DateTimeOffset? to, string? asset, long? before, int? limit, ICurrentContext me, ReviewService svc, CancellationToken ct) =>
            Data(await svc.TimelineAsync(me, id, from, to, asset, before, limit, ct)));
        api.MapGet("/branches/position", async (ICurrentContext me, ReviewService svc, CancellationToken ct) =>
            Data(await svc.PositionAsync(me, ct)));
        return api;
    }
}
