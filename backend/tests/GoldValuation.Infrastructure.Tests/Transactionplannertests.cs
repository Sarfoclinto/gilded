using System.Text.Json.Nodes;
using GoldValuation.Application.Abstractions;
using GoldValuation.Application.Operations;
using GoldValuation.Domain.Calculation;
using Xunit;

namespace GoldValuation.Infrastructure.Tests;

public class TransactionPlannerTests
{
    private static readonly DateTimeOffset Now = new(2026, 10, 23, 9, 0, 0, TimeSpan.Zero);
    private static readonly Guid Branch = Guid.Parse("22222222-2222-4222-8222-222222222222");
    private static readonly Guid Kumasi = Guid.Parse("11111111-1111-4111-8111-111111111111");

    // MR ALEX from the shared golden vectors: 7.77 / 0.41 / 11650 is worth 11832 cedis.
    private static ItemCommand Item() => new(Guid.NewGuid(), "ring", "7.77", "0.41", "11650");

    private static CreateTransactionCommand Cmd(PayoutCommand payout, Action<List<ItemCommand>>? edit = null, string? name = "Kwesi",
        string? client = "11832", DateTimeOffset? captured = null, DateTimeOffset? priceAsOf = null)
    {
        var items = new List<ItemCommand> { Item() };
        edit?.Invoke(items);
        return new CreateTransactionCommand(Guid.NewGuid(), Branch, name, "0240000000", null, items, client, payout,
            captured ?? Now, priceAsOf ?? Now, null);
    }

    [Fact]
    public void A_representative_is_passed_on_and_needs_a_name_when_a_phone_is_given()
    {
        var withRep = Cmd(Payout("11830", new() { ["100"] = 118, ["20"] = 1, ["10"] = 1 })) with { Representative = new PersonRef(" Yaw ", " 0555 ") };
        var plan = Plan(withRep);
        Assert.Equal("Yaw", plan["representative"]!["name"]!.GetValue<string>());
        Assert.Equal("0555", plan["representative"]!["phone"]!.GetValue<string>());
        Assert.Null(Plan(Cmd(Payout("11830", new() { ["100"] = 118, ["20"] = 1, ["10"] = 1 })))["representative"]);

        var noName = withRep with { Representative = new PersonRef(null, "0555") };
        var ex = Assert.Throws<AppException>(() => Plan(noName));
        Assert.Equal(422, ex.Status);
    }

    private static PayoutCommand Payout(string payable, Dictionary<string, int>? lines, List<SplitCommand>? split = null) =>
        new("down", "fewest-notes", payable, lines, split);

    private static JsonObject Plan(CreateTransactionCommand c) => TransactionPlanner.Plan(c, CalcConfig.ExcelV1, Now);

    [Fact]
    public void A_cash_only_purchase_is_recalculated_and_paid_in_notes()
    {
        var p = Plan(Cmd(Payout("11830", new() { ["100"] = 118, ["20"] = 1, ["10"] = 1 })));
        Assert.Equal(11832m, p["calculatedAmount"]!.GetValue<decimal>());
        Assert.Equal(11830m, p["payable"]!.GetValue<decimal>());
        Assert.Equal(-2m, p["difference"]!.GetValue<decimal>());
        var payments = p["payments"]!.AsArray();
        Assert.Single(payments);
        Assert.Equal("cash", payments[0]!["method"]!.GetValue<string>());
        Assert.Equal(11830m, payments[0]!["amount"]!.GetValue<decimal>());
        Assert.Empty(p["flags"]!.AsArray());
        Assert.Equal("23.36", p["items"]![0]!["karat"]!.GetValue<string>());
    }

    [Fact]
    public void A_split_payment_has_cash_for_whatever_the_other_parts_leave()
    {
        var split = new List<SplitCommand>
        {
            new("mobile_money", "5000", Kumasi, "MM123", null, null, null),
            new("owed", "1830", null, null, null, null, null),
        };
        var p = Plan(Cmd(Payout("11830", new() { ["100"] = 50 }, split)));
        var payments = p["payments"]!.AsArray();
        Assert.Equal(3, payments.Count);
        Assert.Equal("cash", payments[0]!["method"]!.GetValue<string>());
        Assert.Equal(5000m, payments[0]!["amount"]!.GetValue<decimal>());
        Assert.Equal("mobile_money", payments[1]!["method"]!.GetValue<string>());
        Assert.Equal("owed", payments[2]!["method"]!.GetValue<string>());
    }

    [Fact]
    public void Gold_that_settles_a_debt_in_full_needs_no_cash_and_no_notes()
    {
        var split = new List<SplitCommand> { new("debt_offset", "11830", null, null, Guid.NewGuid(), null, null) };
        var p = Plan(Cmd(Payout("11830", null, split)));
        Assert.Single(p["payments"]!.AsArray());
        Assert.Equal("debt_offset", p["payments"]![0]!["method"]!.GetValue<string>());
    }

