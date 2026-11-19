using System.Text.Json.Nodes;
using GoldValuation.Application.GroupSheets;
using GoldValuation.Application.Abstractions;

namespace GoldValuation.Api.Endpoints;

/// <summary>Group Sheets: private running records for a chosen group (docs/group-sheets-design.md). Who may see what is decided in the database.</summary>
public static class GroupSheetsEndpoints
{
    private static IResult Data(string json) => new RawJsonResult(200, $"{{\"data\":{json}}}");

    // POST /group-sheets/groups/{id}/{verb}
    private static readonly Dictionary<string, string> GroupVerbs = new()
    {
        ["members"] = "member_set", ["members-remove"] = "member_remove", ["members-back"] = "member_unexclude", ["leave"] = "leave",
        ["rules"] = "rule_set", ["rules-remove"] = "rule_remove", ["name-keeper"] = "name_keeper", ["sheets"] = "sheet_create",
    };

    private static JsonObject With(JsonObject? body, string key, Guid id)
    {
        var o = body is null ? new JsonObject() : (JsonObject)body.DeepClone();
        o[key] = id.ToString();
        return o;
    }

    public static RouteGroupBuilder MapGroupSheets(this RouteGroupBuilder api)
    {
        api.MapGet("/group-sheets", async (ICurrentContext me, GroupSheetsService svc, CancellationToken ct) => Data(await svc.CallAsync(me, "home", null, ct)));
        api.MapPost("/group-sheets/groups", async (JsonObject body, ICurrentContext me, GroupSheetsService svc, CancellationToken ct) =>
            Data(await svc.CallAsync(me, "group_create", body, ct)));
        api.MapGet("/group-sheets/groups/{id:guid}", async (Guid id, ICurrentContext me, GroupSheetsService svc, CancellationToken ct) =>
            Data(await svc.CallAsync(me, "group_get", With(null, "groupId", id), ct)));
        api.MapPatch("/group-sheets/groups/{id:guid}", async (Guid id, JsonObject body, ICurrentContext me, GroupSheetsService svc, CancellationToken ct) =>
            Data(await svc.CallAsync(me, "group_rename", With(body, "groupId", id), ct)));
        api.MapGet("/group-sheets/groups/{id:guid}/activity", async (Guid id, string? before, ICurrentContext me, GroupSheetsService svc, CancellationToken ct) =>
        {
            var p = With(null, "groupId", id);
            if (!string.IsNullOrWhiteSpace(before)) p["before"] = before;
            return Data(await svc.CallAsync(me, "activity", p, ct));
        });
        api.MapPost("/group-sheets/groups/{id:guid}/{verb}", async (Guid id, string verb, JsonObject? body, ICurrentContext me, GroupSheetsService svc, CancellationToken ct) =>
            GroupVerbs.TryGetValue(verb, out var action) ? Data(await svc.CallAsync(me, action, With(body, "groupId", id), ct)) : Results.NotFound());

        api.MapGet("/group-sheets/sheets/{id:guid}", async (Guid id, string? from, string? to, ICurrentContext me, GroupSheetsService svc, CancellationToken ct) =>
        {
            var p = With(null, "sheetId", id);
            if (!string.IsNullOrWhiteSpace(from)) p["from"] = from;
            if (!string.IsNullOrWhiteSpace(to)) p["to"] = to;
            return Data(await svc.CallAsync(me, "sheet_get", p, ct));
        });
        api.MapPatch("/group-sheets/sheets/{id:guid}", async (Guid id, JsonObject body, ICurrentContext me, GroupSheetsService svc, CancellationToken ct) =>
            Data(await svc.CallAsync(me, "sheet_update", With(body, "sheetId", id), ct)));
        api.MapDelete("/group-sheets/sheets/{id:guid}", async (Guid id, ICurrentContext me, GroupSheetsService svc, CancellationToken ct) =>
            Data(await svc.CallAsync(me, "sheet_delete", With(null, "sheetId", id), ct)));
        api.MapPost("/group-sheets/sheets/{id:guid}/access", async (Guid id, JsonObject body, ICurrentContext me, GroupSheetsService svc, CancellationToken ct) =>
            Data(await svc.CallAsync(me, "access_set", With(body, "sheetId", id), ct)));
        api.MapPost("/group-sheets/sheets/{id:guid}/entries", async (Guid id, JsonObject body, ICurrentContext me, GroupSheetsService svc, CancellationToken ct) =>
            Data(await svc.CallAsync(me, "entry_add", With(body, "sheetId", id), ct)));
        api.MapPost("/group-sheets/entries/{id:guid}/take-back", async (Guid id, JsonObject? body, ICurrentContext me, GroupSheetsService svc, CancellationToken ct) =>
            Data(await svc.CallAsync(me, "entry_take_back", With(body, "entryId", id), ct)));
        return api;
    }
}