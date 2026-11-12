using GoldValuation.Application.Abstractions;
using System.Text.Json.Nodes;
using GoldValuation.Application.Auth;
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

    private static readonly Guid Tarkwa = Guid.Parse("bbbbbbbb-0000-4000-8000-000000000001");

    [Fact]
    public async Task A_hub_short_report_needs_a_save_permission_and_a_branch_the_caller_works_in()
    {
        JsonObject Body(Guid b) => new() { ["branchId"] = b.ToString(), ["commandId"] = "c1", ["short"] = new JsonObject { ["100"] = 7 } };
        await Assert.ThrowsAsync<AppException>(() => _svc.ReportHubShortAsync(new Reporter([]), Body(Tarkwa), default));
        await Assert.ThrowsAsync<AppException>(() => _svc.ReportHubShortAsync(new Reporter([Permissions.TransactionsCreate]), Body(Guid.NewGuid()), default));
        await Assert.ThrowsAsync<AppException>(() => _svc.ReportHubShortAsync(new Reporter([Permissions.TransactionsCreate]), new JsonObject(), default));
        await _svc.ReportHubShortAsync(new Reporter([Permissions.DaysManage]), Body(Tarkwa), default);
        Assert.Contains("\"commandId\":\"c1\"", _store.LastReport);
    }

    private sealed class Reporter(IEnumerable<string> permissions) : ICurrentContext
    {
        private readonly HashSet<string> _permissions = permissions.ToHashSet();
        public Guid TenantId => Guid.Parse("33333333-3333-4333-8333-333333333333");
        public Guid UserId => Guid.Parse("aaaaaaaa-0000-4000-8000-000000000001");
        public IReadOnlySet<Guid> BranchIds { get; } = new HashSet<Guid> { Tarkwa };
        public bool Has(string permission) => _permissions.Contains(permission);
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
        public string? LastReport;
        public Task<string> ReportHubShortAsync(ICurrentContext me, string json, CancellationToken ct) { LastReport = json; return Task.FromResult("{}"); }
        public Task<string> ListAsync(ICurrentContext me, int limit, bool unreadOnly, CancellationToken ct) { LastLimit = limit; LastUnread = unreadOnly; return Task.FromResult("{}"); }
        public Task<string> MarkReadAsync(ICurrentContext me, Guid[]? ids, CancellationToken ct) { LastIds = ids; return Task.FromResult("{}"); }
    }
}