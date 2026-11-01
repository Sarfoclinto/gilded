using System.Globalization;
using System.Text.Json;
using GoldValuation.Application.Abstractions;
using GoldValuation.Application.Operations;
using GoldValuation.Domain.Calculation;
using GoldValuation.Infrastructure.Persistence;
using Microsoft.Extensions.Logging;
using Npgsql;
using NpgsqlTypes;

namespace GoldValuation.Infrastructure.Operations;

/// <summary>
/// Calls the database functions of migrations 0011 and 0012. Every call is one transaction for the caller's company, committed at the end;
/// a refusal (a function raising GVnnn) or any error rolls everything back. The function's JSON is returned untouched.
/// </summary>
public sealed class PostgresOperationsStore(NpgsqlDataSource dataSource, ILogger<PostgresOperationsStore> log) : IOperationsStore
{
    public async Task<CalcConfig> GetCalcConfigAsync(ICurrentContext me, string formulaVersion, CancellationToken ct)
    {
        var json = await Scalar(me, "select params::text from gold.formula_versions where key = $1", ct, new NpgsqlParameter { Value = formulaVersion })
                   ?? throw new AppException("FORMULA_NOT_CONFIGURED", "The calculation settings are missing for this company. Run the seed command.", 409);
        using var doc = JsonDocument.Parse(json);
        var d = CalcConfig.ExcelV1;
        decimal Read(string name, decimal fallback) =>
            doc.RootElement.TryGetProperty(name, out var v)
                ? v.ValueKind == JsonValueKind.Number ? v.GetDecimal() : decimal.Parse(v.GetString()!, CultureInfo.InvariantCulture)
                : fallback;
        return new CalcConfig(formulaVersion, Read("correctionRate", d.CorrectionRate), Read("poundGrams", d.PoundGrams),
            Read("priceReferenceKarat", d.PriceReferenceKarat), Read("densityOffset", d.DensityOffset), Read("densityScale", d.DensityScale));
    }

    public Task<string?> GetCurrentPriceAsync(ICurrentContext me, Guid branchId, CancellationToken ct) =>
        Scalar(me, "select gold.current_price($1)", ct, Uuid(branchId));

    public async Task SetBasePriceAsync(ICurrentContext me, decimal basePrice, DateTimeOffset? publishedAt, CancellationToken ct) =>
        await Scalar(me, "select gold.set_base_price($1, $2)", ct,
            new NpgsqlParameter { NpgsqlDbType = NpgsqlDbType.Numeric, Value = basePrice },
            new NpgsqlParameter { NpgsqlDbType = NpgsqlDbType.TimestampTz, Value = (object?)publishedAt?.ToUniversalTime() ?? DBNull.Value });

    public async Task<string> SetMarginAsync(ICurrentContext me, Guid branchId, decimal margin, bool approve, CancellationToken ct) =>
        (await Scalar(me, "select gold.set_margin($1, $2, $3)", ct, Uuid(branchId),
            new NpgsqlParameter { NpgsqlDbType = NpgsqlDbType.Numeric, Value = margin },
            new NpgsqlParameter { NpgsqlDbType = NpgsqlDbType.Boolean, Value = approve }))!;

    public async Task<string> ApproveMarginAsync(ICurrentContext me, Guid branchId, CancellationToken ct) =>
        (await Scalar(me, "select gold.approve_margin($1)", ct, Uuid(branchId)))!;

    public async Task<string> DayStateAsync(ICurrentContext me, Guid branchId, CancellationToken ct) =>
        (await Scalar(me, "select gold.day_state($1)", ct, Uuid(branchId)))!;

    public async Task<DbResult> OpenDayAsync(ICurrentContext me, string payloadJson, CancellationToken ct) =>
        Result(await Scalar(me, "select gold.open_day($1)", ct, Json(payloadJson)));

    public async Task<DbResult> RecordMovementAsync(ICurrentContext me, string payloadJson, CancellationToken ct) =>
        Result(await Scalar(me, "select gold.record_movement($1)", ct, Json(payloadJson)));

    public async Task<string> ListExchangesAsync(ICurrentContext me, Guid branchId, int limit, CancellationToken ct) =>
        (await Scalar(me, "select gold.exchanges_json($1, $2)", ct, Uuid(branchId), new NpgsqlParameter { NpgsqlDbType = NpgsqlDbType.Integer, Value = limit }))!;