    [Theory]
    [InlineData("11830", 118, 1)]      // notes add up to 11820, not 11830
    [InlineData("11832", 118, 1)]      // not a multiple of 5
    public void Notes_that_do_not_make_the_amount_are_refused(string payable, int hundreds, int twenties)
    {
        var lines = new Dictionary<string, int> { ["100"] = hundreds, ["20"] = twenties };
        var ex = Assert.Throws<AppException>(() => Plan(Cmd(Payout(payable, lines))));
        Assert.Equal("PAYOUT_MISMATCH", ex.Code);
    }

    [Fact]
    public void Parts_larger_than_the_amount_are_refused()
    {
        var split = new List<SplitCommand> { new("owed", "20000", null, null, null, null, null) };
        var ex = Assert.Throws<AppException>(() => Plan(Cmd(Payout("11830", null, split))));
        Assert.Equal("PAYOUT_MISMATCH", ex.Code);
    }

    [Fact]
    public void A_note_that_does_not_exist_is_refused()
    {
        var ex = Assert.Throws<AppException>(() => Plan(Cmd(Payout("35", new() { ["7"] = 5 }))));
        Assert.Equal("BAD_DENOMINATION", ex.Code);
    }

    [Fact]
    public void Mobile_money_must_say_who_sends_it_and_a_debt_offset_which_debt()
    {
        var momo = new List<SplitCommand> { new("mobile_money", "1000", null, null, null, null, null) };
        Assert.Equal(422, Assert.Throws<AppException>(() => Plan(Cmd(Payout("11830", new() { ["100"] = 108, ["20"] = 1, ["10"] = 1 }, momo)))).Status);
        var offset = new List<SplitCommand> { new("debt_offset", "1000", null, null, null, null, null) };
        Assert.Equal(422, Assert.Throws<AppException>(() => Plan(Cmd(Payout("11830", new() { ["100"] = 108, ["20"] = 1, ["10"] = 1 }, offset)))).Status);
        var unknown = new List<SplitCommand> { new("cheque", "1000", null, null, null, null, null) };
        Assert.Equal(422, Assert.Throws<AppException>(() => Plan(Cmd(Payout("11830", null, unknown)))).Status);
    }

    [Fact]
    public void Flags_describe_how_the_purchase_arrived_without_refusing_it()
    {
        var cash = Payout("11830", new() { ["100"] = 118, ["20"] = 1, ["10"] = 1 });
        var flags = Plan(Cmd(cash, client: "11900", captured: Now.AddMinutes(-10), priceAsOf: Now.AddHours(-13)))["flags"]!
            .AsArray().Select(f => f!.GetValue<string>()).ToList();
        Assert.Contains("CALC_MISMATCH", flags);
        Assert.Contains("OFFLINE_ENTRY", flags);
        Assert.Contains("PRICE_STALE", flags);
    }

    [Fact]
    public void An_item_that_cannot_be_calculated_is_named_in_the_error()
    {
        var ex = Assert.Throws<AppException>(() => Plan(Cmd(Payout("0", null), items => items[0] = items[0] with { Top = "abc" })));
        Assert.Equal(422, ex.Status);
        Assert.NotNull(ex.FieldErrors);
        Assert.Contains("items.0", ex.FieldErrors!.Keys);
    }

    [Fact]
    public void The_customer_name_and_at_least_one_item_are_required()
    {
        var cash = Payout("11830", new() { ["100"] = 118, ["20"] = 1, ["10"] = 1 });
        Assert.Contains("customerName", Assert.Throws<AppException>(() => Plan(Cmd(cash, name: " "))).FieldErrors!.Keys);
        Assert.Contains("items", Assert.Throws<AppException>(() => Plan(Cmd(cash, items => items.Clear()))).FieldErrors!.Keys);
    }

    [Fact]
    public void Lines_parse_only_real_denominations_and_positive_counts()
    {
        Assert.Equal(3, TransactionPlanner.ParseLines(new() { ["100"] = 3 })[100]);
        Assert.Equal("BAD_COUNT", Assert.Throws<AppException>(() => TransactionPlanner.ParseLines(new() { ["100"] = 0 })).Code);
        Assert.Equal("BAD_DENOMINATION", Assert.Throws<AppException>(() => TransactionPlanner.ParseLines(new() { ["abc"] = 1 })).Code);
        Assert.Empty(TransactionPlanner.ParseLines(null));
    }

    [Fact]
    public void Whole_cedis_accept_digits_only()
    {
        Assert.Equal(11830m, TransactionPlanner.WholeCedis(" 11830 ", "x"));
        foreach (var bad in new[] { "11830.5", "-5", "1e3", "", null })
            Assert.Equal(422, Assert.Throws<AppException>(() => TransactionPlanner.WholeCedis(bad, "x")).Status);
    }
}
