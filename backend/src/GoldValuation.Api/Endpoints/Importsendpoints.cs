using System.Text.Json.Nodes;
using GoldValuation.Application.Abstractions;
using GoldValuation.Application.Imports;

namespace GoldValuation.Api.Endpoints;

/// <summary>Spreadsheet import: customers, past purchases in chunks, the list of imports, and undo.</summary>
public static class ImportsEndpoints
{
    private static IResult Data(string json) => new RawJsonResult(200, $"{{\"data\":{json}}}");

    public static RouteGroupBuilder MapImports(this RouteGroupBuilder api)
    {
        api.MapPost("/imports/history", async (JsonObject body, ICurrentContext me, ImportsService svc, CancellationToken ct) =>
            Data(await svc.ImportHistoryAsync(me, body, ct)));
        api.MapPost("/imports/opening", async (JsonObject body, ICurrentContext me, ImportsService svc, CancellationToken ct) =>
            Data(await svc.ImportOpeningAsync(me, body, ct)));
        api.MapPost("/imports/customers", async (JsonObject body, ICurrentContext me, ImportsService svc, CancellationToken ct) =>
            Data(await svc.ImportCustomersAsync(me, body, ct)));
        api.MapGet("/imports", async (ICurrentContext me, ImportsService svc, CancellationToken ct) =>
            Data(await svc.ListBatchesAsync(me, ct)));
        api.MapPost("/imports/{id:guid}/undo", async (Guid id, JsonObject body, ICurrentContext me, ImportsService svc, CancellationToken ct) =>
            Data(await svc.UndoBatchAsync(me, id, (string?)body["reason"], ct)));
        return api;
    }
}