    public async Task<DbResult> RecordExchangeAsync(ICurrentContext me, string payloadJson, CancellationToken ct) =>
        Result(await Scalar(me, "select gold.record_exchange($1)", ct, Json(payloadJson)));

    public Task<string?> GetDayAsync(ICurrentContext me, Guid dayId, CancellationToken ct) =>
        Scalar(me, "select gold.day_json($1)", ct, Uuid(dayId));

    public async Task<string> ListDaysAsync(ICurrentContext me, Guid branchId, DateOnly? fromDate, DateOnly? toDate, string? signoff, int limit, CancellationToken ct) =>
        (await Scalar(me, "select gold.days_json($1, $2, $3, $4, $5)", ct, Uuid(branchId),
            new NpgsqlParameter { NpgsqlDbType = NpgsqlDbType.Date, Value = (object?)fromDate ?? DBNull.Value },
            new NpgsqlParameter { NpgsqlDbType = NpgsqlDbType.Date, Value = (object?)toDate ?? DBNull.Value },
            new NpgsqlParameter { NpgsqlDbType = NpgsqlDbType.Text, Value = (object?)signoff ?? DBNull.Value },
            new NpgsqlParameter { NpgsqlDbType = NpgsqlDbType.Integer, Value = limit }))!;

    public async Task<string> DayActivityAsync(ICurrentContext me, Guid dayId, CancellationToken ct) =>
        (await Scalar(me, "select gold.day_activity_json($1)", ct, Uuid(dayId)))!;

    public async Task<string> ClosingPreviewAsync(ICurrentContext me, Guid dayId, CancellationToken ct) =>
        (await Scalar(me, "select gold.closing_preview($1)", ct, Uuid(dayId)))!;

    public async Task<DbResult> CloseDayAsync(ICurrentContext me, string payloadJson, CancellationToken ct) =>
        Result(await Scalar(me, "select gold.close_day($1)", ct, Json(payloadJson)));

    public async Task<string> SignoffDayAsync(ICurrentContext me, Guid dayId, string decision, string? note, CancellationToken ct) =>
        (await Scalar(me, "select gold.signoff_day($1, $2, $3)", ct, Uuid(dayId),
            new NpgsqlParameter { NpgsqlDbType = NpgsqlDbType.Text, Value = decision },
            new NpgsqlParameter { NpgsqlDbType = NpgsqlDbType.Text, Value = (object?)note ?? DBNull.Value }))!;

    public async Task<DbResult> PostTransactionAsync(ICurrentContext me, string payloadJson, CancellationToken ct) =>
        Result(await Scalar(me, "select gold.post_transaction($1)", ct, Json(payloadJson)));

    public async Task<string> ListTransactionsAsync(ICurrentContext me, Guid branchId, int limit, CancellationToken ct) =>
        (await Scalar(me, "select gold.transactions_json($1, $2)", ct, Uuid(branchId), new NpgsqlParameter { NpgsqlDbType = NpgsqlDbType.Integer, Value = limit }))!;

    public async Task<string> SearchTransactionsAsync(ICurrentContext me, string filterJson, CancellationToken ct) =>
        (await Scalar(me, "select gold.transactions_search($1)", ct, new NpgsqlParameter { NpgsqlDbType = NpgsqlDbType.Jsonb, Value = filterJson }))!;

    public async Task<string> DashboardAsync(ICurrentContext me, string filterJson, CancellationToken ct) =>
        (await Scalar(me, "select gold.dashboard_json($1)", ct, new NpgsqlParameter { NpgsqlDbType = NpgsqlDbType.Jsonb, Value = filterJson }))!;

    public Task<string?> GetTransactionAsync(ICurrentContext me, Guid id, CancellationToken ct) =>
        Scalar(me, "select gold.transaction_json($1)", ct, Uuid(id));

