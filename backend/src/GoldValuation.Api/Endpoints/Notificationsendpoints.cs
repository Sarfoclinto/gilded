using System.Text.Json.Nodes;
using GoldValuation.Application.Abstractions;
using GoldValuation.Application.Notifications;

namespace GoldValuation.Api.Endpoints;

/// <summary>The signed-in person's notification inbox.</summary>
public static class NotificationsEndpoints
{
    private static IResult Data(string json) => new RawJsonResult(200, $"{{\"data\":{json}}}");

    public static RouteGroupBuilder MapNotifications(this RouteGroupBuilder api)
    {
        api.MapGet("/notifications", async (int? limit, bool? unreadOnly, ICurrentContext me, NotificationsService svc, CancellationToken ct) =>
            Data(await svc.ListAsync(me, limit, unreadOnly ?? false, ct)));
        // { ids: [...] } marks those read; { all: true } marks everything of mine read.
        api.MapPost("/notifications/read", async (JsonObject body, ICurrentContext me, NotificationsService svc, CancellationToken ct) =>
        {
            Guid[]? ids = null;
            if (body["ids"] is JsonArray a) ids = a.Select(x => Guid.TryParse((string?)x, out var g) ? g : Guid.Empty).Where(g => g != Guid.Empty).ToArray();
            else if (body["all"]?.GetValue<bool>() != true) throw GoldValuation.Application.Abstractions.AppException.Invalid("Send ids or all: true.");
            return Data(await svc.MarkReadAsync(me, ids, ct));
        });
        // A computer tells us the branch hub found an entry it saved was short (see migration 0052). Safe to resend.
        api.MapPost("/notifications/hub-short", async (JsonObject body, ICurrentContext me, NotificationsService svc, CancellationToken ct) =>
            Data(await svc.ReportHubShortAsync(me, body, ct)));
        return api;
    }
}