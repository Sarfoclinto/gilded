using System.Text.Json.Nodes;
using GoldValuation.Application.Abstractions;
using GoldValuation.Application.GroupSheets;
using GoldValuation.Application.Attachments;
using Xunit;

namespace GoldValuation.Infrastructure.Tests;

public class GroupSheetsServiceTests
{
    private sealed class Ctx : ICurrentContext
    {
        public Guid TenantId { get; } = Guid.NewGuid();
        public Guid UserId { get; } = Guid.NewGuid();
        public IReadOnlySet<Guid> BranchIds { get; } = new HashSet<Guid>();
        public bool Has(string permission) => true;   // permissions never open a group: the database decides
    }

    private sealed class Store : IGroupSheetsStore
    {
        public string? Action; public string? Payload; public string? Answer = "{}";
        public Task<string?> CallAsync(ICurrentContext me, string action, string payloadJson, CancellationToken ct) { Action = action; Payload = payloadJson; return Task.FromResult(Answer); }
    }

    private sealed class Blobs : IBlobStore
    {
        public readonly Dictionary<string, byte[]> Files = new();
        public Task WriteAsync(string key, ReadOnlyMemory<byte> bytes, CancellationToken ct) { Files[key] = bytes.ToArray(); return Task.CompletedTask; }
        public Stream? Open(string key) => Files.TryGetValue(key, out var b) ? new MemoryStream(b) : null;
        public void Delete(string key) => Files.Remove(key);
    }

    [Fact]
    public async Task The_storage_actions_are_never_reachable_from_a_request()
    {
        var store = new Store(); var svc = new GroupSheetsService(store, new Blobs());
        await Assert.ThrowsAsync<AppException>(() => svc.CallAsync(new Ctx(), "photo_add", new JsonObject { ["storageKey"] = "../../etc" }, default));
        await Assert.ThrowsAsync<AppException>(() => svc.CallAsync(new Ctx(), "photo_open", new JsonObject(), default));
        Assert.Null(store.Action);
    }

    [Fact]
    public async Task A_photo_is_checked_then_written_under_its_entry()
    {
        var store = new Store { Answer = "{\"replayed\":false,\"data\":{\"id\":\"p\"}}" }; var blobs = new Blobs(); var svc = new GroupSheetsService(store, blobs);
        var me = new Ctx(); var entry = Guid.NewGuid(); var id = Guid.NewGuid();
        byte[] jpeg = [0xFF, 0xD8, 0xFF, 0xE0, 1, 2, 3];
        await svc.AddPhotoAsync(me, entry, new Upload(new JsonObject { ["id"] = id.ToString() }, jpeg, null), default);
        Assert.Equal("photo_add", store.Action);
        var key = $"{me.TenantId:N}/g/{entry:N}/{id:N}.jpg";
        Assert.Equal(key, (string?)JsonNode.Parse(store.Payload!)!["storageKey"]);
        Assert.True(blobs.Files.ContainsKey(key));
        await Assert.ThrowsAsync<AppException>(() => svc.AddPhotoAsync(me, entry, new Upload(new JsonObject { ["id"] = id.ToString() }, [1, 2, 3, 4, 5], null), default));
    }

    [Fact]
    public async Task Passes_a_known_action_and_its_payload_to_the_database()
    {
        var store = new Store(); var svc = new GroupSheetsService(store, new Blobs());
        await svc.CallAsync(new Ctx(), "entry_add", JsonNode.Parse("""{"sheetId":"s","amount":"50","direction":"in"}""")!.AsObject(), default);
        Assert.Equal("entry_add", store.Action);
        Assert.Equal("50", (string?)JsonNode.Parse(store.Payload!)!["amount"]);
    }

    [Fact]
    public async Task Refuses_unknown_actions_and_huge_requests_before_the_database()
    {
        var store = new Store(); var svc = new GroupSheetsService(store, new Blobs());
        await Assert.ThrowsAsync<AppException>(() => svc.CallAsync(new Ctx(), "drop_everything", null, default));
        await Assert.ThrowsAsync<AppException>(() => svc.CallAsync(new Ctx(), "entry_add", new JsonObject { ["note"] = new string('x', 30_000) }, default));
        Assert.Null(store.Action);
    }

    [Fact]
    public async Task Nothing_back_from_the_database_is_not_found()
    {
        var store = new Store { Answer = null }; var svc = new GroupSheetsService(store, new Blobs());
        var ex = await Assert.ThrowsAsync<AppException>(() => svc.CallAsync(new Ctx(), "sheet_get", new JsonObject(), default));
        Assert.Equal(404, ex.Status);
    }
}