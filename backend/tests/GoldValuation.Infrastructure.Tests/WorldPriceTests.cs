using System.Text.Json.Nodes;
using GoldValuation.Application.Abstractions;
using GoldValuation.Application.Market;
using Xunit;

namespace GoldValuation.Infrastructure.Tests;

public class WorldPriceTests
{
    private static readonly DateTimeOffset Now = DateTimeOffset.Parse("2026-11-18T15:30:00Z");

    private sealed class Clock : IClock { public DateTimeOffset UtcNow { get; set; } = Now; }

    private sealed class Client : IWorldPriceClient
    {
        public Func<string> Answer = () => """{"spot_usd_oz": 3781.204, "updated_at": "2026-11-18T15:29:30.000Z", "source": "xaus.com"}""";
        public int Calls;
        public Task<string> FetchAsync(CancellationToken ct) { Calls++; return Task.FromResult(Answer()); }
    }

    [Fact]
    public void Reads_the_spot_price_and_its_time()
    {
        var q = XausSpotParser.Parse("""{"xau":{"price":4007.2,"currency":"USD","unit":"troy_oz"},"spot_usd_oz":4007.20,"updated_at":"2026-07-02T09:00:00.000Z"}""", Now)!;
        Assert.Equal(4007.20m, q.UsdPerOunce);
        Assert.Equal(DateTimeOffset.Parse("2026-07-02T09:00:00Z"), q.At);
        Assert.Equal("xaus.com", q.Source);
    }

    [Theory]
    [InlineData("not json")]
    [InlineData("""{"spot_usd_oz": 0}""")]
    [InlineData("""{"spot_usd_oz": "abc"}""")]
    [InlineData("""{"error": "rate limited"}""")]
    [InlineData("[]")]
    public void A_broken_answer_gives_no_price(string json) => Assert.Null(XausSpotParser.Parse(json, Now));

    [Fact]
    public void A_time_in_the_future_or_missing_becomes_now()
    {
        Assert.Equal(Now, XausSpotParser.Parse("""{"spot_usd_oz": 3800, "updated_at": "2030-01-01T00:00:00Z"}""", Now)!.At);
        Assert.Equal(Now, XausSpotParser.Parse("""{"spot_usd_oz": 3800}""", Now)!.At);
    }

    [Fact]
    public async Task Asks_the_source_at_most_once_a_minute()
    {
        var clock = new Clock(); var client = new Client(); var svc = new WorldPriceService(client, clock);
        var a = JsonNode.Parse(await svc.GetAsync(default))!;
        Assert.True(a["available"]!.GetValue<bool>());
        Assert.Equal("3781.20", a["usdPerOunce"]!.GetValue<string>());
        await svc.GetAsync(default);
        clock.UtcNow = Now.AddSeconds(59);
        await svc.GetAsync(default);
        Assert.Equal(1, client.Calls);
        clock.UtcNow = Now.AddSeconds(61);
        await svc.GetAsync(default);
        Assert.Equal(2, client.Calls);
    }

    [Fact]
    public async Task Keeps_the_last_good_price_for_a_while_when_the_source_fails()
    {
        var clock = new Clock(); var client = new Client(); var svc = new WorldPriceService(client, clock);
        await svc.GetAsync(default);
        client.Answer = () => throw new HttpRequestException("down");
        clock.UtcNow = Now.AddMinutes(5);
        var b = JsonNode.Parse(await svc.GetAsync(default))!;
        Assert.True(b["available"]!.GetValue<bool>());
        Assert.True(b["stale"]!.GetValue<bool>());
        clock.UtcNow = Now.AddMinutes(31);
        var c = JsonNode.Parse(await svc.GetAsync(default))!;
        Assert.False(c["available"]!.GetValue<bool>());
    }
}