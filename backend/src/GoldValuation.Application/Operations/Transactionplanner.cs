using System.Globalization;
using System.Text.Json.Nodes;
using GoldValuation.Application.Abstractions;
using GoldValuation.Domain.Accounting;
using GoldValuation.Domain.Calculation;
using GoldValuation.Domain.Notes;

namespace GoldValuation.Application.Operations;

/// <summary>
/// Turns what a device sent into what the database stores: recalculates every item with the company's formula, works out the
/// amount to pay, splits the payment into its parts, and decides the flags. The device's own figures are only compared, never trusted.
/// Pure and deterministic, so it is tested without a database.
/// </summary>
public static class TransactionPlanner
{
    public static readonly TimeSpan OfflineAfter = TimeSpan.FromMinutes(2);
    public static readonly TimeSpan PriceStaleAfter = TimeSpan.FromHours(12);
    private static readonly string[] SplitMethods = ["mobile_money", "owed", "debt_offset"];

    public static JsonObject Plan(CreateTransactionCommand c, CalcConfig config, DateTimeOffset now)
    {
        var fields = new Dictionary<string, string[]>();
        void Bad(string field, string message) => fields[field] = [message];

        if (c.Id == Guid.Empty) Bad("id", "An id is needed.");
        if (c.BranchId == Guid.Empty) Bad("branchId", "Choose the branch.");
        if (string.IsNullOrWhiteSpace(c.CustomerName)) Bad("customerName", "Enter the customer name.");
        else if (c.CustomerName.Trim().Length > 120) Bad("customerName", "That name is too long.");
        if (c.Items is null || c.Items.Count is < 1 or > 20) Bad("items", "Add 1 to 20 items.");
        if (c.Payout is null) Bad("payout", "The payout is missing.");
        if (fields.Count > 0) throw AppException.Invalid("Check the highlighted fields.", fields);

        // ---- every item, recalculated ----
        var items = new JsonArray();
        decimal total = 0;
        for (var i = 0; i < c.Items!.Count; i++)
        {
            var it = c.Items[i];
            var result = ExcelV1Calculator.Calculate(new CalcInput(it.Top, it.Down, it.Price), config);
            if (it.Id == Guid.Empty) Bad($"items.{i}", "Each item needs an id.");
            else if (result.Errors.Count > 0)
                fields[$"items.{i}"] = result.Errors.Select(e => e.Message).ToArray();
            else if (result.Amount is null || result.Karat is null || result.Purity is null || result.NetWeight is null ||
                     result.Pounds is null || result.Density is null)
                Bad($"items.{i}", "Fill in top, down and price.");
            else
            {
                total += decimal.Parse(result.Amount, CultureInfo.InvariantCulture);
                items.Add(new JsonObject
                {
                    ["id"] = it.Id,
                    ["label"] = it.Label?.Trim(),
                    ["top"] = it.Top!.Trim(),
                    ["down"] = it.Down!.Trim(),
                    ["price"] = it.Price!.Trim(),
                    ["density"] = result.Density,
                    ["karat"] = result.Karat,
                    ["purity"] = result.Purity,
                    ["netWeight"] = result.NetWeight,
                    ["pounds"] = result.Pounds,
                    ["amount"] = result.Amount,
                });
            }
        }
        if (fields.Count > 0) throw AppException.Invalid("Some items cannot be calculated.", fields);

        // ---- the amount to pay and how it is paid ----
        var payout = c.Payout!;
        if (payout.Policy is not ("down" or "up" or "nearest")) Bad("payout.policy", "Policy must be down, up or nearest.");
        if (payout.Strategy is not ("fewest-notes" or "prefer-100s")) Bad("payout.strategy", "Strategy must be fewest-notes or prefer-100s.");
        if (fields.Count > 0) throw AppException.Invalid("Check the payout.", fields);

        var payable = WholeCedis(payout.Payable, "payout.payable");
        if (payable % 5 != 0) throw new AppException("PAYOUT_MISMATCH", "The amount to pay must be a multiple of 5.", 422);

        var payments = new JsonArray();
        decimal nonCash = 0;
        var split = payout.Split ?? [];
        for (var i = 0; i < split.Count; i++)
        {
            var s = split[i];
            if (s.Method is null || !SplitMethods.Contains(s.Method))
                throw AppException.Invalid("Check the payment parts.", new Dictionary<string, string[]> { [$"payout.split.{i}.method"] = ["Use mobile_money, owed or debt_offset."] });
            var amount = WholeCedis(s.Amount, $"payout.split.{i}.amount");
            if (amount <= 0) throw AppException.Invalid("Each part must be above zero.", new Dictionary<string, string[]> { [$"payout.split.{i}.amount"] = ["Enter an amount above zero."] });
            if (s.Method == "mobile_money" && s.PaidByBranchId is null)
                throw AppException.Invalid("Say which branch sends the mobile money.", new Dictionary<string, string[]> { [$"payout.split.{i}.paidByBranchId"] = ["Choose the sending branch."] });
            if (s.Method == "debt_offset" && s.DebtId is null)
                throw AppException.Invalid("Say which debt the gold settles.", new Dictionary<string, string[]> { [$"payout.split.{i}.debtId"] = ["Choose the debt."] });
            nonCash += amount;
            payments.Add(new JsonObject
            {
                ["method"] = s.Method,
                ["amount"] = amount,
                ["paidByBranchId"] = s.PaidByBranchId,
                ["externalRef"] = s.ExternalRef?.Trim(),
                ["debtId"] = s.DebtId,
                ["dueDate"] = string.IsNullOrWhiteSpace(s.DueDate) ? null : s.DueDate.Trim(),
                ["note"] = s.Note?.Trim(),
            });
        }

        var cash = payable - nonCash;
        if (cash < 0) throw new AppException("PAYOUT_MISMATCH", "The parts of the payment are more than the amount to pay.", 422);
        var lines = ParseLines(payout.Lines);
        if (NoteLines.Value(lines) != cash)
            throw new AppException("PAYOUT_MISMATCH", cash == payable
                ? "The notes do not add up to the amount to pay."
                : $"The notes must add up to the cash part ({cash.ToString(CultureInfo.InvariantCulture)}).", 422);
        if (cash > 0)
        {
            var cashLines = new JsonObject();
            foreach (var (denom, count) in lines.OrderByDescending(kv => kv.Key)) cashLines[denom.ToString(CultureInfo.InvariantCulture)] = count;
            payments.Insert(0, new JsonObject { ["method"] = "cash", ["amount"] = cash, ["lines"] = cashLines });
        }

        // ---- flags: facts about how it arrived, never a reason to refuse ----
        var flags = new JsonArray();
        if (!decimal.TryParse(c.ClientAmount, NumberStyles.Number, CultureInfo.InvariantCulture, out var client) || client != total) flags.Add("CALC_MISMATCH");
        if (now - c.CapturedAt > OfflineAfter) flags.Add("OFFLINE_ENTRY");
        if (now - c.PriceAsOf > PriceStaleAfter) flags.Add("PRICE_STALE");

        return new JsonObject
        {
            ["id"] = c.Id,
            ["branchId"] = c.BranchId,
            ["customer"] = new JsonObject { ["id"] = c.CustomerId, ["name"] = c.CustomerName!.Trim(), ["phone"] = c.CustomerPhone?.Trim() },
            ["items"] = items,
            ["formulaVersion"] = config.FormulaVersion,
            ["clientAmount"] = client,
            ["calculatedAmount"] = total,
            ["policy"] = payout.Policy,
            ["strategy"] = payout.Strategy,
            ["payable"] = payable,
            ["difference"] = payable - total,
            ["capturedAt"] = c.CapturedAt,
            ["priceAsOf"] = c.PriceAsOf,
            ["collateralId"] = c.CollateralId,
            ["flags"] = flags,
            ["payments"] = payments,
        };
    }

    /// <summary>Whole cedis from text such as "11832". Anything else is a validation error.</summary>
    public static decimal WholeCedis(string? text, string field)
    {
        if (!decimal.TryParse(text?.Trim(), NumberStyles.None, CultureInfo.InvariantCulture, out var value))
            throw AppException.Invalid("Enter a whole number of cedis.", new Dictionary<string, string[]> { [field] = ["Enter a whole number of cedis."] });
        return value;
    }

    /// <summary>Notes keyed by denomination text, such as {"100": 3}. Only real denominations and positive counts pass.</summary>
    public static Dictionary<int, int> ParseLines(Dictionary<string, int>? raw)
    {
        var lines = new Dictionary<int, int>();
        foreach (var (key, count) in raw ?? new Dictionary<string, int>())
        {
            if (!int.TryParse(key, NumberStyles.None, CultureInfo.InvariantCulture, out var denom) || !NoteSolver.Denominations.Contains(denom))
                throw new AppException("BAD_DENOMINATION", "Notes must be 5, 10, 20, 50, 100 or 200 cedis.", 422);
            if (count < 1) throw new AppException("BAD_COUNT", "Note counts must be positive whole numbers.", 422);
            lines[denom] = count;
        }
        return lines;
    }
}
