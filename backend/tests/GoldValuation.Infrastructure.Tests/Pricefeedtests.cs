using System.Text.Json.Nodes;
using GoldValuation.Application.Abstractions;
using GoldValuation.Application.Auth;
using GoldValuation.Application.PriceFeed;
using Xunit;

namespace GoldValuation.Infrastructure.Tests;

public class PriceFeedTests
{
    private const string Page = """
        <html><head><script>var price = 1;</script></head><body>
        <div class="modal"><h3>GoldBod Approved Purchase Price per Pound<br/>(Based on LBMA PM Price | Valid: 3:00 PM - 8:30 PM)</h3>
        <h4>Tuesday, 27th October 2026 @ 3:00 PM</h4>
        <p>LBMA PM Price (per ounce)</p><strong>USD 4,057.25</strong>
        <p>Reference Rate for financing window</p><strong>USD 1 = 11.55</strong>
        <p>Discount Rate</p><strong>0%</strong><p>Total Price Per Pound</p><strong>GHS&nbsp;11,194.00</strong></div></body></html>
        """;

    private static FeedState State(decimal? latestBase = 11000m, DateTimeOffset? lastChecked = null, DateTimeOffset? lastCaptured = null, DateTimeOffset? latestPublished = null,
        string windows = "10:30-11:30/5,15:00-16:00/5", string days = "1,2,3,4,5") =>
        new(true, windows.Split(',').Select(w => { var a = w.Split('-', '/'); return new FeedWindow(TimeOnly.Parse(a[0]), TimeOnly.Parse(a[1]), int.Parse(a[2])); }).ToList(),
            days.Split(',').Select(int.Parse).ToHashSet(), "Africa/Accra", 10m, Guid.NewGuid(), lastChecked, lastCaptured, latestPublished, latestBase, 7.75m, 23m);

    // Tuesday 27 October 2026 (Ghana is UTC+0)
    private static DateTimeOffset At(string time, int day = 27) => DateTimeOffset.Parse($"2026-10-{day:00}T{time}:00Z");

    // ------------------------------------------------------------------ reading the page
    [Fact]
    public void Reads_the_price_the_rate_and_the_time_from_the_page_text()
    {
        var p = GoldbodPageParser.Parse(Page)!;
        Assert.Equal(11194.00m, p.GhsPerPound);
        Assert.Equal(4057.25m, p.UsdPerOunce);
        Assert.Equal(11.55m, p.Rate);
        Assert.Equal(0m, p.DiscountPct);
        Assert.Equal(At("15:00"), p.PublishedAt);
    }

    [Fact]
    public void Finds_nothing_when_the_wording_is_not_there_and_ignores_scripts()
    {
        Assert.Null(GoldbodPageParser.Parse("<html><body>Welcome to GoldBod</body></html>"));
        Assert.Null(GoldbodPageParser.Parse("<script>Total Price Per Pound GHS 5</script><p>nothing</p>"));
    }

    [Fact]
    public void Reads_a_price_even_when_only_the_total_is_shown()
    {
        var p = GoldbodPageParser.Parse("<b>Total Price Per Pound</b> <i>GHS 9,500</i>")!;
        Assert.Equal(9500m, p.GhsPerPound);
        Assert.Null(p.UsdPerOunce);
        Assert.Null(p.PublishedAt);
    }

    // ------------------------------------------------------------------ deciding
    [Fact]
    public void A_new_price_that_matches_its_own_figures_is_applied_and_the_workings_agree_with_the_calculators_constants()
    {
        var p = GoldbodPageParser.Parse(Page)!;
        var d = FeedDecider.Decide(p, State());
        Assert.Equal("applied", d.Kind);
        Assert.InRange(d.Computed!.Value, 11189m, 11190m);
    }

    [Fact]
    public void The_same_publication_is_not_applied_twice()
    {
        var p = GoldbodPageParser.Parse(Page)!;
        Assert.Equal("unchanged", FeedDecider.Decide(p, State(latestPublished: At("15:00"))).Kind);
        Assert.Equal("applied", FeedDecider.Decide(p, State(latestPublished: At("10:30"))).Kind);
    }

    [Fact]
    public void A_price_that_disagrees_with_its_own_dollar_price_is_held()
    {
        var p = GoldbodPageParser.Parse(Page.Replace("11,194.00", "12,500.00"))!;
        Assert.Equal("held", FeedDecider.Decide(p, State(latestBase: 12400m)).Kind);
    }