    public async Task<string> ResolvePaymentAsync(ICurrentContext me, Guid paymentId, string outcome, string? replacementsJson, CancellationToken ct) =>
        (await Scalar(me, "select gold.resolve_payment($1, $2, $3, $4)", ct, Uuid(paymentId),
            new NpgsqlParameter { NpgsqlDbType = NpgsqlDbType.Text, Value = outcome },
            new NpgsqlParameter { NpgsqlDbType = NpgsqlDbType.Array | NpgsqlDbType.Uuid, Value = me.BranchIds.ToArray() },
            new NpgsqlParameter { NpgsqlDbType = NpgsqlDbType.Jsonb, Value = (object?)replacementsJson ?? DBNull.Value }))!;

    public async Task<DbResult> PayTransactionAsync(ICurrentContext me, string payloadJson, CancellationToken ct) =>
        Result(await Scalar(me, "select gold.pay_transaction($1)", ct, Json(payloadJson)));

    public async Task<string> ToPayAsync(ICurrentContext me, Guid branchId, string? search, CancellationToken ct) =>
        (await Scalar(me, "select gold.to_pay_json($1, $2)", ct, Uuid(branchId),
            new NpgsqlParameter { NpgsqlDbType = NpgsqlDbType.Text, Value = (object?)search ?? DBNull.Value }))!;

    public async Task<string> GetSettingsAsync(ICurrentContext me, CancellationToken ct) =>
        (await Scalar(me, "select gold.settings_json()", ct))!;

    public async Task<string> SetSettingsAsync(ICurrentContext me, string settingsJson, CancellationToken ct) =>
        (await Scalar(me, "select gold.set_settings($1)", ct, Json(settingsJson)))!;

    public async Task<string> PendingPaymentsAsync(ICurrentContext me, Guid branchId, string role, CancellationToken ct) =>
        (await Scalar(me, "select gold.pending_payments_json($1, $2)", ct, Uuid(branchId),
            new NpgsqlParameter { NpgsqlDbType = NpgsqlDbType.Text, Value = role }))!;

    public async Task<string> ExpectationsAsync(ICurrentContext me, Guid? townId, Guid? customerId, CancellationToken ct) =>
        (await Scalar(me, "select gold.expect_json($1, $2)", ct,
            new NpgsqlParameter { NpgsqlDbType = NpgsqlDbType.Uuid, Value = (object?)townId ?? DBNull.Value },
            new NpgsqlParameter { NpgsqlDbType = NpgsqlDbType.Uuid, Value = (object?)customerId ?? DBNull.Value }))!;

    public async Task<string> ListTownsAsync(ICurrentContext me, string? query, CancellationToken ct) =>
        (await Scalar(me, "select gold.towns_json($1)", ct, new NpgsqlParameter { NpgsqlDbType = NpgsqlDbType.Text, Value = (object?)query ?? DBNull.Value }))!;

    public async Task<string> CreateTownAsync(ICurrentContext me, string payloadJson, CancellationToken ct) =>
        (await Scalar(me, "select gold.create_town($1)", ct, Json(payloadJson)))!;

    public async Task<string> SearchCustomersAsync(ICurrentContext me, string? query, Guid? branchId, int limit, CancellationToken ct) =>
        (await Scalar(me, "select gold.customers_lookup_json($1, $2, $3)", ct,
            new NpgsqlParameter { NpgsqlDbType = NpgsqlDbType.Text, Value = (object?)query ?? DBNull.Value },
            new NpgsqlParameter { NpgsqlDbType = NpgsqlDbType.Uuid, Value = (object?)branchId ?? DBNull.Value },
            new NpgsqlParameter { NpgsqlDbType = NpgsqlDbType.Integer, Value = limit }))!;

    public async Task<DbResult> IssueLoanAsync(ICurrentContext me, string payloadJson, CancellationToken ct) =>
        Result(await Scalar(me, "select gold.issue_loan($1)", ct, Json(payloadJson)));

    public async Task<DbResult> RepayDebtAsync(ICurrentContext me, string payloadJson, CancellationToken ct) =>
        Result(await Scalar(me, "select gold.repay_debt($1)", ct, Json(payloadJson)));

