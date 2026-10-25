namespace GoldValuation.Domain.Accounting;

/// <summary>
/// The statement a teller must accept before a day can be closed. Versioned, and the exact text shown is stored with the day,
/// so what they agreed to can always be proven. Change the wording by adding a new version, never by editing an old one.
/// </summary>
public sealed record ClosingConfirmation(string Version, string Text)
{
    public static readonly ClosingConfirmation V1 = new(
        "v1",
        "I confirm that I have physically verified and accounted for the cash, total top weight, total down weight, " +
        "value of goods and outstanding debts reported above, and that the figures are true to the best of my knowledge.");

    /// <summary>v2 names debts owed to the branch and amounts the branch owes, now that both are reconciled.</summary>
    public static readonly ClosingConfirmation V2 = new(
        "v2",
        "I confirm that I have physically verified and accounted for the cash, total top weight, total down weight, " +
        "value of goods, debts owed to the branch and amounts the branch owes, as reported above, " +
        "and that the figures are true to the best of my knowledge.");

    public static ClosingConfirmation Current => V2;

    /// <summary>The API accepts a close only when the client says it showed this version and the box was ticked.</summary>
    public static bool Accepts(bool ticked, string? versionShown) => ticked && versionShown == Current.Version;
}
