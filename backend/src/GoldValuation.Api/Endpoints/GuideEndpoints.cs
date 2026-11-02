using System.Text.Json.Nodes;
using GoldValuation.Application.Abstractions;
using GoldValuation.Application.Guide;

namespace GoldValuation.Api.Endpoints;

/// <summary>The business's rules and guides. Reading is for everyone signed in; the /guide/admin routes need guide:manage.</summary>
public static class GuideEndpoints
{
    private static IResult Data(string json) => new RawJsonResult(200, $"{{\"data\":{json}}}");

    public static RouteGroupBuilder MapGuide(this RouteGroupBuilder api)
    {
        api.MapGet("/guide", async (ICurrentContext me, GuideService svc, CancellationToken ct) => Data(await svc.ReaderAsync(me, ct)));
        api.MapGet("/guide/articles/{id:guid}", async (Guid id, bool? draft, ICurrentContext me, GuideService svc, CancellationToken ct) => Data(await svc.ArticleAsync(me, id, draft ?? false, ct)));
        api.MapPost("/guide/articles/{id:guid}/read", async (Guid id, ICurrentContext me, GuideService svc, CancellationToken ct) => Data(await svc.MarkReadAsync(me, id, ct)));

        api.MapGet("/guide/admin", async (ICurrentContext me, GuideService svc, CancellationToken ct) => Data(await svc.AdminAsync(me, ct)));
        api.MapPut("/guide/admin/categories/{id:guid}", async (Guid id, JsonObject body, ICurrentContext me, GuideService svc, CancellationToken ct) => Data(await svc.SaveCategoryAsync(me, id, body, ct)));
        api.MapDelete("/guide/admin/categories/{id:guid}", async (Guid id, ICurrentContext me, GuideService svc, CancellationToken ct) => Data(await svc.DeleteCategoryAsync(me, id, ct)));
        api.MapPut("/guide/admin/articles/{id:guid}", async (Guid id, JsonObject body, ICurrentContext me, GuideService svc, CancellationToken ct) => Data(await svc.SaveArticleAsync(me, id, body, ct)));
        api.MapPost("/guide/admin/articles/{id:guid}/publish", async (Guid id, JsonObject body, ICurrentContext me, GuideService svc, CancellationToken ct) => Data(await svc.PublishAsync(me, id, body, ct)));
        api.MapPost("/guide/admin/articles/{id:guid}/unpublish", async (Guid id, ICurrentContext me, GuideService svc, CancellationToken ct) => Data(await svc.UnpublishAsync(me, id, ct)));
        api.MapDelete("/guide/admin/articles/{id:guid}", async (Guid id, ICurrentContext me, GuideService svc, CancellationToken ct) => Data(await svc.DeleteArticleAsync(me, id, ct)));
        api.MapGet("/guide/admin/articles/{id:guid}/readers", async (Guid id, ICurrentContext me, GuideService svc, CancellationToken ct) => Data(await svc.ReadersAsync(me, id, ct)));
        api.MapPut("/guide/admin/reminders", async (JsonObject body, ICurrentContext me, GuideService svc, CancellationToken ct) => Data(await svc.SaveRemindersAsync(me, body, ct)));
        return api;
    }
}