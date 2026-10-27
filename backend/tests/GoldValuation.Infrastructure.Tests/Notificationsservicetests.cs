using GoldValuation.Application.Abstractions;
using GoldValuation.Application.Notifications;
using Xunit;

namespace GoldValuation.Infrastructure.Tests;

public class NotificationsServiceTests
{
    private readonly FakeStore _store = new();
    private readonly NotificationsService _svc;

    public NotificationsServiceTests() => _svc = new NotificationsService(_store);

    [Fact]
    public async Task The_list_size_is_kept_within_bounds()
    {
        await _svc.ListAsync(new Ctx(), null, false, default);
        Assert.Equal(30, _store.LastLimit);
        await _svc.ListAsync(new Ctx(), 5000, true, default);
        Assert.Equal(100, _store.LastLimit);
        Assert.True(_store.LastUnread);
        await _svc.ListAsync(new Ctx(), 0, false, default);
        Assert.Equal(1, _store.LastLimit);
    }

    [Fact]
    public async Task Marking_read_takes_ids_or_all_and_refuses_a_huge_batch()
    {
        await _svc.MarkReadAsync(new Ctx(), null, default);
        Assert.Null(_store.LastIds);
        var ids = new[] { Guid.NewGuid() };
        await _svc.MarkReadAsync(new Ctx(), ids, default);
        Assert.Equal(ids, _store.LastIds);
        await Assert.ThrowsAsync<AppException>(() => _svc.MarkReadAsync(new Ctx(), Enumerable.Range(0, 201).Select(_ => Guid.NewGuid()).ToArray(), default));
    }

    private sealed class Ctx : ICurrentContext
    {
        public Guid TenantId => Guid.Parse("33333333-3333-4333-8333-333333333333");
        public Guid UserId => Guid.Parse("aaaaaaaa-0000-4000-8000-000000000001");
        public IReadOnlySet<Guid> BranchIds { get; } = new HashSet<Guid>();
        public bool Has(string permission) => false;
    }

    private sealed class FakeStore : INotificationsStore
    {
        public int LastLimit;
        public bool LastUnread;
        public Guid[]? LastIds;
        public Task<string> ListAsync(ICurrentContext me, int limit, bool unreadOnly, CancellationToken ct) { LastLimit = limit; LastUnread = unreadOnly; return Task.FromResult("{}"); }
        public Task<string> MarkReadAsync(ICurrentContext me, Guid[]? ids, CancellationToken ct) { LastIds = ids; return Task.FromResult("{}"); }
    }
}
