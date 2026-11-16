using System.Text.Json.Nodes;
using GoldValuation.Application.Abstractions;
using GoldValuation.Application.Attachments;
using GoldValuation.Application.Personal;

namespace GoldValuation.Api.Endpoints;

/// <summary>"My pictures": a person's private pictures. Every route works only on the signed-in person's own pictures; there is no permission that widens it.</summary>
public static class PersonalPicturesEndpoints
{
    private static IResult Data(string json, int status = 200) => new RawJsonResult(status, $"{{\"data\":{json}}}");

    public static RouteGroupBuilder MapPersonalPictures(this RouteGroupBuilder api)
    {
        api.MapPost("/me/pictures", async (HttpContext http, ICurrentContext me, PersonalPicturesService svc, CancellationToken ct) =>
        {
            if (!http.Request.HasFormContentType) throw AppException.Invalid("Send the picture as a form.");
            var form = await http.Request.ReadFormAsync(ct);
            var file = form.Files.GetFile("file") ?? throw AppException.Invalid("The picture is missing.");
            if (file.Length > AttachmentsService.MaxFileBytes) throw AppException.Invalid("The picture is too big.");
            JsonObject meta;
            try { meta = JsonNode.Parse(form["meta"].ToString()) as JsonObject ?? throw new FormatException(); }
            catch (Exception) { throw AppException.Invalid("The details of the picture are missing."); }
            var thumbFile = form.Files.GetFile("thumb");
            var r = await svc.AddAsync(me, new Upload(meta, await Read(file, ct), thumbFile is null ? null : await Read(thumbFile, ct)), ct);
            return Data(r.DataJson, r.Replayed ? 200 : 201);
        });

        api.MapGet("/me/pictures", async (HttpContext http, ICurrentContext me, PersonalPicturesService svc, CancellationToken ct) =>
            Data(await svc.ListAsync(me, http.Request.Query.ToDictionary(k => k.Key, k => (string?)k.Value.ToString()), ct)));

        api.MapPatch("/me/pictures/{id:guid}", async (Guid id, JsonObject body, ICurrentContext me, PersonalPicturesService svc, CancellationToken ct) =>
            Data(await svc.SetCaptionAsync(me, id, (string?)body["caption"], ct)));

        api.MapPost("/me/pictures/delete", async (JsonObject body, ICurrentContext me, PersonalPicturesService svc, CancellationToken ct) =>
            Data($"{{\"deleted\":{await svc.DeleteAsync(me, Ids(body), ct)}}}"));

        // Sharing: one colleague at a time; the colleague can look at and save a copy, never share on.
        api.MapGet("/me/pictures/colleagues", async (ICurrentContext me, PersonalPicturesService svc, CancellationToken ct) => Data(await svc.ColleaguesAsync(me, ct)));
        api.MapGet("/me/pictures/shared", async (HttpContext http, ICurrentContext me, PersonalPicturesService svc, CancellationToken ct) =>
            Data(await svc.SharedListAsync(me, http.Request.Query.ToDictionary(k => k.Key, k => (string?)k.Value.ToString()), ct)));
        api.MapPost("/me/pictures/share", async (JsonObject body, ICurrentContext me, PersonalPicturesService svc, CancellationToken ct) =>
            Data(await svc.ShareAsync(me, Ids(body), Guid.TryParse((string?)body["to"], out var to) ? to : throw AppException.Invalid("Choose a colleague to share with."), ct)));
        api.MapPost("/me/pictures/unshare", async (JsonObject body, ICurrentContext me, PersonalPicturesService svc, CancellationToken ct) =>
            Data(await svc.UnshareAsync(me, Ids(body), Guid.TryParse((string?)body["to"], out var to) ? to : null, ct)));
        api.MapPost("/me/pictures/shared/hide", async (JsonObject body, ICurrentContext me, PersonalPicturesService svc, CancellationToken ct) =>
            Data(await svc.HideSharedAsync(me, Ids(body), ct)));

        api.MapGet("/me/pictures/{id:guid}/file", async (Guid id, HttpContext http, ICurrentContext me, PersonalPicturesService svc, CancellationToken ct) =>
            Serve(http, await svc.OpenAsync(me, id, false, ct)));
        api.MapGet("/me/pictures/{id:guid}/thumb", async (Guid id, HttpContext http, ICurrentContext me, PersonalPicturesService svc, CancellationToken ct) =>
            Serve(http, await svc.OpenAsync(me, id, true, ct)));
        return api;
    }

    private static Guid[] Ids(JsonObject body) =>
        (body["ids"] as JsonArray)?.Select(n => Guid.TryParse((string?)n, out var g) ? g : Guid.Empty).Where(g => g != Guid.Empty).Distinct().ToArray()
        ?? throw AppException.Invalid("Choose the pictures.");

    private static async Task<byte[]> Read(IFormFile f, CancellationToken ct)
    {
        await using var s = f.OpenReadStream();
        using var ms = new MemoryStream((int)Math.Min(f.Length, int.MaxValue));
        await s.CopyToAsync(ms, ct);
        return ms.ToArray();
    }

    // Personal pictures are not kept by shared caches or proxies; the app holds what it is showing.
    private static IResult Serve(HttpContext http, Served? s)
    {
        if (s is null) return Results.NotFound();
        http.Response.Headers.CacheControl = "private, no-store";
        return Results.Stream(s.Content, s.ContentType);
    }
}