using System.Text.Json.Nodes;
using GoldValuation.Application.GroupSheets;
using GoldValuation.Application.Abstractions;
using GoldValuation.Application.Attachments;

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

        api.MapGet("/group-sheets/sheets/{id:guid}", async (Guid id, string? from, string? to, string? personId, ICurrentContext me, GroupSheetsService svc, CancellationToken ct) =>
        {
            var p = With(null, "sheetId", id);
            if (!string.IsNullOrWhiteSpace(from)) p["from"] = from;
            if (!string.IsNullOrWhiteSpace(to)) p["to"] = to;
            if (Guid.TryParse(personId, out var person)) p["personId"] = person.ToString();
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
        // phase 2 (B75): people on a savings sheet, alerts, receipt photos
        api.MapPost("/group-sheets/sheets/{id:guid}/people", async (Guid id, JsonObject body, ICurrentContext me, GroupSheetsService svc, CancellationToken ct) =>
            Data(await svc.CallAsync(me, "person_add", With(body, "sheetId", id), ct)));
        api.MapPatch("/group-sheets/people/{id:guid}", async (Guid id, JsonObject body, ICurrentContext me, GroupSheetsService svc, CancellationToken ct) =>
            Data(await svc.CallAsync(me, "person_rename", With(body, "personId", id), ct)));
        api.MapPost("/group-sheets/sheets/{id:guid}/alert", async (Guid id, JsonObject body, ICurrentContext me, GroupSheetsService svc, CancellationToken ct) =>
            Data(await svc.CallAsync(me, "alert_set", With(body, "sheetId", id), ct)));
        api.MapPost("/group-sheets/entries/{id:guid}/photos", async (Guid id, HttpContext http, ICurrentContext me, GroupSheetsService svc, CancellationToken ct) =>
        {
            if (!http.Request.HasFormContentType) throw AppException.Invalid("Send the photo as a form.");
            var form = await http.Request.ReadFormAsync(ct);
            var file = form.Files.GetFile("file") ?? throw AppException.Invalid("The photo is missing.");
            if (file.Length > AttachmentsService.MaxFileBytes) throw AppException.Invalid("The photo is too big.");
            JsonObject meta;
            try { meta = JsonNode.Parse(form["meta"].ToString()) as JsonObject ?? throw new FormatException(); }
            catch (Exception) { throw AppException.Invalid("The details of the photo are missing."); }
            var thumbFile = form.Files.GetFile("thumb");
            var r = await svc.AddPhotoAsync(me, id, new Upload(meta, await Read(file, ct), thumbFile is null ? null : await Read(thumbFile, ct)), ct);
            return new RawJsonResult(r.Replayed ? 200 : 201, $"{{\"data\":{r.DataJson}}}");
        });
        api.MapGet("/group-sheets/photos/{id:guid}/file", async (Guid id, HttpContext http, ICurrentContext me, GroupSheetsService svc, CancellationToken ct) =>
            Serve(http, await svc.OpenPhotoAsync(me, id, false, ct)));
        api.MapGet("/group-sheets/photos/{id:guid}/thumb", async (Guid id, HttpContext http, ICurrentContext me, GroupSheetsService svc, CancellationToken ct) =>
            Serve(http, await svc.OpenPhotoAsync(me, id, true, ct)));
        api.MapPost("/group-sheets/photos/{id:guid}/remove", async (Guid id, ICurrentContext me, GroupSheetsService svc, CancellationToken ct) =>
            Data(await svc.CallAsync(me, "photo_remove", With(null, "photoId", id), ct)));
        return api;
    }

    private static async Task<byte[]> Read(IFormFile f, CancellationToken ct)
    {
        await using var s = f.OpenReadStream();
        using var ms = new MemoryStream((int)Math.Min(f.Length, int.MaxValue));
        await s.CopyToAsync(ms, ct);
        return ms.ToArray();
    }

    // Group photos are not kept by shared caches or proxies.
    private static IResult Serve(HttpContext http, Served? s)
    {
        if (s is null) return Results.NotFound();
        http.Response.Headers.CacheControl = "private, no-store";
        return Results.Stream(s.Content, s.ContentType);
    }
}