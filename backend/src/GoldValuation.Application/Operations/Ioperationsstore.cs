using GoldValuation.Application.Abstractions;
using GoldValuation.Domain.Calculation;

namespace GoldValuation.Application.Operations;

/// <summary>
/// The persistence the operations services need. Every method runs as the signed-in user inside their company; the
/// all-or-nothing rules are database functions (db/migrations/0011), so each call is one transaction. Results are JSON text
/// already shaped like the API contract, passed straight through.
/// </summary>
public interface IOperationsStore
{
    Task<CalcConfig> GetCalcConfigAsync(ICurrentContext me, string formulaVersion, CancellationToken ct);

    Task<string?> GetCurrentPriceAsync(ICurrentContext me, Guid branchId, CancellationToken ct);
    /// <summary>The price a branch has paid over time and what it bought each day (migration 0056).</summary>
    Task<string> PriceHistoryAsync(ICurrentContext me, Guid branchId, int days, CancellationToken ct);
    Task SetBasePriceAsync(ICurrentContext me, decimal basePrice, DateTimeOffset? publishedAt, CancellationToken ct);
    Task<string> SetMarginAsync(ICurrentContext me, Guid branchId, decimal margin, bool approve, CancellationToken ct);
    Task<string> ApproveMarginAsync(ICurrentContext me, Guid branchId, CancellationToken ct);

    Task<string> DayStateAsync(ICurrentContext me, Guid branchId, CancellationToken ct);
    Task<DbResult> OpenDayAsync(ICurrentContext me, string payloadJson, CancellationToken ct);
    Task<DbResult> RecordMovementAsync(ICurrentContext me, string payloadJson, CancellationToken ct);
    Task<string> ListExchangesAsync(ICurrentContext me, Guid branchId, int limit, CancellationToken ct);
    Task<DbResult> RecordExchangeAsync(ICurrentContext me, string payloadJson, CancellationToken ct);
    Task<string?> GetDayAsync(ICurrentContext me, Guid dayId, CancellationToken ct);
    Task<string> ListDaysAsync(ICurrentContext me, Guid branchId, DateOnly? fromDate, DateOnly? toDate, string? signoff, int limit, CancellationToken ct);
    Task<string> DayActivityAsync(ICurrentContext me, Guid dayId, CancellationToken ct);
    Task<string> ClosingPreviewAsync(ICurrentContext me, Guid dayId, CancellationToken ct);
    Task<DbResult> CloseDayAsync(ICurrentContext me, string payloadJson, CancellationToken ct);
    Task<string> SignoffDayAsync(ICurrentContext me, Guid dayId, string decision, string? note, CancellationToken ct);

    Task<DbResult> PostTransactionAsync(ICurrentContext me, string payloadJson, CancellationToken ct);
    Task<string> ListTransactionsAsync(ICurrentContext me, Guid branchId, int limit, CancellationToken ct);
    /// <summary>Filtered, sorted, paged purchases as { items, total, sumPayable } (database function transactions_search). The filter is JSON.</summary>
    Task<string> SearchTransactionsAsync(ICurrentContext me, string filterJson, CancellationToken ct);
    Task<string> DashboardAsync(ICurrentContext me, string filterJson, CancellationToken ct);
    Task<string> BranchPerformanceAsync(ICurrentContext me, string filterJson, CancellationToken ct);
    Task<string?> GetTransactionAsync(ICurrentContext me, Guid id, CancellationToken ct);
    Task<string> ResolvePaymentAsync(ICurrentContext me, Guid paymentId, string outcome, string? replacementsJson, CancellationToken ct);
    /// <summary>Cancels a purchase and puts back what it did (migration 0057). <paramref name="json"/>: { id, reason }.</summary>
    Task<string> CancelTransactionAsync(ICurrentContext me, string json, CancellationToken ct);

    Task<DbResult> PayTransactionAsync(ICurrentContext me, string payloadJson, CancellationToken ct);
    /// <summary>Purchases of a branch waiting to be paid out, newest first; the search matches number, name or phone.</summary>
    Task<string> ToPayAsync(ICurrentContext me, Guid branchId, string? search, CancellationToken ct);
    Task<string> GetSettingsAsync(ICurrentContext me, CancellationToken ct);
    Task<string> SetSettingsAsync(ICurrentContext me, string settingsJson, CancellationToken ct);

    Task<string> PendingPaymentsAsync(ICurrentContext me, Guid branchId, string role, CancellationToken ct);
    Task<string> ExpectationsAsync(ICurrentContext me, Guid? townId, Guid? customerId, CancellationToken ct);
    Task<string> ListTownsAsync(ICurrentContext me, string? query, CancellationToken ct);
    Task<string> CreateTownAsync(ICurrentContext me, string payloadJson, CancellationToken ct);
    Task<string> SearchCustomersAsync(ICurrentContext me, string? query, Guid? branchId, int limit, CancellationToken ct);

    Task<DbResult> IssueLoanAsync(ICurrentContext me, string payloadJson, CancellationToken ct);
    Task<DbResult> RepayDebtAsync(ICurrentContext me, string payloadJson, CancellationToken ct);
    /// <summary>Open amounts a customer owes across the caller's branches, as JSON { items, total, elsewhere }.</summary>
    Task<string> CustomerDebtsAsync(ICurrentContext me, Guid customerId, CancellationToken ct);
    Task<string> ListDebtsAsync(ICurrentContext me, Guid branchId, string? direction, bool openOnly, Guid? customerId, CancellationToken ct);
    Task<string?> GetDebtAsync(ICurrentContext me, Guid id, CancellationToken ct);
    Task<string> ListCollateralAsync(ICurrentContext me, Guid branchId, string? status, CancellationToken ct);
    Task<string?> GetCollateralAsync(ICurrentContext me, Guid id, CancellationToken ct);
    Task<string> ReturnCollateralAsync(ICurrentContext me, Guid id, string? note, CancellationToken ct);
}