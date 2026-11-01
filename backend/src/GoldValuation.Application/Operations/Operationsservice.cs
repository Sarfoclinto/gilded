using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;
using GoldValuation.Application.Abstractions;
using GoldValuation.Application.Auth;
using GoldValuation.Domain.Accounting;

namespace GoldValuation.Application.Operations;

/// <summary>
/// Prices, days and the drawer, purchases, loans and repayments. Each method checks who is asking and for which branch, validates
/// the request, and hands a ready payload to the store, which does it all-or-nothing. Results are contract-shaped JSON text.
/// </summary>
public sealed class OperationsService(IOperationsStore store, IClock clock)
{
    private const string Formula = "ExcelV1";
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web) { DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull };

    // ---------------------------------------------------------------- prices
    public async Task<string> CurrentPriceAsync(ICurrentContext me, Guid branchId, CancellationToken ct)
    {
        me.RequireBranch(branchId);
        return await store.GetCurrentPriceAsync(me, branchId, ct)
               ?? throw new AppException("PRICE_NOT_SET", "No price has been set for this branch yet.", 404);
    }

    public async Task SetBasePriceAsync(ICurrentContext me, BasePriceCommand c, CancellationToken ct)
    {
        me.Require(Permissions.KumasiSetValue);
        await store.SetBasePriceAsync(me, Positive(c.BasePrice, "basePrice"), c.PublishedAt, ct);
    }

    public Task<string> SetMarginAsync(ICurrentContext me, Guid branchId, MarginCommand c, CancellationToken ct)
    {
        me.Require(Permissions.KumasiSetValue);
        if (c.Approve) me.Require(Permissions.PricesApprove);
        if (!decimal.TryParse(c.Margin?.Trim(), NumberStyles.AllowLeadingSign | NumberStyles.AllowDecimalPoint, CultureInfo.InvariantCulture, out var margin))
            throw AppException.Invalid("Enter the margin as a number.", new Dictionary<string, string[]> { ["margin"] = ["Enter the margin as a number."] });
        return store.SetMarginAsync(me, branchId, margin, c.Approve, ct);
    }

    public Task<string> ApproveMarginAsync(ICurrentContext me, Guid branchId, CancellationToken ct)
    {
        me.Require(Permissions.PricesApprove);
        return store.ApproveMarginAsync(me, branchId, ct);
    }

    // ---------------------------------------------------------------- days and drawer
    public Task<string> DayStateAsync(ICurrentContext me, Guid branchId, CancellationToken ct)
    {
        me.Require(Permissions.DaysRead);
        me.RequireBranch(branchId);
        return store.DayStateAsync(me, branchId, ct);
    }

    public Task<DbResult> OpenDayAsync(ICurrentContext me, OpenDayCommand c, string? key, CancellationToken ct)
    {
        me.Require(Permissions.DaysManage);
        me.RequireBranch(c.BranchId);
        KeyMatches(key, c.Id);
        if (!DateOnly.TryParseExact(c.BusinessDate, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out _))
            throw AppException.Invalid("Enter the date as yyyy-MM-dd.", new Dictionary<string, string[]> { ["businessDate"] = ["Enter the date as yyyy-MM-dd."] });
        TransactionPlanner.ParseLines(c.Lines);
        return store.OpenDayAsync(me, Serialize(c), ct);
    }

    public Task<DbResult> RecordMovementAsync(ICurrentContext me, Guid dayId, MovementCommand c, string? key, CancellationToken ct)
    {
        me.Require(Permissions.DaysManage);
        me.RequireBranch(c.BranchId);
        KeyMatches(key, c.Id);
        if (c.DayId != dayId) throw AppException.Invalid("The day in the address and in the body differ.");
        TransactionPlanner.ParseLines(c.Lines);
        return store.RecordMovementAsync(me, Serialize(c), ct);
    }

    /// <summary>
    /// Notes changed after a customer was paid. The two sides must be worth exactly the same and use different notes; the database checks it too.
    /// </summary>
    public Task<DbResult> RecordExchangeAsync(ICurrentContext me, Guid dayId, ExchangeCommand c, string? key, CancellationToken ct)
    {
        // Changing a customer's notes after a purchase is part of running the counter; changing notes for the branch itself has its own permission.
        me.Require(c.TransactionId is null ? Permissions.NotesExchange : Permissions.DaysManage);
        me.RequireBranch(c.BranchId);
        KeyMatches(key, c.Id);
        if (c.DayId != dayId) throw AppException.Invalid("The day in the address and in the body differ.");
        var gave = TransactionPlanner.ParseLines(c.Gave);
        var took = TransactionPlanner.ParseLines(c.Took);
        if (gave.Count == 0 || took.Count == 0) throw AppException.Invalid("Enter the notes given back and the notes handed out.");
        if (NoteLines.Value(gave) != NoteLines.Value(took))
            throw AppException.Invalid("The notes given back and the notes handed out must be worth the same.");
        if (gave.Keys.Intersect(took.Keys).Any()) throw AppException.Invalid("Hand out different notes from the ones given back.");
        return store.RecordExchangeAsync(me, Serialize(c), ct);
    }

    /// <summary>The branch's recent note exchanges (those made without a purchase), newest first.</summary>
    public Task<string> ListExchangesAsync(ICurrentContext me, Guid branchId, int? limit, CancellationToken ct)
    {
        me.Require(Permissions.NotesExchange);
        me.RequireBranch(branchId);
        return store.ListExchangesAsync(me, branchId, Math.Clamp(limit ?? 20, 1, 100), ct);
    }

    public async Task<string> GetDayAsync(ICurrentContext me, Guid id, CancellationToken ct)
    {
        me.Require(Permissions.DaysRead);
        return InScope(me, await store.GetDayAsync(me, id, ct)) ?? throw AppException.NotFound("Day");
    }

    /// <summary>One day's own movements (cash by note, goods, who was lent what), apart from the running totals.</summary>
    public async Task<string> DayActivityAsync(ICurrentContext me, Guid id, CancellationToken ct)
    {
        me.Require(Permissions.DaysRead);
        _ = InScope(me, await store.GetDayAsync(me, id, ct)) ?? throw AppException.NotFound("Day");
        return await store.DayActivityAsync(me, id, ct);
    }

    public Task<string> ListDaysAsync(ICurrentContext me, Guid branchId, string? fromDate, string? toDate, string? signoff, int? limit, CancellationToken ct)
    {
        me.Require(Permissions.DaysRead);
        me.RequireBranch(branchId);
        var fields = new Dictionary<string, string[]>();
        DateOnly? Date(string? text, string field)
        {
            if (string.IsNullOrWhiteSpace(text)) return null;
            if (DateOnly.TryParseExact(text.Trim(), "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var d)) return d;
            fields[field] = ["Enter the date as yyyy-MM-dd."];
            return null;
        }
        var f = Date(fromDate, "from");
        var t = Date(toDate, "to");
        if (signoff is not (null or "not_required" or "pending" or "approved" or "rejected"))
            fields["signoff"] = ["Use not_required, pending, approved or rejected."];
        if (fields.Count > 0) throw AppException.Invalid("Check the filters.", fields);
        return store.ListDaysAsync(me, branchId, f, t, signoff, Math.Clamp(limit ?? 60, 1, 200), ct);
    }

    /// <summary>What the books say the branch holds right now, with the wording the teller must accept to close.</summary>
    public async Task<string> ClosingPreviewAsync(ICurrentContext me, Guid dayId, CancellationToken ct)
    {
        me.Require(Permissions.DaysManage);
        _ = InScope(me, await store.GetDayAsync(me, dayId, ct)) ?? throw AppException.NotFound("Day");
        var preview = JsonNode.Parse(await store.ClosingPreviewAsync(me, dayId, ct))!.AsObject();
        preview["confirmation"] = new JsonObject { ["version"] = ClosingConfirmation.CurrentVersion, ["text"] = ClosingConfirmation.CurrentText };
        return preview.ToJsonString();
    }

    private static readonly string[] ExplainableFigures = ["cash", "goods_top", "goods_down", "goods_value", "debt", "payable", "custody_top"];

    public Task<DbResult> CloseDayAsync(ICurrentContext me, Guid dayId, CloseDayCommand c, string? key, CancellationToken ct)
    {
        me.Require(Permissions.DaysManage);
        me.RequireBranch(c.BranchId);
        KeyMatches(key, c.Id);
        if (c.DayId != dayId) throw AppException.Invalid("The day in the address and in the body differ.");
        var fields = new Dictionary<string, string[]>();
        var d = c.Declared;
        if (d is null) throw AppException.Invalid("Report the closing figures.", new Dictionary<string, string[]> { ["declared"] = ["Report the closing figures."] });
        decimal Figure(string? text, string field, int decimals)
        {
            if (decimal.TryParse(text?.Trim(), NumberStyles.AllowDecimalPoint, CultureInfo.InvariantCulture, out var v) && v >= 0 && decimal.Round(v, decimals) == v) return v;
            fields[$"declared.{field}"] = [decimals == 4 ? "Enter a weight of zero or more, up to 4 decimals." : "Enter an amount of zero or more, up to 2 decimals."];
            return 0;
        }
        var top = Figure(d.GoodsTop, "goodsTop", 4);
        var down = Figure(d.GoodsDown, "goodsDown", 4);
        var goodsValue = Figure(d.GoodsValue, "goodsValue", 2);
        var debt = Figure(d.Debt, "debt", 2);
        var payable = Figure(d.Payable, "payable", 2);
        var custody = Figure(d.CustodyTop, "custodyTop", 4);
        if (d.Cash is null) fields["declared.cash"] = ["Count the notes in the drawer (an empty drawer is {})."];
        if (fields.Count > 0) throw AppException.Invalid("Check the figures you reported.", fields);
        TransactionPlanner.ParseLines(d.Cash);

        var conf = c.Confirmation;
        if (conf is null || !conf.Accepted)
            throw new AppException("CONFIRMATION_REQUIRED", "Tick the confirmation that you physically verified everything reported.", 422);
        if (!ClosingConfirmation.TryGet(conf.Version, out var text))
            throw new AppException("CONFIRMATION_OUTDATED", "The confirmation wording has changed. Fetch the closing preview again and show the new wording.", 409);

        var explanations = new JsonObject();
        foreach (var (figure, why) in c.Explanations ?? new Dictionary<string, string>())
        {
            if (!ExplainableFigures.Contains(figure)) throw AppException.Invalid($"Unknown figure '{figure}' in explanations.");
            explanations[figure] = why?.Trim();
        }
        var payload = new JsonObject
        {
            ["id"] = c.Id, ["dayId"] = dayId, ["branchId"] = c.BranchId, ["capturedAt"] = c.CapturedAt,
            ["declared"] = new JsonObject
            {
                ["cash"] = JsonSerializer.SerializeToNode(d.Cash), ["goodsTop"] = top, ["goodsDown"] = down, ["goodsValue"] = goodsValue,
                ["debt"] = debt, ["payable"] = payable, ["custodyTop"] = custody,
            },
            ["explanations"] = explanations,
            ["confirmation"] = new JsonObject { ["accepted"] = true, ["version"] = conf.Version, ["text"] = text },
        };
        return store.CloseDayAsync(me, payload.ToJsonString(), ct);
    }

    /// <summary>A manager (not the person who closed it) approves or rejects a closing difference. The ledger is never changed by this.</summary>
    public async Task<string> SignoffDayAsync(ICurrentContext me, Guid dayId, SignoffCommand c, CancellationToken ct)
    {
        me.Require(Permissions.DaysSignoff);
        _ = InScope(me, await store.GetDayAsync(me, dayId, ct)) ?? throw AppException.NotFound("Day");
        if (c.Decision is not ("approved" or "rejected"))
            throw AppException.Invalid("Decision must be approved or rejected.", new Dictionary<string, string[]> { ["decision"] = ["Use approved or rejected."] });
        return await store.SignoffDayAsync(me, dayId, c.Decision, c.Note, ct);
    }

    // ---------------------------------------------------------------- purchases
    public async Task<DbResult> CreateTransactionAsync(ICurrentContext me, CreateTransactionCommand c, string? key, CancellationToken ct)
    {
        me.Require(Permissions.TransactionsCreate);
        me.RequireBranch(c.BranchId);
        KeyMatches(key, c.Id);
        var config = await store.GetCalcConfigAsync(me, Formula, ct);
        var payload = TransactionPlanner.Plan(c, config, clock.UtcNow);
        return await store.PostTransactionAsync(me, payload.ToJsonString(), ct);
    }

    /// <summary>Filters from the query string. Branch access is enforced here: the database only ever sees the caller's own branches.</summary>
    public Task<string> SearchTransactionsAsync(ICurrentContext me, TransactionSearch s, CancellationToken ct)
    {
        me.Require(Permissions.TransactionsRead);
        if (s.BranchId is { } b) me.RequireBranch(b);
        string[] sorts = ["newest", "oldest", "amount_desc", "amount_asc"];
        if (s.Sort is not null && !sorts.Contains(s.Sort)) throw new AppException("VALIDATION_FAILED", "That sort order is not known.", 422);
        foreach (var d in new[] { s.From, s.To })
            if (d is not null && !DateOnly.TryParseExact(d, "yyyy-MM-dd", out _)) throw new AppException("VALIDATION_FAILED", "Dates look like 2026-10-29.", 422);
        foreach (var n in new[] { s.MinAmount, s.MaxAmount })
            if (n is not null && !decimal.TryParse(n, System.Globalization.NumberStyles.Number, System.Globalization.CultureInfo.InvariantCulture, out _)) throw new AppException("VALIDATION_FAILED", "Amounts are numbers.", 422);
        var q = s.Q?.Trim();
        if (q is { Length: > 60 }) q = q[..60];
        var filter = new System.Text.Json.Nodes.JsonObject
        {
            ["scope"] = new System.Text.Json.Nodes.JsonArray(me.BranchIds.Select(x => (System.Text.Json.Nodes.JsonNode?)x.ToString()).ToArray()),
            ["branchId"] = s.BranchId?.ToString(),
            ["customerId"] = s.CustomerId?.ToString(),
            ["q"] = string.IsNullOrEmpty(q) ? null : q,
            ["from"] = s.From, ["to"] = s.To, ["status"] = s.Status, ["flag"] = s.Flagged == true ? true : null,
            ["minAmount"] = s.MinAmount, ["maxAmount"] = s.MaxAmount, ["sort"] = s.Sort,
            ["limit"] = Math.Clamp(s.Limit ?? 25, 1, 100), ["offset"] = Math.Max(s.Offset ?? 0, 0),
        };
        return store.SearchTransactionsAsync(me, filter.ToJsonString(), ct);
    }

    /// <summary>
    /// Figures for the home screen. Everyone with transactions:read gets today, the trend, payments, gold on hand and their own purchases for the branches
    /// they work in. How the other staff are doing (per-teller totals, top customers, cash differences) needs reports:read and is removed otherwise.
    /// </summary>
    public async Task<string> DashboardAsync(ICurrentContext me, Guid? branchId, int? days, CancellationToken ct)
    {
        me.Require(Permissions.TransactionsRead);
        if (branchId is { } b) me.RequireBranch(b);
        var filter = new System.Text.Json.Nodes.JsonObject
        {
            ["scope"] = new System.Text.Json.Nodes.JsonArray(me.BranchIds.Select(x => (System.Text.Json.Nodes.JsonNode?)x.ToString()).ToArray()),
            ["branchId"] = branchId?.ToString(),
            ["days"] = Math.Clamp(days ?? 14, 7, 60),
            ["mine"] = me.UserId.ToString(),
        };
        var json = await store.DashboardAsync(me, filter.ToJsonString(), ct);
        if (me.Has(Permissions.ReportsRead)) return json;
        var node = System.Text.Json.Nodes.JsonNode.Parse(json)!.AsObject();
        foreach (var key in new[] { "tellers", "topCustomers", "cashDifferences" }) node.Remove(key);
        return node.ToJsonString();
    }

    public Task<string> ListTransactionsAsync(ICurrentContext me, Guid branchId, int? limit, CancellationToken ct)
    {
        me.Require(Permissions.TransactionsRead);
        me.RequireBranch(branchId);
        return store.ListTransactionsAsync(me, branchId, Math.Clamp(limit ?? 50, 1, 200), ct);
    }

    public async Task<string> GetTransactionAsync(ICurrentContext me, Guid id, CancellationToken ct)
    {
        me.Require(Permissions.TransactionsRead);
        var json = await store.GetTransactionAsync(me, id, ct);
        return InScope(me, json) ?? throw AppException.NotFound("Transaction");
    }

    /// <summary>Someone at the sending branch confirms the mobile money arrived, or marks it failed and covers it another way.</summary>
    public Task<string> ResolvePaymentAsync(ICurrentContext me, Guid paymentId, bool confirmed, ResolvePaymentCommand? c, CancellationToken ct)
    {
        me.Require(Permissions.PaymentsConfirm);
        string? replacements = null;
        if (!confirmed)
        {
            var parts = new List<object>();
            foreach (var cash in c?.CashReplacements ?? [])
            {
                var amount = TransactionPlanner.WholeCedis(cash.Amount, "cashReplacements.amount");
                TransactionPlanner.ParseLines(cash.Lines);
                parts.Add(new { method = "cash", amount, lines = cash.Lines });
            }
            foreach (var s in c?.Replacements ?? [])
                parts.Add(new
                {
                    method = s.Method, amount = TransactionPlanner.WholeCedis(s.Amount, "replacements.amount"), paidByBranchId = s.PaidByBranchId,
                    externalRef = s.ExternalRef, debtId = s.DebtId, dueDate = s.DueDate, note = s.Note,
                });
            replacements = JsonSerializer.Serialize(parts, Json);
        }
        return store.ResolvePaymentAsync(me, paymentId, confirmed ? "confirmed" : "failed", replacements, ct);
    }

    /// <summary>Mobile money waiting to be confirmed: what this branch must send (role "sending"), or is still owed for its purchases ("receiving").</summary>
    /// <summary>
    /// Pays out the cash of a purchase that was saved in two-step mode. The notes must add up to exactly what is due, so the amount can
    /// never be changed here, only which notes make it up. The database refuses a second payment (first one wins).
    /// </summary>
    public async Task<DbResult> PayTransactionAsync(ICurrentContext me, Guid id, PayTransactionCommand c, CancellationToken ct)
    {
        me.Require(Permissions.DaysManage);
        _ = InScope(me, await store.GetTransactionAsync(me, id, ct)) ?? throw AppException.NotFound("Transaction");
        var lines = TransactionPlanner.ParseLines(c.Lines);
        if (lines.Count == 0) throw AppException.Invalid("Enter the notes you are handing over.");
        if (!string.IsNullOrWhiteSpace(c.CheckAmount) && !decimal.TryParse(c.CheckAmount, NumberStyles.Number, CultureInfo.InvariantCulture, out _))
            throw AppException.Invalid("Enter the amount as a number.");
        var noteLines = new JsonObject();
        foreach (var (denom, count) in lines.OrderByDescending(kv => kv.Key)) noteLines[denom.ToString(CultureInfo.InvariantCulture)] = count;
        var payload = new JsonObject { ["id"] = id, ["lines"] = noteLines, ["capturedAt"] = c.CapturedAt ?? clock.UtcNow };
        if (!string.IsNullOrWhiteSpace(c.CheckAmount)) payload["checkAmount"] = decimal.Parse(c.CheckAmount, NumberStyles.Number, CultureInfo.InvariantCulture);
        return await store.PayTransactionAsync(me, payload.ToJsonString(), ct);
    }

    public Task<string> ToPayAsync(ICurrentContext me, Guid branchId, string? search, CancellationToken ct)
    {
        me.Require(Permissions.TransactionsRead);
        me.RequireBranch(branchId);
        return store.ToPayAsync(me, branchId, string.IsNullOrWhiteSpace(search) ? null : search.Trim(), ct);
    }

    /// <summary>Everyone in the company reads the settings: the app needs them to know whether a purchase is paid at once or in two steps.</summary>
    public Task<string> GetSettingsAsync(ICurrentContext me, CancellationToken ct) => store.GetSettingsAsync(me, ct);

    public Task<string> SetSettingsAsync(ICurrentContext me, JsonObject changes, CancellationToken ct)
    {
        me.Require(Permissions.SettingsManage);
        return store.SetSettingsAsync(me, changes.ToJsonString(), ct);
    }

    public Task<string> PendingPaymentsAsync(ICurrentContext me, Guid branchId, string? role, CancellationToken ct)
    {
        role ??= "sending";
        if (role is not ("sending" or "receiving")) throw AppException.Invalid("role must be sending or receiving.");
        me.Require(role == "sending" ? Permissions.PaymentsConfirm : Permissions.TransactionsRead);
        me.RequireBranch(branchId);
        return store.PendingPaymentsAsync(me, branchId, role, ct);
    }

    /// <summary>
    /// Customers matching the text, those who have sold at <paramref name="branchId"/> first. With no text it returns that branch's
    /// directory (up to 1000), which the app keeps on the device so the picker works offline.
    /// </summary>
    public Task<string> SearchCustomersAsync(ICurrentContext me, string? query, Guid? branchId, int? limit, CancellationToken ct)
    {
        me.Require(Permissions.TransactionsRead);
        if (branchId is { } b) me.RequireBranch(b);
        return store.SearchCustomersAsync(me, string.IsNullOrWhiteSpace(query) ? null : query.Trim(), branchId, Math.Clamp(limit ?? 25, 1, 1000), ct);
    }

    /// <summary>The company's towns, most used first. The app keeps this list on the device so the picker works offline.</summary>
    public Task<string> TownsAsync(ICurrentContext me, string? query, CancellationToken ct)
    {
        me.Require(Permissions.TransactionsRead);
        return store.ListTownsAsync(me, string.IsNullOrWhiteSpace(query) ? null : query.Trim(), ct);
    }

    /// <summary>What carat to expect, from what this company has bought from that town and from that customer. Statistics only.</summary>
    public Task<string> ExpectationsAsync(ICurrentContext me, Guid? townId, Guid? customerId, CancellationToken ct)
    {
        me.Require(Permissions.TransactionsRead);
        return store.ExpectationsAsync(me, townId, customerId, ct);
    }

    public Task<string> CreateTownAsync(ICurrentContext me, TownRef town, CancellationToken ct)
    {
        me.Require(Permissions.TransactionsCreate);
        if (string.IsNullOrWhiteSpace(town.Name) || town.Name.Trim().Length is < 2 or > 80)
            throw AppException.Invalid("A town name is 2 to 80 letters.", new Dictionary<string, string[]> { ["name"] = ["Write the town name."] });
        return store.CreateTownAsync(me, new JsonObject { ["id"] = town.Id, ["name"] = town.Name.Trim() }.ToJsonString(), ct);
    }

    // ---------------------------------------------------------------- debts, loans, security
    public Task<DbResult> IssueLoanAsync(ICurrentContext me, LoanCommand c, string? key, CancellationToken ct)
    {
        me.Require(Permissions.DebtsManage);
        me.RequireBranch(c.BranchId);
        KeyMatches(key, c.Id);
        TransactionPlanner.WholeCedis(c.Principal, "principal");
        TransactionPlanner.ParseLines(c.Lines);
        return store.IssueLoanAsync(me, Serialize(c), ct);
    }

    public async Task<DbResult> RepayDebtAsync(ICurrentContext me, Guid debtId, RepaymentCommand c, string? key, CancellationToken ct)
    {
        me.Require(Permissions.DebtsManage);
        KeyMatches(key, c.Id);
        _ = InScope(me, await store.GetDebtAsync(me, debtId, ct)) ?? throw AppException.NotFound("Debt");
        TransactionPlanner.WholeCedis(c.Amount, "amount");
        TransactionPlanner.ParseLines(c.Lines);
        var payload = JsonSerializer.SerializeToNode(c, Json)!.AsObject();
        payload["debtId"] = debtId;
        return await store.RepayDebtAsync(me, payload.ToJsonString(), ct);
    }

    public Task<string> ListDebtsAsync(ICurrentContext me, Guid branchId, string? direction, bool openOnly, Guid? customerId, CancellationToken ct)
    {
        me.Require(Permissions.DebtsRead);
        me.RequireBranch(branchId);
        if (direction is not (null or "receivable" or "payable"))
            throw AppException.Invalid("direction must be receivable or payable.");
        return store.ListDebtsAsync(me, branchId, direction, openOnly, customerId, ct);
    }

    public async Task<string> GetDebtAsync(ICurrentContext me, Guid id, CancellationToken ct)
    {
        me.Require(Permissions.DebtsRead);
        return InScope(me, await store.GetDebtAsync(me, id, ct)) ?? throw AppException.NotFound("Debt");
    }

    public Task<string> ListCollateralAsync(ICurrentContext me, Guid branchId, string? status, CancellationToken ct)
    {
        me.Require(Permissions.DebtsRead);
        me.RequireBranch(branchId);
        if (status is not (null or "held" or "converted" or "returned")) throw AppException.Invalid("status must be held, converted or returned.");
        return store.ListCollateralAsync(me, branchId, status, ct);
    }

    public async Task<string> ReturnCollateralAsync(ICurrentContext me, Guid id, string? note, CancellationToken ct)
    {
        me.Require(Permissions.DebtsManage);
        _ = InScope(me, await store.GetCollateralAsync(me, id, ct)) ?? throw AppException.NotFound("Holding");
        return await store.ReturnCollateralAsync(me, id, note, ct);
    }

    // ---------------------------------------------------------------- helpers
    private static string Serialize(object command) => JsonSerializer.Serialize(command, Json);

    /// <summary>The Idempotency-Key header, when sent, must be the request's own id: that pairing is what makes a retry safe.</summary>
    private static void KeyMatches(string? key, Guid id)
    {
        if (id == Guid.Empty) throw AppException.Invalid("An id is needed.", new Dictionary<string, string[]> { ["id"] = ["Send a new uuid as id."] });
        if (key is not null && !string.Equals(key.Trim(), id.ToString(), StringComparison.OrdinalIgnoreCase))
            throw AppException.Invalid("Idempotency-Key must equal the request's id.");
    }

    private static decimal Positive(string? text, string field)
    {
        if (!decimal.TryParse(text?.Trim(), NumberStyles.AllowDecimalPoint, CultureInfo.InvariantCulture, out var value) || value <= 0)
            throw AppException.Invalid("Enter a number above zero.", new Dictionary<string, string[]> { [field] = ["Enter a number above zero."] });
        return value;
    }

    /// <summary>The record, only if it belongs to a branch the caller works in. Otherwise null, so another branch's data looks absent.</summary>
    private static string? InScope(ICurrentContext me, string? json)
    {
        if (json is null) return null;
        using var doc = JsonDocument.Parse(json);
        return doc.RootElement.TryGetProperty("branchId", out var b) && b.TryGetGuid(out var id) && me.BranchIds.Contains(id) ? json : null;
    }
}