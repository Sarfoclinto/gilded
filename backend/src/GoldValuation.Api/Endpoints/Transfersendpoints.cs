using System.Text.Json.Nodes;
using GoldValuation.Application.Abstractions;
using GoldValuation.Application.Transfers;

namespace GoldValuation.Api.Endpoints;

/// <summary>Goods and cash moving between branches: draft, release, payments, receipt.</summary>
public static class TransfersEndpoints
{
    private static IResult Data(string json, int status = 200) => new RawJsonResult(status, $"{{\"data\":{json}}}");
    private static string? Key(HttpContext http) => http.Request.Headers["Idempotency-Key"].FirstOrDefault();

    public static RouteGroupBuilder MapTransfers(this RouteGroupBuilder api)
    {
        api.MapGet("/transfers", async (Guid branchId, string? status, string? direction, ICurrentContext me, TransfersService svc, CancellationToken ct) =>
            Data(await svc.ListAsync(me, branchId, status, direction, ct)));
        api.MapGet("/transfers/available-items", async (Guid branchId, ICurrentContext me, TransfersService svc, CancellationToken ct) =>
            Data(await svc.TransferableItemsAsync(me, branchId, ct)));
        api.MapGet("/transfers/staff", async (ICurrentContext me, TransfersService svc, CancellationToken ct) =>
            Data(await svc.StaffAsync(me, ct)));
        api.MapGet("/transfers/{id:guid}", async (Guid id, ICurrentContext me, TransfersService svc, CancellationToken ct) =>
            Data(await svc.GetAsync(me, id, ct)));
        api.MapPost("/transfers", async (JsonObject body, HttpContext http, ICurrentContext me, TransfersService svc, CancellationToken ct) =>
        {
            var r = await svc.CreateAsync(me, body, Key(http), ct);
            return Data(r.DataJson, r.Replayed ? 200 : 201);
        });
        api.MapPatch("/transfers/{id:guid}", async (Guid id, JsonObject body, ICurrentContext me, TransfersService svc, CancellationToken ct) =>
            Data(await svc.EditAsync(me, id, body, ct)));
        api.MapPost("/transfers/{id:guid}/release", async (Guid id, JsonObject body, ICurrentContext me, TransfersService svc, CancellationToken ct) =>
            Data(await svc.ReleaseAsync(me, id, body, ct)));
        api.MapPost("/transfers/{id:guid}/payments", async (Guid id, JsonObject body, ICurrentContext me, TransfersService svc, CancellationToken ct) =>
            Data(await svc.RecordPaymentAsync(me, id, body, ct)));
        api.MapPost("/transfers/{id:guid}/receive", async (Guid id, JsonObject body, ICurrentContext me, TransfersService svc, CancellationToken ct) =>
            Data(await svc.ReceiveAsync(me, id, body, ct)));
        api.MapPost("/transfers/{id:guid}/cancel", async (Guid id, JsonObject body, ICurrentContext me, TransfersService svc, CancellationToken ct) =>
            Data(await svc.CancelAsync(me, id, (string?)body["reason"], ct)));
        api.MapPost("/transfers/{id:guid}/recall", async (Guid id, JsonObject body, ICurrentContext me, TransfersService svc, CancellationToken ct) =>
            Data(await svc.RecallAsync(me, id, (string?)body["reason"], ct)));
        api.MapPost("/transfers/{id:guid}/notes", async (Guid id, JsonObject body, ICurrentContext me, TransfersService svc, CancellationToken ct) =>
            Data(await svc.AddNoteAsync(me, id, (string?)body["text"], ct)));
        return api;
    }
}