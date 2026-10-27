using System.Globalization;
using System.Text.Json.Nodes;
using GoldValuation.Application.Abstractions;
using GoldValuation.Application.Auth;
using GoldValuation.Domain.Calculation;

namespace GoldValuation.Application.Imports;

/// <summary>
/// Brings spreadsheet data in. Past purchases are recalculated here with the company's formula (the sheet's own figures are only
/// compared, never trusted), then stored as records: they do not move cash, gold or debts. Needs <see cref="Permissions.ImportsManage"/>.
/// </summary>
public sealed class ImportsService(IImportsStore store)
{
    private const string Formula = "ExcelV1";
    public const int MaxHistoryRows = 500;
    public const int MaxCustomerRows = 1000;

    public async Task<string> ImportHistoryAsync(ICurrentContext me, JsonObject body, CancellationToken ct)
    {
        me.Require(Permissions.ImportsManage);
        if (!Guid.TryParse((string?)body["batchId"], out var batchId) || batchId == Guid.Empty) throw AppException.Invalid("A batch id is needed.");
        if (body["rows"] is not JsonArray rows || rows.Count is < 1 or > MaxHistoryRows) throw AppException.Invalid($"Send 1 to {MaxHistoryRows} rows at a time.");
        var config = await store.GetCalcConfigAsync(me, Formula, ct);
        var problems = new Dictionary<string, string[]>();
        var planned = new JsonArray();

        foreach (var node in rows)
        {
            var row = node as JsonObject ?? throw AppException.Invalid("Each row must be an object.");
            var key = ((string?)row["key"])?.Trim();
            if (string.IsNullOrEmpty(key) || key.Length > 40) throw AppException.Invalid("Each row needs a key (its row number).");
            void Bad(string message) => problems[$"row {key}"] = [message];

            if (!Guid.TryParse((string?)row["branchId"], out var branchId)) { Bad("Choose the branch."); continue; }
            me.RequireBranch(branchId);
            if (!DateTimeOffset.TryParse((string?)row["capturedAt"], CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var at)) { Bad("The date is not valid."); continue; }
            if (at > DateTimeOffset.UtcNow) { Bad("The date must be in the past."); continue; }
            var name = ((string?)row["customerName"])?.Trim();
            if (string.IsNullOrEmpty(name)) { Bad("The customer name is missing."); continue; }
            if (name.Length > 120) { Bad("The customer name is too long."); continue; }
            if (row["items"] is not JsonArray items || items.Count is < 1 or > 20) { Bad("Each purchase needs 1 to 20 items."); continue; }

            var outItems = new JsonArray();
            decimal total = 0;
            var itemFailed = false;
            for (var i = 0; i < items.Count; i++)
            {
                var it = items[i] as JsonObject;
                var r = ExcelV1Calculator.Calculate(new CalcInput((string?)it?["top"], (string?)it?["down"], (string?)it?["price"]), config);
                if (r.Errors.Count > 0) { Bad($"Item {i + 1}: {r.Errors[0].Message}"); itemFailed = true; break; }
                if (r.Amount is null || r.Karat is null || r.Purity is null || r.NetWeight is null || r.Pounds is null || r.Density is null)
                { Bad($"Item {i + 1}: top, down and price are all needed."); itemFailed = true; break; }
                total += decimal.Parse(r.Amount, CultureInfo.InvariantCulture);
                outItems.Add(new JsonObject
                {
                    ["label"] = ((string?)it!["label"])?.Trim(),
                    ["top"] = ((string?)it["top"])!.Trim(),
                    ["down"] = ((string?)it["down"])!.Trim(),
                    ["price"] = ((string?)it["price"])!.Trim(),
                    ["density"] = r.Density,
                    ["karat"] = r.Karat,
                    ["purity"] = r.Purity,
                    ["netWeight"] = r.NetWeight,
                    ["pounds"] = r.Pounds,
                    ["amount"] = r.Amount,
                });
            }
            if (itemFailed) continue;

            var calculated = decimal.Round(total, 2, MidpointRounding.ToZero);
            var payable = Money(row["amountPaid"]) ?? decimal.Truncate(calculated);
            if (payable < 0) { Bad("The amount paid cannot be negative."); continue; }
            var sheet = Money(row["sheetAmount"]);
            var flags = new JsonArray();
            if (sheet is { } s && Math.Abs(s - calculated) >= 1) flags.Add("CALC_MISMATCH");

            planned.Add(new JsonObject
            {
                ["key"] = key,
                ["branchId"] = branchId,
                ["capturedAt"] = at.ToString("o", CultureInfo.InvariantCulture),
                ["customer"] = new JsonObject { ["name"] = name, ["phone"] = ((string?)row["customerPhone"])?.Trim() },
                ["items"] = outItems,
                ["formulaVersion"] = Formula,
                ["calculatedAmount"] = calculated,
                ["clientAmount"] = sheet ?? calculated,
                ["payable"] = payable,
                ["receiptNo"] = Trim(row["receiptNo"], 40),
                ["note"] = Trim(row["note"], 300),
                ["flags"] = flags,
            });
        }
        if (problems.Count > 0) throw AppException.Invalid("Some rows cannot be imported. Fix them and send again.", problems);

        var payload = new JsonObject { ["batchId"] = batchId, ["label"] = Trim(body["label"], 80), ["rows"] = planned };
        return await store.ImportHistoryAsync(me, payload.ToJsonString(), ct);
    }

