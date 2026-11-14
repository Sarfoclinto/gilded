namespace GoldValuation.Application.Auth;

/// <summary>
/// Permission keys, <c>resource:action</c>. Keep in step with web/src/config/permissions.ts.
/// The API enforces them; the UI only hides what a person cannot do.
/// </summary>
public static class Permissions
{
    public const string CalculatorUse = "calculator:use";
    public const string TransactionsRead = "transactions:read";
    public const string TransactionsCreate = "transactions:create";
    public const string DaysRead = "days:read";
    public const string DaysManage = "days:manage";
    public const string DaysSignoff = "days:signoff";
    public const string PricesApprove = "prices:approve";
    public const string KumasiSetValue = "kumasi:set-value";
    public const string ReportsRead = "reports:read";
    public const string UsersManage = "users:manage";
    public const string DebtsRead = "debts:read";
    /// <summary>Lend, record repayments, hand back security.</summary>
    public const string DebtsManage = "debts:manage";
    /// <summary>Confirm that mobile money this branch sent has arrived, or mark it failed.</summary>
    public const string PaymentsConfirm = "payments:confirm";
    /// <summary>See and work in every active branch of the company, not just assigned ones.</summary>
    public const string BranchesAll = "branches:all";
    /// <summary>See the customer list and a customer's history.</summary>
    public const string CustomersRead = "customers:read";
    /// <summary>Add and edit customers and merge duplicates. Give it to a teller as a personal grant when needed.</summary>
    public const string CustomersManage = "customers:manage";
    /// <summary>Add branches and switch them on or off.</summary>
    public const string BranchesManage = "branches:manage";

    /// <summary>See transfers that start or end at a branch the person works in.</summary>
    public const string TransfersRead = "transfers:read";
    /// <summary>Draft, release, pay and cancel transfers from a branch the person works in (the sending end).</summary>
    public const string TransfersCreate = "transfers:create";
    /// <summary>Receive transfers at a branch the person works in, confirming each line (the receiving end).</summary>
    public const string TransfersReceive = "transfers:receive";

    /// <summary>Work the inbox of discrepancy cases (take, note, resolve, reopen) for the branches the person can see.</summary>
    public const string DiscrepanciesReview = "discrepancies:review";

    /// <summary>Bring in customers and past purchases from spreadsheets, and undo an import. Directors only.</summary>
    public const string ImportsManage = "imports:manage";

    /// <summary>Read the audit trail: who did what, when and where. Directors only.</summary>
    public const string AuditRead = "audit:read";

    /// <summary>Change the company's settings: two-step payout, receipts, the office allowance. Directors only.</summary>
    public const string SettingsManage = "settings:manage";
    /// <summary>Write and publish the business's rules and guides, and set the reminders to read them. Directors only. Everyone can read the Guide.</summary>
    public const string GuideManage = "guide:manage";
    /// <summary>Review offline entries that could not be applied (held or rejected), then retry or dismiss them.</summary>
    public const string SyncReview = "sync:review";
    /// <summary>Change notes for the branch itself (smaller notes for change, bigger notes to hand out fewer), without a purchase.</summary>
    public const string NotesExchange = "notes:exchange";
    /// <summary>Cancel a wrongly saved purchase, with a reason: the gold and the cash are put back by new entries; the original is kept.</summary>
    public const string TransactionsCancel = "transactions:cancel";

    /// <summary>Every permission the system knows, for validating what a custom role is given.</summary>
    public static IReadOnlySet<string> All { get; } = typeof(Permissions)
        .GetFields(System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.Static)
        .Where(f => f is { IsLiteral: true, IsInitOnly: false } && f.FieldType == typeof(string))
        .Select(f => (string)f.GetRawConstantValue()!)
        .ToHashSet();

    private static readonly string[] Teller =
        [CalculatorUse, TransactionsRead, TransactionsCreate, DaysRead, DaysManage, DebtsRead, DebtsManage, CustomersRead,
         TransfersRead, TransfersCreate, TransfersReceive];

    private static readonly string[] Manager =
        [.. Teller, DaysSignoff, KumasiSetValue, ReportsRead, BranchesAll, PaymentsConfirm, CustomersManage, DiscrepanciesReview, NotesExchange, SyncReview, TransactionsCancel];

    private static readonly string[] Director =
        [.. Manager, PricesApprove, UsersManage, BranchesManage, ImportsManage, AuditRead, SettingsManage, GuideManage];

    /// <summary>The three roles every new company starts with. A company can add its own later.</summary>
    public static IReadOnlyDictionary<string, (string Name, string[] Permissions)> DefaultRoles { get; } =
        new Dictionary<string, (string, string[])>
        {
            ["director"] = ("Director", Director),
            ["manager"] = ("Manager", Manager),
            ["teller"] = ("Teller", Teller),
        };
}