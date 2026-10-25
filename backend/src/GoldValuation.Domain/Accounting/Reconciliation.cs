namespace GoldValuation.Domain.Accounting;

public enum ReconciliationOutcome { Balanced, Surplus, Shortage }

/// <summary>
/// The six things a day is reconciled on. Matches the asset column of gold.day_reconciliations.
/// Debt = owed TO the branch; Payable = owed BY the branch (for example to a customer who was not paid in full).
/// </summary>
public enum ReconciledAsset { Cash, GoodsTop, GoodsDown, GoodsValue, Debt, Payable }

public sealed record AssetFigures(
    decimal CashValue,
    IReadOnlyDictionary<int, int> CashLines,
    decimal GoodsTop,
    decimal GoodsDown,
    decimal GoodsValue,
    decimal DebtValue,
    decimal PayableValue)
{
    public decimal Get(ReconciledAsset asset) => asset switch
    {
        ReconciledAsset.Cash => CashValue,
        ReconciledAsset.GoodsTop => GoodsTop,
        ReconciledAsset.GoodsDown => GoodsDown,
        ReconciledAsset.GoodsValue => GoodsValue,
        ReconciledAsset.Debt => DebtValue,
        ReconciledAsset.Payable => PayableValue,
        _ => throw new ArgumentOutOfRangeException(nameof(asset)),
    };
}

public sealed record AssetReconciliation(
    ReconciledAsset Asset,
    decimal Expected,
    decimal Actual,
    decimal Difference,
    ReconciliationOutcome Outcome,
    bool NeedsExplanation);

public static class Reconciliation
{
    /// <summary>The same rule the database enforces: any difference needs a written explanation of at least 5 characters.</summary>
    public const int MinExplanationLength = 5;

    public static ReconciliationOutcome Outcome(decimal expected, decimal actual) =>
        actual == expected ? ReconciliationOutcome.Balanced
        : actual > expected ? ReconciliationOutcome.Surplus
        : ReconciliationOutcome.Shortage;

    public static IReadOnlyList<AssetReconciliation> Compare(AssetFigures expected, AssetFigures actual) =>
        Enum.GetValues<ReconciledAsset>()
            .Select(asset =>
            {
                var e = expected.Get(asset);
                var a = actual.Get(asset);
                var outcome = Outcome(e, a);
                return new AssetReconciliation(asset, e, a, a - e, outcome, outcome != ReconciliationOutcome.Balanced);
            })
            .ToList();

    /// <summary>Which differences are still missing an acceptable explanation. Empty means the day may be closed.</summary>
    public static IReadOnlyList<ReconciledAsset> MissingExplanations(
        IEnumerable<AssetReconciliation> rows, IReadOnlyDictionary<ReconciledAsset, string?> explanations) =>
        rows.Where(r => r.NeedsExplanation
                        && (!explanations.TryGetValue(r.Asset, out var text) || (text?.Trim().Length ?? 0) < MinExplanationLength))
            .Select(r => r.Asset)
            .ToList();
}
