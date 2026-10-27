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

    private static readonly string[] Teller =
        [CalculatorUse, TransactionsRead, TransactionsCreate, DaysRead, DaysManage, DebtsRead, DebtsManage, CustomersRead,
         TransfersRead, TransfersCreate, TransfersReceive];

    private static readonly string[] Manager =
        [.. Teller, DaysSignoff, KumasiSetValue, ReportsRead, BranchesAll, PaymentsConfirm, CustomersManage, DiscrepanciesReview];

    private static readonly string[] Director =
        [.. Manager, PricesApprove, UsersManage, BranchesManage, ImportsManage];

    /// <summary>The three roles every new company starts with. A company can add its own later.</summary>
    public static IReadOnlyDictionary<string, (string Name, string[] Permissions)> DefaultRoles { get; } =
        new Dictionary<string, (string, string[])>
        {
            ["director"] = ("Director", Director),
            ["manager"] = ("Manager", Manager),
            ["teller"] = ("Teller", Teller),
        };
}