    [Fact]
    public void A_big_jump_is_held_and_a_small_move_is_not()
    {
        var p = GoldbodPageParser.Parse("Total Price Per Pound GHS 11,194.00")!;
        Assert.Equal("held", FeedDecider.Decide(p, State(latestBase: 9000m)).Kind);
        Assert.Equal("applied", FeedDecider.Decide(p, State(latestBase: 10800m)).Kind);
        Assert.Equal("unchanged", FeedDecider.Decide(p, State(latestBase: 11194m)).Kind);
    }

    // ------------------------------------------------------------------ the schedule
    [Fact]
    public void It_looks_only_inside_a_window_on_a_chosen_day_and_at_the_chosen_interval()
    {
        Assert.False(FeedSchedule.IsDue(State(), At("10:00")));                                              // before the window
        Assert.True(FeedSchedule.IsDue(State(), At("10:30")));                                               // window opens
        Assert.True(FeedSchedule.IsDue(State(lastChecked: At("10:31")), At("10:37")));                       // 5 minutes later
        Assert.False(FeedSchedule.IsDue(State(lastChecked: At("10:31")), At("10:33")));                      // too soon
        Assert.False(FeedSchedule.IsDue(State(), At("11:30")));                                              // window closed
        Assert.True(FeedSchedule.IsDue(State(), At("15:10")));                                               // the afternoon window
        Assert.False(FeedSchedule.IsDue(State(), At("10:45", 25)));                                          // a Sunday
        Assert.False(FeedSchedule.IsDue(State() with { Enabled = false }, At("10:45")));
        Assert.False(FeedSchedule.IsDue(State() with { Actor = null }, At("10:45")));
    }

    [Fact]
    public void A_window_stops_looking_once_its_price_has_been_captured()
    {
        Assert.False(FeedSchedule.IsDue(State(lastCaptured: At("10:41"), lastChecked: At("10:41")), At("10:50")));
        Assert.True(FeedSchedule.IsDue(State(lastCaptured: At("10:41"), lastChecked: At("10:41")), At("15:05")));   // the next window is fresh
        Assert.True(FeedSchedule.IsDue(State(lastCaptured: At("09:00", 26)), At("10:35")));                          // yesterday's capture does not count
    }

    // ------------------------------------------------------------------ the service
    private static readonly Guid Tenant = Guid.Parse("33333333-3333-4333-8333-333333333333");
    private sealed class Ctx(params string[] permissions) : ICurrentContext
    {
        public Guid TenantId => Tenant;
        public Guid UserId => Guid.Parse("aaaaaaaa-0000-4000-8000-000000000001");
        public IReadOnlySet<Guid> BranchIds { get; } = new HashSet<Guid>();
        public bool Has(string permission) => permissions.Contains(permission);
    }
    private sealed class Clock(DateTimeOffset now) : IClock { public DateTimeOffset UtcNow => now; }

    private sealed class FakeStore(FeedState? state) : IPriceFeedStore
    {
        public string? Saved, Recorded;
        public Task<string> GetAsync(ICurrentContext me, CancellationToken ct) => Task.FromResult("{}");
        public Task<string> SaveAsync(ICurrentContext me, string settingsJson, CancellationToken ct) { Saved = settingsJson; return Task.FromResult("{}"); }
        public Task<string> DecideAsync(ICurrentContext me, Guid eventId, bool accept, CancellationToken ct) => Task.FromResult("{}");
        public Task<IReadOnlyList<Guid>> EnabledCompaniesAsync(CancellationToken ct) => Task.FromResult<IReadOnlyList<Guid>>([Tenant]);
        public Task<string?> StateAsync(Guid tenantId, CancellationToken ct) => Task.FromResult(state is null ? null : (string?)StateJson(state));
        public Task<string> RecordAsync(Guid tenantId, Guid actor, string resultJson, CancellationToken ct) { Recorded = resultJson; return Task.FromResult("{}"); }
    }

