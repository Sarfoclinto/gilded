using System.Text.Json.Nodes;
using GoldValuation.Application.Abstractions;
using GoldValuation.Application.Attachments;
using GoldValuation.Application.Auth;
using GoldValuation.Application.Operations;
using GoldValuation.Infrastructure.Attachments;
using Xunit;

namespace GoldValuation.Infrastructure.Tests;

public class AttachmentsServiceTests
{
    private static readonly Guid Tarkwa = Guid.Parse("22222222-2222-4222-8222-222222222222");
    private static readonly byte[] Jpeg = [0xFF, 0xD8, 0xFF, 0xE0, 1, 2, 3, 4, 5];
    private readonly FakeStore _store = new();
    private readonly MemoryBlobs _blobs = new();
    private readonly AttachmentsService _svc;

    public AttachmentsServiceTests() => _svc = new AttachmentsService(_store, _blobs, new FixedClock());

    private static Ctx Sender() => new([Permissions.TransfersRead, Permissions.TransfersCreate], [Tarkwa]);
    private static Ctx Viewer() => new([Permissions.TransfersRead], [Tarkwa]);
    private static JsonObject Meta(string type = "transfer", string slot = "release") =>
        JsonNode.Parse($$"""{"id":"{{Guid.NewGuid()}}","entityType":"{{type}}","entityId":"{{Guid.NewGuid()}}","slot":"{{slot}}","width":1200,"height":1600,"source":"camera","storageKey":"../../etc/passwd"}""")!.AsObject();

    [Fact]
    public async Task A_transfer_photo_needs_a_sending_or_receiving_permission()
    {
        await Assert.ThrowsAsync<AppException>(() => _svc.UploadAsync(Viewer(), new Upload(Meta(), Jpeg, null), default));
        await _svc.UploadAsync(Sender(), new Upload(Meta(), Jpeg, Jpeg), default);
        Assert.Equal(2, _blobs.Written.Count);
    }

    [Fact]
    public async Task Only_real_photos_of_a_sensible_size_are_kept()
    {
        await Assert.ThrowsAsync<AppException>(() => _svc.UploadAsync(Sender(), new Upload(Meta(), [1, 2, 3, 4, 5, 6], null), default));
        await Assert.ThrowsAsync<AppException>(() => _svc.UploadAsync(Sender(), new Upload(Meta(), [], null), default));
        await Assert.ThrowsAsync<AppException>(() => _svc.UploadAsync(Sender(), new Upload(Meta(slot: "bogus"), Jpeg, null), default));
        await Assert.ThrowsAsync<AppException>(() => _svc.UploadAsync(Sender(), new Upload(Meta(type: "customer"), Jpeg, null), default));
        Assert.Empty(_blobs.Written);
        Assert.Null(_store.LastPayload);
    }

    [Fact]
    public async Task The_storage_place_is_ours_not_the_callers()
    {
        await _svc.UploadAsync(Sender(), new Upload(Meta(), Jpeg, null), default);
        Assert.DoesNotContain("passwd", _store.LastPayload);
        Assert.All(_blobs.Written, k => Assert.Matches(@"^[0-9a-f]{32}/\d{4}/[0-9a-f]{32}(\.t)?\.jpg$", k));
    }

    [Fact]
    public async Task The_database_decides_before_any_bytes_are_written()
    {
        _store.Refuse = true;
        await Assert.ThrowsAsync<AppException>(() => _svc.UploadAsync(Sender(), new Upload(Meta(), Jpeg, null), default));
        Assert.Empty(_blobs.Written);
    }

    [Fact]
    public async Task The_file_store_refuses_keys_that_leave_its_folder()
    {
        var dir = Path.Combine(Path.GetTempPath(), "gilded-photos-" + Guid.NewGuid().ToString("N"));
        try
        {
            var store = new FileBlobStore(dir);
            var key = $"{Guid.NewGuid():N}/2026/{Guid.NewGuid():N}.jpg";
            await store.WriteAsync(key, Jpeg, default);
            await using (var s = store.Open(key)!) Assert.Equal(Jpeg.Length, s.Length);
            Assert.Null(store.Open($"{Guid.NewGuid():N}/2026/{Guid.NewGuid():N}.jpg"));
            Assert.Throws<ArgumentException>(() => store.Open("../../etc/passwd"));
            await Assert.ThrowsAsync<ArgumentException>(() => store.WriteAsync("../x.jpg", Jpeg, default));
        }
        finally { if (Directory.Exists(dir)) Directory.Delete(dir, true); }
    }

    [Fact]
    public async Task Removing_passes_whether_the_caller_may_remove_any()
    {
        await _svc.RemoveAsync(Sender(), Guid.NewGuid(), "wrong gold", default);
        Assert.False(_store.CanAny);
        await _svc.RemoveAsync(new Ctx([Permissions.AttachmentsRemove], [Tarkwa]), Guid.NewGuid(), null, default);
        Assert.True(_store.CanAny);
    }

    private sealed class FixedClock : IClock { public DateTimeOffset UtcNow => new(2026, 11, 14, 9, 0, 0, TimeSpan.Zero); }

    private sealed class MemoryBlobs : IBlobStore
    {
        public readonly List<string> Written = [];
        public Task WriteAsync(string key, ReadOnlyMemory<byte> bytes, CancellationToken ct) { Written.Add(key); return Task.CompletedTask; }
        public Stream? Open(string key) => null;
    }

    private sealed class FakeStore : IAttachmentsStore
    {
        public string? LastPayload; public bool Refuse, CanAny;
        public Task<DbResult> AddAsync(ICurrentContext me, string payloadJson, CancellationToken ct)
        {
            if (Refuse) throw AppException.NotFound("That transfer");
            LastPayload = payloadJson;
            return Task.FromResult(new DbResult(false, "{}"));
        }
        public Task<string> ListAsync(ICurrentContext me, string entityType, Guid entityId, CancellationToken ct) => Task.FromResult("[]");
        public Task<string?> FileAsync(ICurrentContext me, Guid id, CancellationToken ct) => Task.FromResult<string?>(null);
        public Task<Guid?> ProfilePictureAsync(ICurrentContext me, Guid userId, CancellationToken ct) => Task.FromResult<Guid?>(null);
        public Task<string> RemoveAsync(ICurrentContext me, Guid id, string? reason, bool canRemoveAny, CancellationToken ct) { CanAny = canRemoveAny; return Task.FromResult("{}"); }
    }

    private sealed class Ctx(IEnumerable<string> permissions, IEnumerable<Guid> branches) : ICurrentContext
    {
        private readonly HashSet<string> _p = [.. permissions];
        public Guid TenantId { get; } = Guid.Parse("11111111-1111-4111-8111-111111111111");
        public Guid UserId { get; } = Guid.Parse("33333333-3333-4333-8333-333333333333");
        public IReadOnlySet<Guid> BranchIds { get; } = branches.ToHashSet();
        public bool Has(string permission) => _p.Contains(permission);
    }
}