using GoldValuation.Domain.Accounting;
using Xunit;

namespace GoldValuation.Domain.Tests;

public class AccountingTests
{
    private static AssetFigures Figures(decimal cash, decimal top, decimal down, decimal value, decimal debt, decimal payable = 0) =>
        new(cash, new Dictionary<int, int>(), top, down, value, debt, payable);

    [Fact]
    public void Everything_matching_is_balanced_and_needs_no_explanation()
    {
        var f = Figures(7920, 1003, 55.17m, 94080, 2300);
        var rows = Reconciliation.Compare(f, f);
        Assert.All(rows, r => Assert.Equal(ReconciliationOutcome.Balanced, r.Outcome));
        Assert.Empty(Reconciliation.MissingExplanations(rows, new Dictionary<ReconciledAsset, string?>()));
    }

    [Fact]
    public void A_cash_shortage_is_labelled_and_demands_an_explanation()
    {
        var expected = Figures(7920, 1003, 55.17m, 94080, 2300);
        var actual = Figures(7820, 1003, 55.17m, 94080, 2300);
        var rows = Reconciliation.Compare(expected, actual);

        var cash = rows.Single(r => r.Asset == ReconciledAsset.Cash);
        Assert.Equal(ReconciliationOutcome.Shortage, cash.Outcome);
        Assert.Equal(-100m, cash.Difference);
        Assert.True(cash.NeedsExplanation);

        Assert.Equal(new[] { ReconciledAsset.Cash }, Reconciliation.MissingExplanations(rows, new Dictionary<ReconciledAsset, string?>()));
        Assert.Equal(new[] { ReconciledAsset.Cash }, Reconciliation.MissingExplanations(rows, new Dictionary<ReconciledAsset, string?> { [ReconciledAsset.Cash] = " ok " }));
        Assert.Empty(Reconciliation.MissingExplanations(rows, new Dictionary<ReconciledAsset, string?> { [ReconciledAsset.Cash] = "Extra note given by mistake" }));
    }

    [Fact]
    public void An_unrecorded_amount_owed_to_a_customer_is_caught()
    {
        var rows = Reconciliation.Compare(Figures(1000, 0, 0, 0, 0, payable: 0), Figures(1000, 0, 0, 0, 0, payable: 500));
        var payable = rows.Single(r => r.Asset == ReconciledAsset.Payable);
        Assert.Equal(ReconciliationOutcome.Surplus, payable.Outcome);
        Assert.True(payable.NeedsExplanation);
        Assert.Equal(6, rows.Count);
    }

    [Fact]
    public void A_weight_surplus_is_labelled_surplus()
    {
        var rows = Reconciliation.Compare(Figures(0, 10, 1, 0, 0), Figures(0, 10.5m, 1, 0, 0));
        Assert.Equal(ReconciliationOutcome.Surplus, rows.Single(r => r.Asset == ReconciledAsset.GoodsTop).Outcome);
    }

    [Fact]
    public void Note_lines_add_subtract_and_drop_zeroes()
    {
        var a = new Dictionary<int, int> { [100] = 10, [50] = 2 };
        var b = new Dictionary<int, int> { [100] = 4, [20] = 1 };
        Assert.Equal(new Dictionary<int, int> { [100] = 6, [50] = 2, [20] = -1 }, NoteLines.Subtract(a, b));
        Assert.Equal(new Dictionary<int, int> { [50] = 2 }, NoteLines.Subtract(a, new Dictionary<int, int> { [100] = 10 }));
        Assert.Equal(1220m, NoteLines.Value(new Dictionary<int, int> { [100] = 12, [20] = 1 }));
    }

    [Fact]
    public void Closing_confirmation_needs_the_box_ticked_and_the_current_wording()
    {
        Assert.True(ClosingConfirmation.Accepts(true, ClosingConfirmation.Current.Version));
        Assert.False(ClosingConfirmation.Accepts(false, ClosingConfirmation.Current.Version));
        Assert.False(ClosingConfirmation.Accepts(true, "v0"));
        Assert.False(ClosingConfirmation.Accepts(true, "v1"));   // the old wording is no longer accepted for new closings
        Assert.False(ClosingConfirmation.Accepts(true, null));
    }
}
