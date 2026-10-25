namespace GoldValuation.Domain.Calculation;

/// <summary>Constants of the ExcelV1 formula. Stored per company (gold.formula_versions) so history is never rewritten.</summary>
public sealed record CalcConfig(
    string FormulaVersion,
    decimal CorrectionRate,
    decimal PoundGrams,
    decimal PriceReferenceKarat,
    decimal DensityOffset,
    decimal DensityScale)
{
    public static readonly CalcConfig ExcelV1 = new("ExcelV1", 0.007m, 7.75m, 23m, 10.51m, 52.838m);
}

public sealed record CalcIssue(string Field, string Code, string Message);

/// <summary>Raw text as typed, exactly like the web app, so both sides parse identically.</summary>
public sealed record CalcInput(string? Top, string? Down, string? Price);

public sealed record CalcResult(
    string FormulaVersion,
    string? Density,
    string? BaseKarat,
    string? Karat,
    string? Purity,
    string? NetWeight,
    string? Pounds,
    string? Amount,
    IReadOnlyList<string> MissingInputs,
    IReadOnlyList<CalcIssue> Errors,
    IReadOnlyList<CalcIssue> Warnings);
