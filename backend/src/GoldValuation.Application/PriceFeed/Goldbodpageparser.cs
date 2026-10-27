using System.Globalization;
using System.Net;
using System.Text.RegularExpressions;

namespace GoldValuation.Application.PriceFeed;

/// <summary>What was read from GoldBod's "Local Gold Prices for Today" block.</summary>
public sealed record ParsedPrice(decimal GhsPerPound, decimal? UsdPerOunce, decimal? Rate, decimal? DiscountPct, DateTimeOffset? PublishedAt, string Excerpt);

/// <summary>
/// Reads the price out of the page's text. The price is part of the page itself (there is no separate data request), so this works on the
/// page's text after tags are removed, anchored on the labels a person reads ("Total Price Per Pound", "LBMA PM Price", "USD 1 = ...").
/// It tolerates changed markup but not changed wording; when it cannot find the price it says so and nothing is recorded.
/// </summary>
public static partial class GoldbodPageParser
{
    [GeneratedRegex(@"<(script|style|noscript)\b[^>]*>.*?</\1>", RegexOptions.Singleline | RegexOptions.IgnoreCase)]
    private static partial Regex Scripts();
    [GeneratedRegex(@"<[^>]+>", RegexOptions.Singleline)]
    private static partial Regex Tags();
    [GeneratedRegex(@"\s+")]
    private static partial Regex Spaces();

    [GeneratedRegex(@"Total\s+Price\s+Per\s+Pound\s*[:\-]?\s*(?:GH[S₵C]|₵)\s*([\d,]+(?:\.\d+)?)", RegexOptions.IgnoreCase)]
    private static partial Regex Total();
    [GeneratedRegex(@"LBMA\s+(?:AM|PM)\s+Price[^U\d]*(?:\(per\s+ounce\))?\s*USD\s*([\d,]+(?:\.\d+)?)", RegexOptions.IgnoreCase)]
    private static partial Regex Lbma();
    [GeneratedRegex(@"USD\s*1\s*=\s*([\d.]+)", RegexOptions.IgnoreCase)]
    private static partial Regex Rate();
    [GeneratedRegex(@"Discount\s+Rate\s*([\d.]+)\s*%", RegexOptions.IgnoreCase)]
    private static partial Regex Discount();
    [GeneratedRegex(@"(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+)\s+(\d{4})\s*@\s*(\d{1,2}):(\d{2})\s*(AM|PM)", RegexOptions.IgnoreCase)]
    private static partial Regex Stamp();

    /// <summary>The page as plain text with single spaces.</summary>
    public static string ToText(string html) =>
        Spaces().Replace(WebUtility.HtmlDecode(Tags().Replace(Scripts().Replace(html, " "), " ")), " ").Trim();

    public static ParsedPrice? Parse(string html, TimeSpan? offset = null)
    {
        var text = ToText(html);
        var total = Total().Match(text);
        if (!total.Success || !TryNumber(total.Groups[1].Value, out var ghs) || ghs <= 0) return null;

        // Look only at the text around the price block, so an unrelated number elsewhere on the page cannot be picked up.
        var from = Math.Max(0, total.Index - 700);
        var block = text.Substring(from, Math.Min(text.Length - from, total.Index - from + total.Length + 100));

        decimal? usd = TryNumber(Lbma().Match(block).Groups[1].Value, out var u) ? u : null;
        decimal? rate = TryNumber(Rate().Match(block).Groups[1].Value, out var r) ? r : null;
        decimal? disc = TryNumber(Discount().Match(block).Groups[1].Value, out var d) ? d : null;

        DateTimeOffset? at = null;
        var s = Stamp().Match(block);
        if (s.Success && DateTime.TryParseExact($"{s.Groups[1].Value} {s.Groups[2].Value} {s.Groups[3].Value} {s.Groups[4].Value}:{s.Groups[5].Value} {s.Groups[6].Value.ToUpperInvariant()}",
                "d MMMM yyyy h:mm tt", CultureInfo.InvariantCulture, DateTimeStyles.None, out var local))
            at = new DateTimeOffset(local, offset ?? TimeSpan.Zero);   // Ghana is UTC+0 all year

        return new ParsedPrice(ghs, usd, rate, disc, at, block.Length > 600 ? block[^600..] : block);
    }

    private static bool TryNumber(string s, out decimal value) =>
        decimal.TryParse(s.Replace(",", ""), NumberStyles.AllowDecimalPoint, CultureInfo.InvariantCulture, out value);
}
