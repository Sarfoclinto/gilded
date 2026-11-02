using System.Text.Json.Nodes;
using GoldValuation.Application.Abstractions;
using GoldValuation.Application.Auth;

namespace GoldValuation.Application.Guide;

/// <summary>
/// The Guide: the business's rules and how-tos. Everyone signed in reads the published articles (so there is no permission to check there);
/// writing, publishing, reminders and seeing who has read need guide:manage. The database validates the content.
/// </summary>
public sealed class GuideService(IGuideStore store, IClock clock)
{
    private static readonly string[] ArticleFields = ["title", "summary", "kind", "categoryId", "mustRead", "blocks", "rev"];

    public Task<string> ReaderAsync(ICurrentContext me, CancellationToken ct) => store.ReaderAsync(me, ct);

    /// <summary>One article. A draft can be opened only by someone who manages the Guide (to preview it).</summary>
    public Task<string> ArticleAsync(ICurrentContext me, Guid id, bool draft, CancellationToken ct)
    {
        if (draft) me.Require(Permissions.GuideManage);
        return store.ArticleAsync(me, id, draft, ct);
    }

    public Task<string> MarkReadAsync(ICurrentContext me, Guid id, CancellationToken ct) => store.MarkReadAsync(me, id, ct);

    public Task<string> AdminAsync(ICurrentContext me, CancellationToken ct) { me.Require(Permissions.GuideManage); return store.AdminAsync(me, ct); }

    public Task<string> SaveCategoryAsync(ICurrentContext me, Guid id, JsonObject body, CancellationToken ct)
    {
        me.Require(Permissions.GuideManage);
        var p = new JsonObject { ["id"] = id.ToString(), ["name"] = body["name"]?.DeepClone() };
        if (body.ContainsKey("position")) p["position"] = body["position"]?.DeepClone();
        return store.SaveCategoryAsync(me, p.ToJsonString(), ct);
    }

    public Task<string> DeleteCategoryAsync(ICurrentContext me, Guid id, CancellationToken ct) { me.Require(Permissions.GuideManage); return store.DeleteCategoryAsync(me, id, ct); }

    /// <summary>Create or update an article (the id comes from the route; a new one is made on the device, so saving twice is safe).</summary>
    public Task<string> SaveArticleAsync(ICurrentContext me, Guid id, JsonObject body, CancellationToken ct)
    {
        me.Require(Permissions.GuideManage);
        var p = new JsonObject { ["id"] = id.ToString() };
        foreach (var f in ArticleFields) if (body.TryGetPropertyValue(f, out var v)) p[f] = v?.DeepClone();
        return store.SaveArticleAsync(me, p.ToJsonString(), ct);
    }

    public Task<string> PublishAsync(ICurrentContext me, Guid id, JsonObject body, CancellationToken ct)
    {
        me.Require(Permissions.GuideManage);
        var p = new JsonObject();
        foreach (var f in new[] { "notify", "material" }) if (body.TryGetPropertyValue(f, out var v)) p[f] = v?.DeepClone();
        return store.PublishAsync(me, id, p.ToJsonString(), ct);
    }

    public Task<string> UnpublishAsync(ICurrentContext me, Guid id, CancellationToken ct) { me.Require(Permissions.GuideManage); return store.UnpublishAsync(me, id, ct); }
    public Task<string> DeleteArticleAsync(ICurrentContext me, Guid id, CancellationToken ct) { me.Require(Permissions.GuideManage); return store.DeleteArticleAsync(me, id, ct); }
    public Task<string> ReadersAsync(ICurrentContext me, Guid id, CancellationToken ct) { me.Require(Permissions.GuideManage); return store.ReadersAsync(me, id, ct); }

    public Task<string> SaveRemindersAsync(ICurrentContext me, JsonObject body, CancellationToken ct)
    {
        me.Require(Permissions.GuideManage);
        var p = new JsonObject();
        foreach (var f in new[] { "frequency", "time", "weekday", "audience" }) if (body.TryGetPropertyValue(f, out var v)) p[f] = v?.DeepClone();
        return store.SaveRemindersAsync(me, p.ToJsonString(), ct);
    }

    /// <summary>The worker's call, for every company that has reminders on.</summary>
    public async Task<int> RunRemindersAsync(Guid tenantId, CancellationToken ct) => await store.RunRemindersAsync(tenantId, clock.UtcNow, ct);
    public Task<IReadOnlyList<Guid>> ReminderCompaniesAsync(CancellationToken ct) => store.ReminderCompaniesAsync(ct);
}