    /// <summary>Opening gold per branch and debts owed to the branch on go-live day. One request, applied whole or not at all.</summary>
    public Task<string> ImportOpeningAsync(ICurrentContext me, JsonObject body, CancellationToken ct)
    {
        me.Require(Permissions.ImportsManage);
        if (!Guid.TryParse((string?)body["batchId"], out var batchId) || batchId == Guid.Empty) throw AppException.Invalid("A batch id is needed.");
        if (!DateTimeOffset.TryParse((string?)body["asOf"], CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var asOf)) throw AppException.Invalid("Enter the go-live date.");
        if (asOf > DateTimeOffset.UtcNow) throw AppException.Invalid("The go-live date must not be in the future.");
        if (body["rows"] is not JsonArray rows || rows.Count is < 1 or > 1000) throw AppException.Invalid("Send 1 to 1000 rows.");
        var problems = new Dictionary<string, string[]>();
        var clean = new JsonArray();
        for (var i = 0; i < rows.Count; i++)
        {
            var r = rows[i] as JsonObject;
            void Bad(string m) => problems[$"row {i + 1}"] = [m];
            if (r is null || !Guid.TryParse((string?)r["branchId"], out var branchId)) { Bad("Choose the branch."); continue; }
            me.RequireBranch(branchId);
            var kind = (string?)r["kind"];
            if (kind == "goods")
            {
                var top = Money(r["top"]); var down = Money(r["down"]); var value = Money(r["value"]);
                if (top is not > 0 || down is not >= 0 || value is not >= 0) { Bad("Gold needs a top weight above zero, a down weight and a value."); continue; }
                clean.Add(new JsonObject { ["kind"] = "goods", ["branchId"] = branchId, ["top"] = top, ["down"] = down, ["value"] = value, ["note"] = Trim(r["note"], 200) });
            }
            else if (kind == "debt")
            {
                var name = Trim(r["partyName"], 120); var amount = Money(r["amount"]);
                var type = Trim(r["partyType"], 20) ?? "customer";
                if (name is null) { Bad("Say who owes."); continue; }
                if (amount is not > 0) { Bad($"{name}: the amount owed must be above zero."); continue; }
                if (type is not ("customer" or "staff" or "other")) { Bad($"{name}: the type must be customer, staff or other."); continue; }
                if (type == "customer" && Trim(r["phone"], 30) is null) { Bad($"{name}: a phone number is needed for a customer."); continue; }
                clean.Add(new JsonObject
                {
                    ["kind"] = "debt",
                    ["branchId"] = branchId,
                    ["partyName"] = name,
                    ["partyType"] = type,
                    ["phone"] = Trim(r["phone"], 30),
                    ["amount"] = amount,
                    ["issuedAt"] = Trim(r["issuedAt"], 40),
                    ["dueDate"] = Trim(r["dueDate"], 20),
                    ["reason"] = Trim(r["reason"], 200),
                });
            }
            else Bad("Each row is either gold or a debt.");
        }
        if (problems.Count > 0) throw AppException.Invalid("Some rows cannot be imported. Fix them and send again.", problems);
        var payload = new JsonObject { ["batchId"] = batchId, ["label"] = Trim(body["label"], 80), ["asOf"] = asOf.ToString("o", CultureInfo.InvariantCulture), ["rows"] = clean };
        return store.ImportOpeningAsync(me, payload.ToJsonString(), ct);
    }

    public Task<string> ImportCustomersAsync(ICurrentContext me, JsonObject body, CancellationToken ct)
    {
        me.Require(Permissions.ImportsManage);
        if (body["rows"] is not JsonArray rows || rows.Count is < 1 or > MaxCustomerRows) throw AppException.Invalid($"Send 1 to {MaxCustomerRows} rows at a time.");
        var problems = new Dictionary<string, string[]>();
        var clean = new JsonArray();
        for (var i = 0; i < rows.Count; i++)
        {
            var r = rows[i] as JsonObject;
            var name = ((string?)r?["name"])?.Trim();
            var phone = ((string?)r?["phone"])?.Trim();
            if (string.IsNullOrEmpty(name) || name.Length > 120) problems[$"row {i + 1}"] = ["The name is missing or too long."];
            else if (string.IsNullOrEmpty(phone) || phone.Length > 30) problems[$"row {i + 1}"] = ["The phone number is missing or too long."];
            else clean.Add(new JsonObject { ["name"] = name, ["phone"] = phone, ["notes"] = Trim(r!["notes"], 300) });
        }
        if (problems.Count > 0) throw AppException.Invalid("Some rows cannot be imported. Fix them and send again.", problems);
        return store.ImportCustomersAsync(me, new JsonObject { ["rows"] = clean }.ToJsonString(), ct);
    }

    public Task<string> ListBatchesAsync(ICurrentContext me, CancellationToken ct)
    {
        me.Require(Permissions.ImportsManage);
        return store.ListBatchesAsync(me, ct);
    }

    public Task<string> UndoBatchAsync(ICurrentContext me, Guid batchId, string? reason, CancellationToken ct)
    {
        me.Require(Permissions.ImportsManage);
        if (string.IsNullOrWhiteSpace(reason) || reason.Trim().Length < 5) throw AppException.Invalid("Say why (at least 5 characters).");
        return store.UndoBatchAsync(me, batchId, reason.Trim(), ct);
    }

    private static string? Trim(JsonNode? n, int max) =>
        n is JsonValue v && v.TryGetValue<string>(out var s) && !string.IsNullOrWhiteSpace(s) ? (s.Trim().Length > max ? s.Trim()[..max] : s.Trim()) : null;

    private static decimal? Money(JsonNode? n)
    {
        if (n is not JsonValue v) return null;
        if (v.TryGetValue<decimal>(out var d)) return d;
        return v.TryGetValue<string>(out var s) && decimal.TryParse(s, NumberStyles.Number, CultureInfo.InvariantCulture, out var p) ? p : null;
    }
}
