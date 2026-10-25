using System.Globalization;
using System.Text.Json;
using GoldValuation.Domain.Calculation;
using Xunit;

namespace GoldValuation.Domain.Tests;

public class CalculatorTests
{
    public static IEnumerable<object[]> GoldenRows()
    {
        var root = Vectors.Load("calc-golden.json");
        foreach (var row in root.GetProperty("rows").EnumerateArray())
        {
            yield return [row.GetProperty("name").GetString()!, row.GetRawText()];
        }
    }

    [Theory]
    [MemberData(nameof(GoldenRows))]
    public void Matches_the_excel_sheet_row(string name, string rowJson)
    {
        using var doc = JsonDocument.Parse(rowJson);
        var row = doc.RootElement;
        string S(string key) => row.GetProperty(key).GetString()!;

        var r = Calculator(S("top"), S("down"), S("price"));

        Assert.True(r.Errors.Count == 0, $"{name}: unexpected errors");
        Assert.Equal(S("density"), r.Density);
        Assert.Equal(S("karat"), r.Karat);
        Assert.Equal(S("purity"), r.Purity);
        Assert.Equal(S("netWeight"), r.NetWeight);
        Assert.Equal(S("pounds"), r.Pounds);
        Assert.Equal(S("amount"), r.Amount);
    }

    [Fact]
    public void Missing_inputs_are_reported_not_errors()
    {
        var r = ExcelV1Calculator.Calculate(new CalcInput("10", null, null));
        Assert.Empty(r.Errors);
        Assert.Equal(new[] { "down", "price" }, r.MissingInputs);
        Assert.Equal("1.29", r.Pounds);
        Assert.Null(r.Amount);
    }

    [Theory]
    [InlineData("abc")]
    [InlineData("1e3")]
    [InlineData("1,5")]
    public void Rejects_text_that_is_not_a_plain_number(string bad)
    {
        var r = ExcelV1Calculator.Calculate(new CalcInput(bad, "1", "100"));
        Assert.Contains(r.Errors, e => e.Field == "top" && e.Code == "NOT_A_NUMBER");
    }

    [Fact]
    public void Rejects_zero_and_negative_weights()
    {
        var r = ExcelV1Calculator.Calculate(new CalcInput("0", "-1", "100"));
        Assert.Contains(r.Errors, e => e.Field == "top" && e.Code == "MUST_BE_POSITIVE");
        Assert.Contains(r.Errors, e => e.Field == "down" && e.Code == "MUST_BE_POSITIVE");
    }

    [Fact]
    public void Warns_when_density_is_above_pure_gold()
    {
        var r = ExcelV1Calculator.Calculate(new CalcInput("100", "5", "11650"));
        Assert.Contains(r.Warnings, w => w.Code == "DENSITY_ABOVE_PURE_GOLD");
    }

    [Fact]
    public void Invalid_configuration_is_refused()
    {
        var bad = CalcConfig.ExcelV1 with { CorrectionRate = 1m };
        var r = ExcelV1Calculator.Calculate(new CalcInput("10", "1", "100"), bad);
        Assert.Contains(r.Errors, e => e.Code == "CONFIG_INVALID");
        Assert.Null(r.Amount);
    }

    private static CalcResult Calculator(string top, string down, string price) =>
        ExcelV1Calculator.Calculate(new CalcInput(top, down, price));

    [Fact]
    public void Uses_invariant_culture_for_output()
    {
        var old = CultureInfo.CurrentCulture;
        try
        {
            CultureInfo.CurrentCulture = new CultureInfo("de-DE");
            var r = Calculator("7.77", "0.41", "11650");
            Assert.Equal("11832", r.Amount);
            Assert.Equal("18.95", r.Density);
        }
        finally
        {
            CultureInfo.CurrentCulture = old;
        }
    }
}
