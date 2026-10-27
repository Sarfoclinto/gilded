using GoldValuation.Application.PriceFeed;

namespace GoldValuation.Infrastructure.PriceFeed;

/// <summary>Fetches GoldBod's home page. The address is fixed in configuration (PriceFeed:Url), never chosen by a user, so it cannot be pointed elsewhere.</summary>
public sealed class GoldbodHttpClient(HttpClient http) : IGoldbodClient
{
    public async Task<string> FetchPageAsync(CancellationToken ct)
    {
        using var response = await http.GetAsync("", ct);
        response.EnsureSuccessStatusCode();
        var text = await response.Content.ReadAsStringAsync(ct);
        return text.Length > 3_000_000 ? text[..3_000_000] : text;
    }
}
