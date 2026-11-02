using System.Text.Json.Nodes;
using GoldValuation.Application.Abstractions;
using GoldValuation.Application.Auth;
using GoldValuation.Application.Guide;
using Xunit;

namespace GoldValuation.Infrastructure.Tests;

public class GuideServiceTests
{
    private static readonly Guid Tenant = Guid.Parse("44444444-4444-4444-8444-444444444444");
    private static readonly Guid Article = Guid.Parse("bbbbbbbb-0000-4000-8000-000000000001");
    private sealed class Ctx(params string[] permissions) : ICurrentContext
    {
        public Guid TenantId => Tenant;
        public Guid UserId => Guid.Parse("aaaaaaaa-0000-4000-8000-000000000001");
        public IReadOnlySet<Guid> BranchIds { get; } = new HashSet<Guid>();
        public bool Has(string permission) => permissions.Contains(permission);
    }
    private sealed class Clock : IClock { public DateTimeOffset UtcNow => new(2026, 11, 2, 8, 0, 0, TimeSpan.Zero); }

    private sealed class FakeStore : IGuideStore
    {
        public List<string> Calls = [];
        public string? LastJson;
        private Task<string> Hit(string name, string? json = null) { Calls.Add(name); LastJson = json; return Task.FromResult("{}"); }
        public Task<string> ReaderAsync(ICurrentContext me, CancellationToken ct) => Hit("reader");
        public Task<string> ArticleAsync(ICurrentContext me, Guid id, bool includeDraft, CancellationToken ct) => Hit(includeDraft ? "article-draft" : "article");
        public Task<string> MarkReadAsync(ICurrentContext me, Guid id, CancellationToken ct) => Hit("read");
        public Task<string> AdminAsync(ICurrentContext me, CancellationToken ct) => Hit("admin");
        public Task<string> SaveCategoryAsync(ICurrentContext me, string json, CancellationToken ct) => Hit("save-category", json);
        public Task<string> DeleteCategoryAsync(ICurrentContext me, Guid id, CancellationToken ct) => Hit("delete-category");
        public Task<string> SaveArticleAsync(ICurrentContext me, string json, CancellationToken ct) => Hit("save-article", json);
        public Task<string> PublishAsync(ICurrentContext me, Guid id, string json, CancellationToken ct) => Hit("publish", json);
        public Task<string> UnpublishAsync(ICurrentContext me, Guid id, CancellationToken ct) => Hit("unpublish");
        public Task<string> DeleteArticleAsync(ICurrentContext me, Guid id, CancellationToken ct) => Hit("delete-article");
        public Task<string> ReadersAsync(ICurrentContext me, Guid id, CancellationToken ct) => Hit("readers");
        public Task<string> SaveRemindersAsync(ICurrentContext me, string json, CancellationToken ct) => Hit("reminders", json);
        public Task<IReadOnlyList<Guid>> ReminderCompaniesAsync(CancellationToken ct) => Task.FromResult<IReadOnlyList<Guid>>([Tenant]);
        public Task<int> RunRemindersAsync(Guid tenantId, DateTimeOffset now, CancellationToken ct) { Calls.Add("run"); return Task.FromResult(2); }
    }

    private static (GuideService Svc, FakeStore Store) Make() { var s = new FakeStore(); return (new GuideService(s, new Clock()), s); }

    [Fact]
    public async Task Everyone_signed_in_can_read_and_mark_read()
    {
        var (svc, store) = Make();
        var teller = new Ctx(Permissions.CalculatorUse);
        await svc.ReaderAsync(teller, default);
        await svc.ArticleAsync(teller, Article, false, default);
        await svc.MarkReadAsync(teller, Article, default);
        Assert.Equal(["reader", "article", "read"], store.Calls);
    }

    [Fact]
    public async Task Only_people_who_manage_the_guide_can_write_publish_or_see_drafts()
    {
        var (svc, store) = Make();
        var teller = new Ctx(Permissions.CalculatorUse, Permissions.SettingsManage);
        var body = new JsonObject { ["title"] = "Privacy" };
        await Assert.ThrowsAsync<AppException>(() => svc.AdminAsync(teller, default));
        await Assert.ThrowsAsync<AppException>(() => svc.ArticleAsync(teller, Article, true, default));
        await Assert.ThrowsAsync<AppException>(() => svc.SaveArticleAsync(teller, Article, body, default));
        await Assert.ThrowsAsync<AppException>(() => svc.PublishAsync(teller, Article, new JsonObject(), default));
        await Assert.ThrowsAsync<AppException>(() => svc.SaveCategoryAsync(teller, Article, body, default));
        await Assert.ThrowsAsync<AppException>(() => svc.ReadersAsync(teller, Article, default));
        await Assert.ThrowsAsync<AppException>(() => svc.SaveRemindersAsync(teller, new JsonObject(), default));
        Assert.Empty(store.Calls);
    }

    [Fact]
    public async Task Saving_passes_only_the_known_fields_and_takes_the_id_from_the_route()
    {
        var (svc, store) = Make();
        var director = new Ctx(Permissions.GuideManage);
        await svc.SaveArticleAsync(director, Article, new JsonObject { ["id"] = "someone-elses", ["title"] = "Privacy", ["blocks"] = new JsonArray(), ["status"] = "published", ["version"] = 9 }, default);
        var sent = JsonNode.Parse(store.LastJson!)!.AsObject();
        Assert.Equal(Article.ToString(), (string?)sent["id"]);
        Assert.Equal("Privacy", (string?)sent["title"]);
        Assert.False(sent.ContainsKey("status"));
        Assert.False(sent.ContainsKey("version"));
    }

    [Fact]
    public async Task Reminders_pass_only_their_four_settings_and_the_worker_runs_through_the_clock()
    {
        var (svc, store) = Make();
        await svc.SaveRemindersAsync(new Ctx(Permissions.GuideManage), new JsonObject { ["frequency"] = "daily", ["time"] = "08:00", ["extra"] = 1 }, default);
        var sent = JsonNode.Parse(store.LastJson!)!.AsObject();
        Assert.Equal("daily", (string?)sent["frequency"]);
        Assert.False(sent.ContainsKey("extra"));
        Assert.Equal(2, await svc.RunRemindersAsync(Tenant, default));
    }
}