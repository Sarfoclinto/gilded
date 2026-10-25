namespace GoldValuation.Application.Operations;

/// <summary>
/// The statement a teller accepts to close a day. The exact wording they saw is stored with the day. Wording never changes under a
/// version: new wording is a new version, and a device still showing an old one is told to fetch the current one.
/// </summary>
public static class ClosingConfirmation
{
    public const string CurrentVersion = "v3";

    public const string CurrentText =
        "I confirm that I have physically verified and accounted for the cash, the total top weight, the total down weight, " +
        "the value of goods, the debts owed to the branch, the amounts the branch owes, and the unrefined gold held as security, " +
        "as reported above. I understand that every difference I report is recorded and will be reviewed.";

    /// <summary>The wording of a version this server still accepts (only the current one).</summary>
    public static bool TryGet(string? version, out string text)
    {
        text = CurrentText;
        return version == CurrentVersion;
    }
}
