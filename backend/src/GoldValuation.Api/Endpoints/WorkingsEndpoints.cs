using System.Text.Json.Nodes;
using GoldValuation.Application.Abstractions;
using GoldValuation.Application.Workings;

namespace GoldValuation.Api.Endpoints;

/// <summary>Workings: a person's private scratch sheets. Every route works only on the signed-in person's own sheets.</summary>
public static class WorkingsEndpoints
{
    private static IResult Data(string json, int status = 200) => new RawJsonResult(status, $"{{\"data\":{json}}}");

    public static RouteGroupBuilder MapWorkings(this RouteGroupBuilder api)
    {
        api.MapGet("/me/workings", async (HttpContext http, ICurrentContext me, WorkingsService svc, CancellationToken ct) =>
            Data(await svc.ListAsync(me, http.Request.Query.ToDictionary(k => k.Key, k => (string?)k.Value.ToString()), ct)));
        // sharing: read-only, one colleague at a time (the colleague list is the same as for pictures: GET /me/pictures/colleagues)
        api.MapGet("/me/workings/shared", async (ICurrentContext me, WorkingsService svc, CancellationToken ct) => Data(await svc.SharedListAsync(me, ct)));
        api.MapPost("/me/workings/{id:guid}/share", async (Guid id, JsonObject body, ICurrentContext me, WorkingsService svc, CancellationToken ct) =>
            Data(await svc.ShareAsync(me, id, Guid.TryParse((string?)body["to"], out var to) ? to : throw AppException.Invalid("Choose a colleague to share with."), ct)));
        api.MapPost("/me/workings/{id:guid}/unshare", async (Guid id, JsonObject body, ICurrentContext me, WorkingsService svc, CancellationToken ct) =>
            Data(await svc.UnshareAsync(me, id, Guid.TryParse((string?)body["to"], out var to) ? to : null, ct)));
        api.MapPost("/me/workings/{id:guid}/hide", async (Guid id, ICurrentContext me, WorkingsService svc, CancellationToken ct) => Data(await svc.HideSharedAsync(me, id, ct)));
        api.MapGet("/me/workings/{id:guid}", async (Guid id, ICurrentContext me, WorkingsService svc, CancellationToken ct) => Data(await svc.GetAsync(me, id, ct)));
        api.MapPut("/me/workings/{id:guid}", async (Guid id, JsonObject body, ICurrentContext me, WorkingsService svc, CancellationToken ct) => Data(await svc.SaveAsync(me, id, body, ct)));
        api.MapPatch("/me/workings/{id:guid}", async (Guid id, JsonObject body, ICurrentContext me, WorkingsService svc, CancellationToken ct) =>
            Data(await svc.RenameAsync(me, id, (string?)body["name"], ct)));
        api.MapPost("/me/workings/delete", async (JsonObject body, ICurrentContext me, WorkingsService svc, CancellationToken ct) =>
        {
            var ids = (body["ids"] as JsonArray)?.Select(n => Guid.TryParse((string?)n, out var g) ? g : Guid.Empty).Where(g => g != Guid.Empty).Distinct().ToArray()
                      ?? throw AppException.Invalid("Choose the sheets.");
            return Data(await svc.DeleteAsync(me, ids, ct));
        });
        return api;
    }
}