    public async Task<string> ListDebtsAsync(ICurrentContext me, Guid branchId, string? direction, bool openOnly, Guid? customerId, CancellationToken ct) =>
        (await Scalar(me, "select gold.debts_json($1, $2, $3, $4)", ct, Uuid(branchId),
            new NpgsqlParameter { NpgsqlDbType = NpgsqlDbType.Text, Value = (object?)direction ?? DBNull.Value },
            new NpgsqlParameter { NpgsqlDbType = NpgsqlDbType.Boolean, Value = openOnly },
            new NpgsqlParameter { NpgsqlDbType = NpgsqlDbType.Uuid, Value = (object?)customerId ?? DBNull.Value }))!;

    public Task<string?> GetDebtAsync(ICurrentContext me, Guid id, CancellationToken ct) =>
        Scalar(me, "select gold.debt_json($1)", ct, Uuid(id));

    public async Task<string> ListCollateralAsync(ICurrentContext me, Guid branchId, string? status, CancellationToken ct) =>
        (await Scalar(me, "select gold.collateral_list_json($1, $2)", ct, Uuid(branchId),
            new NpgsqlParameter { NpgsqlDbType = NpgsqlDbType.Text, Value = (object?)status ?? DBNull.Value }))!;

    public Task<string?> GetCollateralAsync(ICurrentContext me, Guid id, CancellationToken ct) =>
        Scalar(me, "select gold.collateral_json($1)", ct, Uuid(id));

    public async Task<string> ReturnCollateralAsync(ICurrentContext me, Guid id, string? note, CancellationToken ct) =>
        (await Scalar(me, "select gold.return_collateral($1, $2)", ct, Uuid(id),
            new NpgsqlParameter { NpgsqlDbType = NpgsqlDbType.Text, Value = (object?)note ?? DBNull.Value }))!;

    // ------------------------------------------------------------------------------------------------
    private async Task<string?> Scalar(ICurrentContext me, string sql, CancellationToken ct, params NpgsqlParameter[] args)
    {
        try
        {
            await using var session = await TenantSession.BeginAsync(dataSource, me.TenantId, me.UserId, ct);
            await using var cmd = new NpgsqlCommand(sql, session.Connection, session.Transaction);
            foreach (var a in args) cmd.Parameters.Add(a);
            var value = await cmd.ExecuteScalarAsync(ct);
            await session.CommitAsync(ct);   // deferred checks (payment parts must add up) fire here
            return (value is null or DBNull) ? null : (string)value;
        }
        catch (PostgresException ex) when (Translate(ex, log) is { } app)
        {
            throw app;
        }
    }

    private static NpgsqlParameter Uuid(Guid id) => new() { NpgsqlDbType = NpgsqlDbType.Uuid, Value = id };

    private static NpgsqlParameter Json(string json) => new() { NpgsqlDbType = NpgsqlDbType.Jsonb, Value = json };

    private static DbResult Result(string? json)
    {
        using var doc = JsonDocument.Parse(json ?? throw new InvalidOperationException("The database returned nothing."));
        return new DbResult(doc.RootElement.GetProperty("replayed").GetBoolean(), doc.RootElement.GetProperty("data").GetRawText());
    }

    /// <summary>
    /// Database refusals carry 'CODE|message' with SQLSTATE GV&lt;http status&gt; (see migration 0011). Malformed values and broken
    /// references become a 422 instead of a 500, because they come from the request, not from a fault in the server.
    /// </summary>
    internal static AppException? Translate(PostgresException ex, ILogger log)
    {
        if (ex.SqlState.Length == 5 && ex.SqlState.StartsWith("GV", StringComparison.Ordinal) && int.TryParse(ex.SqlState.AsSpan(2), out var status))
        {
            var bar = ex.MessageText.IndexOf('|');
            return bar > 0
                ? new AppException(ex.MessageText[..bar], ex.MessageText[(bar + 1)..], status)
                : new AppException("ERROR", ex.MessageText, status);
        }
        if (ex.SqlState == PostgresErrorCodes.UniqueViolation)
            return new AppException("DUPLICATE", "One of the ids in this request is already in use.", 409);
        if (ex.SqlState.StartsWith("22", StringComparison.Ordinal) || ex.SqlState is "23502" or "23503" or "23514")
        {
            log.LogWarning(ex, "Request rejected by the database ({State})", ex.SqlState);
            return new AppException("VALIDATION_FAILED", "Some values in the request are not valid.", 422);
        }
        return null;
    }
}