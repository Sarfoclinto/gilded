namespace GoldValuation.Application.Operations;

// Requests as the API receives them. Money, weights and counts that a person types travel as strings (like the contract says);
// the services parse them with exact decimals. Property names are the JSON names in camelCase.

public sealed record ItemCommand(Guid Id, string? Label, string? Top, string? Down, string? Price);

/// <summary>One non-cash part of a payment: mobile_money (needs paidByBranchId), owed, or debt_offset (needs debtId).</summary>
public sealed record SplitCommand(string? Method, string? Amount, Guid? PaidByBranchId, string? ExternalRef, Guid? DebtId, string? DueDate, string? Note);

/// <summary>
/// The cash part is whatever remains of <c>Payable</c> after the split and is handed over as <c>Lines</c>.
/// With no split the whole amount is cash, as before.
/// </summary>
public sealed record PayoutCommand(string? Policy, string? Strategy, string? Payable, Dictionary<string, int>? Lines, List<SplitCommand>? Split);

public sealed record CreateTransactionCommand(
    Guid Id, Guid BranchId, string? CustomerName, string? CustomerPhone, Guid? CustomerId,
    List<ItemCommand>? Items, string? ClientAmount, PayoutCommand? Payout,
    DateTimeOffset CapturedAt, DateTimeOffset PriceAsOf, Guid? CollateralId, PersonRef? Representative = null, TownRef? OriginTown = null);

/// <summary>Someone acting for the customer (they bring the gold). Written on the purchase; not made a customer.</summary>
public sealed record PersonRef(string? Name, string? Phone);

/// <summary>Where the gold comes from. A name that is already in the company's list is matched, ignoring case and spacing; a new one is added.</summary>
public sealed record TownRef(Guid? Id, string? Name);

public sealed record OpenDayCommand(
    Guid Id, Guid BranchId, string? BusinessDate, Dictionary<string, int>? Lines, string? Source, DateTimeOffset CapturedAt, string? Explanation, bool? AfterClose = null);

public sealed record MovementCommand(
    Guid Id, Guid DayId, Guid BranchId, string? Kind, Dictionary<string, int>? Lines, string? Note, DateTimeOffset CapturedAt, int? People = null);

/// <summary>The customer gives notes back and is handed other notes of the same total value (e.g. one 200 for two 100s).</summary>
public sealed record ExchangeCommand(
    Guid Id, Guid DayId, Guid BranchId, Guid? TransactionId, Dictionary<string, int>? Gave, Dictionary<string, int>? Took, string? Note, DateTimeOffset CapturedAt);

/// <summary>Pay out the cash of a purchase saved in two-step mode. Only the notes are chosen here; the amount is fixed by the purchase.</summary>
public sealed record PayTransactionCommand(Dictionary<string, int>? Lines, DateTimeOffset? CapturedAt, string? CheckAmount);

public sealed record CustomerRef(Guid? Id, string? Name, string? Phone);

public sealed record CollateralInput(string? TopWeight, string? Description);

public sealed record LoanCommand(
    Guid Id, Guid BranchId, CustomerRef? Customer, string? PartyType, string? Principal, Dictionary<string, int>? Lines,
    string? Reason, string? DueDate, CollateralInput? Collateral, DateTimeOffset CapturedAt);

public sealed record RepaymentCommand(
    Guid Id, string? Amount, string? Method, Dictionary<string, int>? Lines, Guid? PaidByBranchId, string? ExternalRef, string? Note, DateTimeOffset CapturedAt);

public sealed record BasePriceCommand(string? BasePrice, DateTimeOffset? PublishedAt);

public sealed record MarginCommand(string? Margin, bool Approve);

public sealed record ResolvePaymentCommand(List<SplitCommand>? Replacements, List<CashReplacement>? CashReplacements);

/// <summary>A replacement for a failed mobile-money part, paid in cash.</summary>
public sealed record CashReplacement(string? Amount, Dictionary<string, int>? Lines);

/// <summary>The seven figures a teller reports at closing. Cash is notes by denomination; weights and money travel as strings.</summary>
public sealed record DeclaredFigures(
    Dictionary<string, int>? Cash, string? GoodsTop, string? GoodsDown, string? GoodsValue, string? Debt, string? Payable, string? CustodyTop);

public sealed record ConfirmationInput(bool Accepted, string? Version);

/// <summary>Explanations are keyed cash, goods_top, goods_down, goods_value, debt, payable, custody_top: one for every figure that differs.</summary>
public sealed record CloseDayCommand(
    Guid Id, Guid DayId, Guid BranchId, DeclaredFigures? Declared, Dictionary<string, string>? Explanations,
    ConfirmationInput? Confirmation, DateTimeOffset CapturedAt);

public sealed record SignoffCommand(string? Decision, string? Note);

public readonly record struct DbResult(bool Replayed, string DataJson);

/// <summary>Filters for the Transactions list (query string). Dates are yyyy-MM-dd in the branch's own calendar; amounts are plain numbers.</summary>
public sealed record TransactionSearch(
    Guid? BranchId, Guid? CustomerId, string? Q, string? From, string? To, string? Status, bool? Flagged,
    string? MinAmount, string? MaxAmount, string? Sort, int? Limit, int? Offset);