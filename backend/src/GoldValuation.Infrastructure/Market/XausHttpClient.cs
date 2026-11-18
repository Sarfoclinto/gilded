using GoldValuation.Application.Market;

namespace GoldValuation.Infrastructure.Market;

/// <summary>Asks xaus.com for the live gold spot price (free, no key; at most once a minute, see WorldPriceService).
/// A new HttpClient from the factory each time, so this shared object never holds on to an old connection.</summary>
public sealed class XausHttpClient(IHttpClientFactory factory) : IWorldPriceClient
{
    public const string Name = "xaus";

    public async Task<string> FetchAsync(CancellationToken ct)
    {
        var http = factory.CreateClient(Name);
        using var response = await http.GetAsync("api/v1/spot", ct);
        response.EnsureSuccessStatusCode();
        var text = await response.Content.ReadAsStringAsync(ct);
        return text.Length > 200_000 ? text[..200_000] : text;
    }
}