using System.Text.Json.Nodes;
using GoldValuation.Application.Abstractions;
using GoldValuation.Application.Workings;
using Xunit;

namespace GoldValuation.Infrastructure.Tests;

public class WorkingsServiceTests
{
    private readonly FakeStore _store = new();
    private readonly WorkingsService _svc;
    public WorkingsServiceTests() => _svc = new WorkingsService(_store);

    [Fact]
    public async Task Saving_passes_only_the_fields_the_database_reads_and_the_id_from_the_route()
    {
        var id = Guid.NewGuid();
        var body = JsonNode.Parse("""{"id":"not-this-one","name":"  Kwame ","doc":{"notes":[{"id":"a","x":1,"y":2,"text":"Weight 12 g"}],"view":{"x":0,"y":0,"zoom":1}},"baseVersion":3,"owner":"someone"}""")!.AsObject();
        await _svc.SaveAsync(new Ctx(), id, body, default);
        var sent = JsonNode.Parse(_store.LastPayload!)!.AsObject();
        Assert.Equal(id.ToString(), (string?)sent["id"]);
        Assert.Equal("Kwame", (string?)sent["name"]);
        Assert.Equal(3, (int?)sent["baseVersion"]);
        Assert.Null(sent["owner"]);
        Assert.Equal(1, sent["doc"]!["notes"]!.AsArray().Count);
    }

    [Fact]
    public async Task A_sheet_without_notes_is_refused_before_the_database()
    {
        await Assert.ThrowsAsync<AppException>(() => _svc.SaveAsync(new Ctx(), Guid.NewGuid(), JsonNode.Parse("""{"name":"x","doc":{}}""")!.AsObject(), default));
        await Assert.ThrowsAsync<AppException>(() => _svc.SaveAsync(new Ctx(), Guid.NewGuid(), JsonNode.Parse("""{"name":"x"}""")!.AsObject(), default));
        Assert.Null(_store.LastPayload);
    }

    [Fact]
    public async Task Deleting_needs_a_sensible_number_of_sheets()
    {
        await Assert.ThrowsAsync<AppException>(() => _svc.DeleteAsync(new Ctx(), [], default));
        Assert.Equal("{}", await _svc.DeleteAsync(new Ctx(), [Guid.NewGuid()], default));
    }

    [Fact]
    public async Task Sharing_passes_the_sheet_and_the_colleague()
    {
        Guid id = Guid.NewGuid(), to = Guid.NewGuid();
        await _svc.ShareAsync(new Ctx(), id, to, default);
        Assert.Equal($"{id}:{to}", _store.LastPayload);
    }

    private sealed class FakeStore : IWorkingsStore
    {
        public string? LastPayload;
        public Task<string> ListAsync(ICurrentContext me, string filtersJson, CancellationToken ct) => Task.FromResult("{}");
        public Task<string?> GetAsync(ICurrentContext me, Guid id, CancellationToken ct) => Task.FromResult<string?>(null);
        public Task<string> SaveAsync(ICurrentContext me, string payloadJson, CancellationToken ct) { LastPayload = payloadJson; return Task.FromResult("{}"); }
        public Task<string> RenameAsync(ICurrentContext me, Guid id, string? name, CancellationToken ct) => Task.FromResult("{}");
        public Task<string> DeleteAsync(ICurrentContext me, Guid[] ids, CancellationToken ct) => Task.FromResult("{}");
        public Task<string> SharedListAsync(ICurrentContext me, CancellationToken ct) => Task.FromResult("{}");
        public Task<string> ShareAsync(ICurrentContext me, Guid id, Guid to, CancellationToken ct) { LastPayload = $"{id}:{to}"; return Task.FromResult("{}"); }
        public Task<string> UnshareAsync(ICurrentContext me, Guid id, Guid? to, CancellationToken ct) => Task.FromResult("{}");
        public Task<string> HideSharedAsync(ICurrentContext me, Guid id, CancellationToken ct) => Task.FromResult("{}");
    }

    private sealed class Ctx : ICurrentContext
    {
        public Guid TenantId { get; } = Guid.Parse("11111111-1111-4111-8111-111111111111");
        public Guid UserId { get; } = Guid.Parse("33333333-3333-4333-8333-333333333333");
        public IReadOnlySet<Guid> BranchIds { get; } = new HashSet<Guid>();
        public bool Has(string permission) => false;
    }
}