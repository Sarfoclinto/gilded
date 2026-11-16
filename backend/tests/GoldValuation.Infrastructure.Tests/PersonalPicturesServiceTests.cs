using System.Text.Json.Nodes;
using GoldValuation.Application.Abstractions;
using GoldValuation.Application.Attachments;
using GoldValuation.Application.Operations;
using GoldValuation.Application.Personal;
using Xunit;

namespace GoldValuation.Infrastructure.Tests;

public class PersonalPicturesServiceTests
{
    private static readonly byte[] Jpeg = [0xFF, 0xD8, 0xFF, 0xE0, 1, 2, 3, 4, 5];
    private readonly FakeStore _store = new();
    private readonly Blobs _blobs = new();
    private readonly PersonalPicturesService _svc;

    public PersonalPicturesServiceTests() => _svc = new PersonalPicturesService(_store, _blobs);

    private static JsonObject Meta() => JsonNode.Parse($$"""{"id":"{{Guid.NewGuid()}}","width":900,"height":1200,"storageKey":"../../etc/passwd"}""")!.AsObject();

    [Fact]
    public async Task A_picture_is_kept_under_the_owners_own_folder_and_the_callers_key_is_ignored()
    {
        await _svc.AddAsync(new Ctx(), new Upload(Meta(), Jpeg, Jpeg), default);
        Assert.Equal(2, _blobs.Written.Count);
        Assert.All(_blobs.Written, k => Assert.StartsWith("11111111111141118111111111111111/p/33333333333343338333333333333333/", k));
        Assert.DoesNotContain("passwd", _store.LastPayload);
    }

    [Fact]
    public async Task Only_jpeg_photos_that_are_not_empty_are_accepted()
    {
        await Assert.ThrowsAsync<AppException>(() => _svc.AddAsync(new Ctx(), new Upload(Meta(), [1, 2, 3, 4, 5], null), default));
        await Assert.ThrowsAsync<AppException>(() => _svc.AddAsync(new Ctx(), new Upload(Meta(), [], null), default));
        Assert.Empty(_blobs.Written);
    }

    [Fact]
    public async Task Nothing_is_written_when_the_database_refuses()
    {
        _store.Refuse = true;
        await Assert.ThrowsAsync<AppException>(() => _svc.AddAsync(new Ctx(), new Upload(Meta(), Jpeg, null), default));
        Assert.Empty(_blobs.Written);
    }

    [Fact]
    public async Task Deleting_removes_the_files_the_database_names()
    {
        _store.Deleted = """[{"storageKey":"a/p/b/c.jpg","thumbKey":"a/p/b/c.t.jpg"}]""";
        var n = await _svc.DeleteAsync(new Ctx(), [Guid.NewGuid()], default);
        Assert.Equal(1, n);
        Assert.Equal(["a/p/b/c.jpg", "a/p/b/c.t.jpg"], _blobs.Removed);
        await Assert.ThrowsAsync<AppException>(() => _svc.DeleteAsync(new Ctx(), [], default));
    }

    private sealed class Blobs : IBlobStore
    {
        public readonly List<string> Written = [], Removed = [];
        public Task WriteAsync(string key, ReadOnlyMemory<byte> bytes, CancellationToken ct) { Written.Add(key); return Task.CompletedTask; }
        public Stream? Open(string key) => null;
        public void Delete(string key) => Removed.Add(key);
    }

    private sealed class FakeStore : IPersonalPicturesStore
    {
        public string? LastPayload; public bool Refuse; public string Deleted = "[]";
        public Task<DbResult> AddAsync(ICurrentContext me, string payloadJson, CancellationToken ct)
        {
            if (Refuse) throw new AppException("PERSONAL_FULL", "Full.", 422);
            LastPayload = payloadJson;
            return Task.FromResult(new DbResult(false, "{}"));
        }
        public Task<string> ListAsync(ICurrentContext me, string filtersJson, CancellationToken ct) => Task.FromResult("{}");
        public Task<string> SetCaptionAsync(ICurrentContext me, Guid id, string? caption, CancellationToken ct) => Task.FromResult("{}");
        public Task<string> DeleteAsync(ICurrentContext me, Guid[] ids, CancellationToken ct) => Task.FromResult(Deleted);
        public Task<string?> OpenAsync(ICurrentContext me, Guid id, CancellationToken ct) => Task.FromResult<string?>(null);
        public Task<IReadOnlyList<Guid>> PurgeCompaniesAsync(CancellationToken ct) => Task.FromResult<IReadOnlyList<Guid>>([]);
        public Task<string> PurgeAsync(Guid tenantId, CancellationToken ct) => Task.FromResult("[]");
    }

    private sealed class Ctx : ICurrentContext
    {
        public Guid TenantId { get; } = Guid.Parse("11111111-1111-4111-8111-111111111111");
        public Guid UserId { get; } = Guid.Parse("33333333-3333-4333-8333-333333333333");
        public IReadOnlySet<Guid> BranchIds { get; } = new HashSet<Guid>();
        public bool Has(string permission) => false;
    }
}