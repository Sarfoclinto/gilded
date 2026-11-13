using System.Text;
using System.Text.Json.Nodes;
using GoldValuation.Application.Abstractions;
using GoldValuation.Application.Operations;
using Microsoft.AspNetCore.Mvc;

namespace GoldValuation.Api.Endpoints;

/// <summary>A response whose body is JSON text already built by the database in the contract's shape.</summary>
internal sealed class RawJsonResult(int status, string body) : IResult
{
    public Task ExecuteAsync(HttpContext http)
    {
        http.Response.StatusCode = status;
        http.Response.ContentType = "application/json; charset=utf-8";
        return http.Response.WriteAsync(body, Encoding.UTF8);
    }
}

public static class OperationsEndpoints
{
    private static IResult Data(string json, int status = 200) => new RawJsonResult(status, $"{{\"data\":{json}}}");
    private static IResult Created(DbResult r) => Data(r.DataJson, r.Replayed ? 200 : 201);
    private static string? Key(HttpContext http) => http.Request.Headers["Idempotency-Key"].FirstOrDefault();

    public static RouteGroupBuilder MapOperations(this RouteGroupBuilder api)
    {
        // ---- prices ----
        api.MapGet("/prices/current", async (Guid branchId, ICurrentContext me, OperationsService ops, CancellationToken ct) =>
            Data(await ops.CurrentPriceAsync(me, branchId, ct)));
        api.MapGet("/prices/history", async (Guid branchId, int? days, ICurrentContext me, OperationsService ops, CancellationToken ct) =>
            Data(await ops.PriceHistoryAsync(me, branchId, days, ct)));
        api.MapPost("/prices/base", async (BasePriceCommand body, ICurrentContext me, OperationsService ops, CancellationToken ct) =>
        {
            await ops.SetBasePriceAsync(me, body, ct);
            return Results.NoContent();
        });
        api.MapPut("/prices/margins/{branchId:guid}", async (Guid branchId, MarginCommand body, ICurrentContext me, OperationsService ops, CancellationToken ct) =>
            Data(await ops.SetMarginAsync(me, branchId, body, ct)));
        api.MapPost("/prices/margins/{branchId:guid}/approve", async (Guid branchId, ICurrentContext me, OperationsService ops, CancellationToken ct) =>
            Data(await ops.ApproveMarginAsync(me, branchId, ct)));

        // ---- days and drawer ----
        api.MapGet("/days/current", async (Guid branchId, ICurrentContext me, OperationsService ops, CancellationToken ct) =>
            Data(await ops.DayStateAsync(me, branchId, ct)));
        api.MapPost("/days/open", async (OpenDayCommand body, HttpContext http, ICurrentContext me, OperationsService ops, CancellationToken ct) =>
            Created(await ops.OpenDayAsync(me, body, Key(http), ct)));
        api.MapGet("/days", async (Guid branchId, [FromQuery(Name = "from")] string? fromDate, [FromQuery(Name = "to")] string? toDate, string? signoff, int? limit, ICurrentContext me, OperationsService ops, CancellationToken ct) =>
            Data(await ops.ListDaysAsync(me, branchId, fromDate, toDate, signoff, limit, ct)));
        api.MapGet("/days/{id:guid}", async (Guid id, ICurrentContext me, OperationsService ops, CancellationToken ct) =>
            Data(await ops.GetDayAsync(me, id, ct)));
        api.MapGet("/days/{id:guid}/activity", async (Guid id, ICurrentContext me, OperationsService ops, CancellationToken ct) =>
            Data(await ops.DayActivityAsync(me, id, ct)));
        api.MapGet("/days/{id:guid}/closing-preview", async (Guid id, ICurrentContext me, OperationsService ops, CancellationToken ct) =>
            Data(await ops.ClosingPreviewAsync(me, id, ct)));
        api.MapPost("/days/{id:guid}/close", async (Guid id, CloseDayCommand body, HttpContext http, ICurrentContext me, OperationsService ops, CancellationToken ct) =>
            Created(await ops.CloseDayAsync(me, id, body, Key(http), ct)));
        api.MapPost("/days/{id:guid}/signoff", async (Guid id, SignoffCommand body, ICurrentContext me, OperationsService ops, CancellationToken ct) =>
            Data(await ops.SignoffDayAsync(me, id, body, ct)));
        api.MapPost("/days/{id:guid}/movements", async (Guid id, MovementCommand body, HttpContext http, ICurrentContext me, OperationsService ops, CancellationToken ct) =>
            Created(await ops.RecordMovementAsync(me, id, body, Key(http), ct)));

        api.MapPost("/days/{id:guid}/exchanges", async (Guid id, ExchangeCommand body, HttpContext http, ICurrentContext me, OperationsService ops, CancellationToken ct) =>
            Created(await ops.RecordExchangeAsync(me, id, body, Key(http), ct)));

        // ---- purchases ----
        api.MapGet("/transactions", async (Guid branchId, int? limit, ICurrentContext me, OperationsService ops, CancellationToken ct) =>
            Data(await ops.ListTransactionsAsync(me, branchId, limit, ct)));
        api.MapGet("/transactions/search", async ([AsParameters] TransactionSearch s, ICurrentContext me, OperationsService ops, CancellationToken ct) =>
            Data(await ops.SearchTransactionsAsync(me, s, ct)));
        api.MapGet("/dashboard", async (Guid? branchId, int? days, ICurrentContext me, OperationsService ops, CancellationToken ct) =>
            Data(await ops.DashboardAsync(me, branchId, days, ct)));
        api.MapPost("/transactions", async (CreateTransactionCommand body, HttpContext http, ICurrentContext me, OperationsService ops, CancellationToken ct) =>
            Created(await ops.CreateTransactionAsync(me, body, Key(http), ct)));
        api.MapGet("/transactions/{id:guid}", async (Guid id, ICurrentContext me, OperationsService ops, CancellationToken ct) =>
            Data(await ops.GetTransactionAsync(me, id, ct)));
        api.MapGet("/transactions/to-pay", async (Guid branchId, string? q, ICurrentContext me, OperationsService ops, CancellationToken ct) =>
            Data(await ops.ToPayAsync(me, branchId, q, ct)));
        api.MapPost("/transactions/{id:guid}/pay", async (Guid id, PayTransactionCommand body, ICurrentContext me, OperationsService ops, CancellationToken ct) =>
            Created(await ops.PayTransactionAsync(me, id, body, ct)));
        api.MapGet("/settings", async (ICurrentContext me, OperationsService ops, CancellationToken ct) =>
            Data(await ops.GetSettingsAsync(me, ct)));
        api.MapPut("/settings", async (JsonObject body, ICurrentContext me, OperationsService ops, CancellationToken ct) =>
            Data(await ops.SetSettingsAsync(me, body, ct)));
        api.MapPost("/transactions/{id:guid}/payments/{paymentId:guid}/confirm", async (Guid id, Guid paymentId, ICurrentContext me, OperationsService ops, CancellationToken ct) =>
            Data(await ops.ResolvePaymentAsync(me, paymentId, true, null, ct)));
        api.MapPost("/transactions/{id:guid}/payments/{paymentId:guid}/fail", async (Guid id, Guid paymentId, [FromBody] ResolvePaymentCommand? body, ICurrentContext me, OperationsService ops, CancellationToken ct) =>
            Data(await ops.ResolvePaymentAsync(me, paymentId, false, body, ct)));
        api.MapGet("/payments/pending", async (Guid branchId, string? role, ICurrentContext me, OperationsService ops, CancellationToken ct) =>
            Data(await ops.PendingPaymentsAsync(me, branchId, role, ct)));
        api.MapGet("/customers", async (string? q, Guid? branchId, int? limit, ICurrentContext me, OperationsService ops, CancellationToken ct) =>
            Data(await ops.SearchCustomersAsync(me, q, branchId, limit, ct)));

        api.MapGet("/exchanges", async (Guid branchId, int? limit, ICurrentContext me, OperationsService ops, CancellationToken ct) =>
            Data(await ops.ListExchangesAsync(me, branchId, limit, ct)));
        api.MapGet("/expectations", async (Guid? townId, Guid? customerId, ICurrentContext me, OperationsService ops, CancellationToken ct) =>
            Data(await ops.ExpectationsAsync(me, townId, customerId, ct)));
        api.MapGet("/towns", async (string? q, ICurrentContext me, OperationsService ops, CancellationToken ct) =>
            Data(await ops.TownsAsync(me, q, ct)));
        api.MapPost("/towns", async (TownRef body, ICurrentContext me, OperationsService ops, CancellationToken ct) =>
            Data(await ops.CreateTownAsync(me, body, ct)));

        // ---- debts, loans, security ----
        api.MapGet("/debts", async (Guid branchId, string? direction, bool? openOnly, Guid? customerId, ICurrentContext me, OperationsService ops, CancellationToken ct) =>
            Data(await ops.ListDebtsAsync(me, branchId, direction, openOnly ?? false, customerId, ct)));
        api.MapGet("/debts/{id:guid}", async (Guid id, ICurrentContext me, OperationsService ops, CancellationToken ct) =>
            Data(await ops.GetDebtAsync(me, id, ct)));
        api.MapPost("/debts/loans", async (LoanCommand body, HttpContext http, ICurrentContext me, OperationsService ops, CancellationToken ct) =>
            Created(await ops.IssueLoanAsync(me, body, Key(http), ct)));
        api.MapPost("/debts/{id:guid}/repayments", async (Guid id, RepaymentCommand body, HttpContext http, ICurrentContext me, OperationsService ops, CancellationToken ct) =>
            Created(await ops.RepayDebtAsync(me, id, body, Key(http), ct)));
        api.MapGet("/collateral", async (Guid branchId, string? status, ICurrentContext me, OperationsService ops, CancellationToken ct) =>
            Data(await ops.ListCollateralAsync(me, branchId, status, ct)));
        api.MapPost("/collateral/{id:guid}/return", async (Guid id, ReturnCollateralBody? body, ICurrentContext me, OperationsService ops, CancellationToken ct) =>
            Data(await ops.ReturnCollateralAsync(me, id, body?.Note, ct)));
        return api;
    }
}

public sealed record ReturnCollateralBody(string? Note);