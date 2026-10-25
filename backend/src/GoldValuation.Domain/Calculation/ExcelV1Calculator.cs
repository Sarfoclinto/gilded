using System.Globalization;
using System.Text.RegularExpressions;

namespace GoldValuation.Domain.Calculation;

/// <summary>
/// The ExcelV1 engine, ported step for step from core-ts/src/calc.ts. Every step truncates (ROUNDDOWN) in the sheet's
/// order, with exact decimal arithmetic, and the single division sits at the end of the amount expression.
/// It must produce the same strings as the TypeScript engine; the shared vectors in /vectors prove it.
/// </summary>
public static partial class ExcelV1Calculator
{
    private const decimal DensityWarningAbove = 19.32m;

    [GeneratedRegex(@"^[+-]?(\d+\.?\d*|\.\d+)$")]
    private static partial Regex PlainNumber();

    private static decimal Trunc(decimal x, int decimals) => Math.Round(x, decimals, MidpointRounding.ToZero);

    private static string Fixed(decimal x, int decimals) => x.ToString("F" + decimals, CultureInfo.InvariantCulture);

    private static decimal? Parse(string? raw, string field, bool mustBePositive, List<CalcIssue> errors)
    {
        if (raw is null) return null;
        var text = raw.Trim();
        if (text.Length == 0) return null;
        if (!PlainNumber().IsMatch(text))
        {
            errors.Add(new CalcIssue(field, "NOT_A_NUMBER", $"{field} must be a plain number."));
            return null;
        }
        var value = decimal.Parse(text, NumberStyles.AllowLeadingSign | NumberStyles.AllowDecimalPoint, CultureInfo.InvariantCulture);
        if (mustBePositive && value <= 0)
        {
            errors.Add(new CalcIssue(field, "MUST_BE_POSITIVE", $"{field} must be greater than zero."));
            return null;
        }
        if (!mustBePositive && value < 0)
        {
            errors.Add(new CalcIssue(field, "MUST_BE_NON_NEGATIVE", $"{field} cannot be negative."));
            return null;
        }
        return value;
    }

    public static IReadOnlyList<CalcIssue> ValidateConfig(CalcConfig c)
    {
        var issues = new List<CalcIssue>();
        void Need(bool ok, string name, string message)
        {
            if (!ok) issues.Add(new CalcIssue("config", "CONFIG_INVALID", $"{name}: {message}"));
        }
        Need(c.CorrectionRate >= 0 && c.CorrectionRate < 1, nameof(c.CorrectionRate), "must be at least 0 and below 1.");
        Need(c.PoundGrams > 0, nameof(c.PoundGrams), "must be greater than zero.");
        Need(c.PriceReferenceKarat > 0 && c.PriceReferenceKarat <= 24, nameof(c.PriceReferenceKarat), "must be above 0 and at most 24.");
        Need(c.DensityOffset >= 0, nameof(c.DensityOffset), "cannot be negative.");
        Need(c.DensityScale > 0, nameof(c.DensityScale), "must be greater than zero.");
        return issues;
    }

    public static CalcResult Calculate(CalcInput input, CalcConfig? config = null)
    {
        var c = config ?? CalcConfig.ExcelV1;
        var errors = new List<CalcIssue>();
        var warnings = new List<CalcIssue>();
        var missing = new List<string>();

        var configIssues = ValidateConfig(c);
        if (configIssues.Count > 0)
        {
            errors.AddRange(configIssues);
            return new CalcResult(c.FormulaVersion, null, null, null, null, null, null, null, missing, errors, warnings);
        }

        var top = Parse(input.Top, "top", true, errors);
        var down = Parse(input.Down, "down", true, errors);
        var price = Parse(input.Price, "price", false, errors);

        static bool Empty(string? v) => string.IsNullOrWhiteSpace(v);
        if (Empty(input.Top)) missing.Add("top");
        if (Empty(input.Down)) missing.Add("down");
        if (Empty(input.Price)) missing.Add("price");

        string? densityText = null, baseKaratText = null, karatText = null, purityText = null, netText = null, poundsText = null, amountText = null;

        decimal? pounds = null;
        if (top is { } t)
        {
            pounds = Trunc(t / c.PoundGrams, 2);
            poundsText = Fixed(pounds.Value, 2);
        }

        decimal? density = null;
        if (top is { } t2 && down is { } d2)
        {
            density = Trunc(t2 / d2, 2);
            densityText = Fixed(density.Value, 2);
            if (density > DensityWarningAbove)
            {
                warnings.Add(new CalcIssue("density", "DENSITY_ABOVE_PURE_GOLD",
                    "Density is above that of pure gold (about 19.3). Check both weights."));
            }
            if (density == 0)
            {
                errors.Add(new CalcIssue("density", "DENSITY_ZERO", "Density rounds to zero. Check both weights."));
                density = null;
            }
        }

        decimal? karat = null;
        if (density is { } dens)
        {
            var baseKarat = Trunc((dens - c.DensityOffset) * c.DensityScale / dens, 2);
            baseKaratText = Fixed(baseKarat, 2);
            karat = Trunc(baseKarat * (1m - c.CorrectionRate), 2);
            karatText = Fixed(karat.Value, 2);
            if (karat <= 0 || karat > 24)
            {
                warnings.Add(new CalcIssue("karat", "KARAT_OUT_OF_RANGE", "Estimated karat is outside 0 to 24. Check both weights."));
            }
        }

        if (karat is { } k && top is { } t3)
        {
            var purity = Trunc(k / 24m, 4);
            purityText = Fixed(purity, 4);
            netText = Fixed(Trunc(purity * t3, 2), 2);
        }

        if (price is { } p && karat is { } k2 && pounds is { } lb)
        {
            amountText = Fixed(Trunc(p * k2 * lb / c.PriceReferenceKarat, 0), 0);
        }

        return new CalcResult(c.FormulaVersion, densityText, baseKaratText, karatText, purityText, netText, poundsText, amountText, missing, errors, warnings);
    }
}
