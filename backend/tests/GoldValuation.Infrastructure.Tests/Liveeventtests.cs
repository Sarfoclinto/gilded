using GoldValuation.Infrastructure.Live;
using Xunit;

namespace GoldValuation.Infrastructure.Tests;

public class LiveEventTests
{
    private static readonly Guid Tenant = Guid.Parse("11111111-1111-4111-8111-111111111111");
    private static readonly Guid Tarkwa = Guid.Parse("22222222-2222-4222-8222-222222222222");
    private static readonly Guid Kumasi = Guid.Parse("44444444-4444-4444-8444-444444444444");

    [Fact]
    public void A_change_goes_to_the_branches_it_names()
    {
        var ev = LiveEvent.Parse($$"""{"type":"changed","t":"{{Tenant}}","topic":"transfers","b":["{{Tarkwa}}","{{Kumasi}}"]}""")!;
        Assert.Equal("transfers", ev.Topic);
        Assert.Equal(new[] { LiveGroups.Branch(Tenant, Tarkwa), LiveGroups.Branch(Tenant, Kumasi) }, ev.Groups());
    }

    [Fact]
    public void A_change_with_no_branches_goes_to_the_whole_company()
    {
        var ev = LiveEvent.Parse($$"""{"type":"changed","t":"{{Tenant}}","topic":"prices","b":null}""")!;
        Assert.Equal(new[] { LiveGroups.Tenant(Tenant) }, ev.Groups());
    }

    [Fact]
    public void A_notification_goes_to_that_person_only()
    {
        var user = Guid.NewGuid();
        var n = Guid.NewGuid();
        var ev = LiveEvent.Parse($$"""{"type":"notification","t":"{{Tenant}}","u":"{{user}}","n":"{{n}}","kind":"transfer_on_the_way","title":"TRF-1 is on the way","link":"/transfers/x"}""")!;
        Assert.Equal(new[] { LiveGroups.User(user) }, ev.Groups());
        Assert.Equal("TRF-1 is on the way", ev.Title);
        Assert.Equal(n, ev.NotificationId);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("not json")]
    [InlineData("[]")]
    [InlineData("""{"type":"changed","topic":"x"}""")]                          // no tenant
    [InlineData("""{"type":"mystery","t":"11111111-1111-4111-8111-111111111111"}""")]
    [InlineData("""{"type":"notification","t":"11111111-1111-4111-8111-111111111111"}""")]   // no user
    public void Anything_malformed_is_ignored(string? payload) => Assert.Null(LiveEvent.Parse(payload));
}