    private static string StateJson(FeedState s) => new JsonObject
    {
        ["enabled"] = s.Enabled,
        ["windows"] = new JsonArray(s.Windows.Select(w => (JsonNode)new JsonObject { ["start"] = w.Start.ToString("HH:mm"), ["end"] = w.End.ToString("HH:mm"), ["everyMinutes"] = w.EveryMinutes }).ToArray()),
        ["weekdays"] = new JsonArray(s.Weekdays.Select(d => (JsonNode)JsonValue.Create(d)!).ToArray()),
        ["timezone"] = s.TimeZone,
        ["maxJumpPct"] = s.MaxJumpPct,
        ["actor"] = s.Actor,
        ["latestBase"] = s.LatestBase,
        ["poundGrams"] = "7.75",
        ["referenceKarat"] = "23",
        ["lastCheckedAt"] = s.LastCheckedAt?.ToString("o"),
        ["lastCapturedAt"] = s.LastCapturedAt?.ToString("o"),
        ["latestFeedPublishedAt"] = s.LatestFeedPublishedAt?.ToString("o"),
    }.ToJsonString();

    private sealed class FakeClient(string? html) : IGoldbodClient
    {
        public int Calls;
        public Task<string> FetchPageAsync(CancellationToken ct) { Calls++; return html is null ? throw new HttpRequestException("down") : Task.FromResult(html); }
    }

    private static PriceFeedService Svc(FakeStore store, FakeClient client, DateTimeOffset now) => new(store, client, new Clock(now));

    [Fact]
    public async Task Everything_needs_the_price_approval_permission()
    {
        var svc = Svc(new FakeStore(State()), new FakeClient(Page), At("10:35"));
        var nobody = new Ctx(Permissions.TransactionsRead);
        await Assert.ThrowsAsync<AppException>(() => svc.GetAsync(nobody, default));
        await Assert.ThrowsAsync<AppException>(() => svc.SaveAsync(nobody, new JsonObject(), default));
        await Assert.ThrowsAsync<AppException>(() => svc.PreviewAsync(nobody, default));
        await Assert.ThrowsAsync<AppException>(() => svc.CheckNowAsync(nobody, default));
        await Assert.ThrowsAsync<AppException>(() => svc.DecideAsync(nobody, Guid.NewGuid(), true, default));
    }

    [Fact]
    public async Task The_worker_looks_when_due_records_the_price_and_does_not_look_when_not_due()
    {
        var store = new FakeStore(State());
        var client = new FakeClient(Page);
        Assert.False(await Svc(store, client, At("12:00")).RunIfDueAsync(Tenant, default));
        Assert.Equal(0, client.Calls);
        Assert.True(await Svc(store, client, At("15:05")).RunIfDueAsync(Tenant, default));
        var sent = JsonNode.Parse(store.Recorded!)!;
        Assert.Equal("applied", (string?)sent["kind"]);
        Assert.Equal(11194m, (decimal)sent["basePrice"]!);
    }

    [Fact]
    public async Task A_page_without_the_price_and_an_unreachable_site_are_recorded_as_failures()
    {
        var store = new FakeStore(State());
        await Svc(store, new FakeClient("<html>redesigned</html>"), At("15:05")).RunIfDueAsync(Tenant, default);
        Assert.Equal("failed", (string?)JsonNode.Parse(store.Recorded!)!["kind"]);
        await Svc(store, new FakeClient(null), At("15:05")).RunIfDueAsync(Tenant, default);
        Assert.Contains("could not be reached", (string?)JsonNode.Parse(store.Recorded!)!["message"]);
    }

    [Fact]
    public async Task Saving_forwards_only_the_known_settings_and_the_preview_records_nothing()
    {
        var store = new FakeStore(State());
        var svc = Svc(store, new FakeClient(Page), At("10:35"));
        var director = new Ctx(Permissions.PricesApprove);
        await svc.SaveAsync(director, JsonNode.Parse("""{"enabled":true,"timezone":"Africa/Accra","marginPolicy":"carry","maxJumpPct":8,"updatedBy":"x","weekdays":[1,2],"windows":[{"start":"10:30","end":"11:30","everyMinutes":5,"extra":1}]}""")!.AsObject(), default);
        var saved = JsonNode.Parse(store.Saved!)!;
        Assert.Null(saved["updatedBy"]);
        Assert.Equal("carry", (string?)saved["marginPolicy"]);
        Assert.Null(saved["windows"]![0]!["extra"]);

        var preview = JsonNode.Parse(await svc.PreviewAsync(director, default))!;
        Assert.True((bool)preview["found"]!);
        Assert.Equal(11194m, (decimal)preview["price"]!["ghsPerPound"]!);
        Assert.Null(store.Recorded);
        await Assert.ThrowsAsync<AppException>(() => svc.SaveAsync(director, new JsonObject(), default));   // no check times
    }
}
