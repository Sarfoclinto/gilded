using System.Text.Json.Nodes;
using GoldValuation.Application.Abstractions;
using GoldValuation.Application.Attachments;

namespace GoldValuation.Api.Endpoints;

/// <summary>Photos: sent from the phone as one multipart request (the picture, its small preview and a few facts), listed, shown and taken off the screen.</summary>
public static class AttachmentsEndpoints
{
    private static IResult Data(string json, int status = 200) => new RawJsonResult(status, $"{{\"data\":{json}}}");

    public static RouteGroupBuilder MapAttachments(this RouteGroupBuilder api)
    {
        api.MapPost("/attachments", async (HttpContext http, ICurrentContext me, AttachmentsService svc, CancellationToken ct) =>
        {
            if (!http.Request.HasFormContentType) throw AppException.Invalid("Send the picture as a form.");
            var form = await http.Request.ReadFormAsync(ct);
            var file = form.Files.GetFile("file") ?? throw AppException.Invalid("The picture is missing.");
            if (file.Length > AttachmentsService.MaxFileBytes) throw AppException.Invalid("The picture is too big.");
            JsonObject meta;
            try { meta = JsonNode.Parse(form["meta"].ToString()) as JsonObject ?? throw new FormatException(); }
            catch (Exception) { throw AppException.Invalid("The details of the picture are missing."); }
            var thumbFile = form.Files.GetFile("thumb");
            var r = await svc.UploadAsync(me, new Upload(meta, await Read(file, ct), thumbFile is null ? null : await Read(thumbFile, ct)), ct);
            return Data(r.DataJson, r.Replayed ? 200 : 201);
        });

        api.MapGet("/attachments", async (string entityType, Guid entityId, ICurrentContext me, AttachmentsService svc, CancellationToken ct) =>
            Data(await svc.ListAsync(me, entityType, entityId, ct)));

        // The pictures themselves. The app asks with its sign-in and shows the result; the browser keeps them (they never change).
        api.MapGet("/attachments/{id:guid}/file", async (Guid id, HttpContext http, ICurrentContext me, AttachmentsService svc, CancellationToken ct) =>
            Serve(http, await svc.OpenAsync(me, id, false, ct), cache: true));
        api.MapGet("/attachments/{id:guid}/thumb", async (Guid id, HttpContext http, ICurrentContext me, AttachmentsService svc, CancellationToken ct) =>
            Serve(http, await svc.OpenAsync(me, id, true, ct), cache: true));
        // A person's current profile picture (a profile picture can change, so this one is only kept for a few minutes).
        api.MapGet("/attachments/profile/{userId:guid}", async (Guid userId, bool? thumb, HttpContext http, ICurrentContext me, AttachmentsService svc, CancellationToken ct) =>
            Serve(http, await svc.OpenProfileAsync(me, userId, thumb ?? true, ct), cache: false));

        api.MapPost("/attachments/{id:guid}/remove", async (Guid id, JsonObject body, ICurrentContext me, AttachmentsService svc, CancellationToken ct) =>
            Data(await svc.RemoveAsync(me, id, (string?)body["reason"], ct)));
        return api;
    }

    private static async Task<byte[]> Read(IFormFile f, CancellationToken ct)
    {
        await using var s = f.OpenReadStream();
        using var ms = new MemoryStream((int)Math.Min(f.Length, int.MaxValue));
        await s.CopyToAsync(ms, ct);
        return ms.ToArray();
    }

    private static IResult Serve(HttpContext http, Served? s, bool cache)
    {
        if (s is null) return Results.NotFound();
        var etag = $"\"{s.Etag}\"";
        http.Response.Headers.ETag = etag;
        http.Response.Headers.CacheControl = cache ? "private, max-age=31536000, immutable" : "private, max-age=300";
        if (http.Request.Headers.IfNoneMatch == etag) { s.Content.Dispose(); return Results.StatusCode(StatusCodes.Status304NotModified); }
        return Results.Stream(s.Content, s.ContentType);
    }
}