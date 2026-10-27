using System.Text.Json.Nodes;
using GoldValuation.Application.Abstractions;
using GoldValuation.Application.Auth;
using GoldValuation.Application.Operations;
using GoldValuation.Application.Review;
using Xunit;

namespace GoldValuation.Infrastructure.Tests;

public class ReviewServiceTests
{
    private static readonly Guid Tarkwa = Guid.Parse("22222222-2222-4222-8222-222222222222");
    private static readonly Guid Kumasi = Guid.Parse("44444444-4444-4444-8444-444444444444");
    private readonly FakeStore _store = new();
    private readonly ReviewService _svc;

    public ReviewServiceTests() => _svc = new ReviewService(_store);

    private static Ctx Reviewer() => new([Permissions.DiscrepanciesReview, Permissions.ReportsRead], [Tarkwa]);
    private static Ctx Teller() => new([Permissions.TransactionsRead], [Tarkwa]);
    private static JsonObject Body(string json) => JsonNode.Parse(json)!.AsObject();

    [Fact]
    public async Task The_inbox_needs_the_review_permission_and_defaults_to_active_cases()
    {
        await Assert.ThrowsAsync<AppException>(() => _svc.ListCasesAsync(Teller(), null, null, null, default));
        await _svc.ListCasesAsync(Reviewer(), null, null, null, default);
        Assert.Equal("active", _store.LastStatus);
        await Assert.ThrowsAsync<AppException>(() => _svc.ListCasesAsync(Reviewer(), "weird", null, null, default));
        await Assert.ThrowsAsync<AppException>(() => _svc.ListCasesAsync(Reviewer(), null, Kumasi, null, default));   // not their branch
    }

    [Fact]
    public async Task Only_known_actions_and_resolution_types_pass_and_only_known_fields_are_forwarded()
    {
        var id = Guid.NewGuid();
        await Assert.ThrowsAsync<AppException>(() => _svc.ActOnCaseAsync(Reviewer(), id, Body("""{"action":"delete"}"""), default));
        await Assert.ThrowsAsync<AppException>(() => _svc.ActOnCaseAsync(Reviewer(), id, Body("""{"action":"resolve","resolutionType":"magic","summary":"long enough text"}"""), default));
        await Assert.ThrowsAsync<AppException>(() => _svc.ActOnCaseAsync(Teller(), id, Body("""{"action":"take"}"""), default));

        await _svc.ActOnCaseAsync(Reviewer(), id, Body("""{"action":"resolve","resolutionType":"found","summary":"Found in the safe","status":"resolved","assignedTo":"x"}"""), default);
        var sent = JsonNode.Parse(_store.LastPayload!)!.AsObject();
        Assert.Equal("found", (string?)sent["resolutionType"]);
        Assert.Null(sent["status"]);
        Assert.Null(sent["assignedTo"]);
    }

    [Fact]
    public async Task The_timeline_needs_reports_and_a_branch_the_caller_works_in_and_checks_its_filters()
    {
        await Assert.ThrowsAsync<AppException>(() => _svc.TimelineAsync(Teller(), Tarkwa, null, null, null, null, null, default));
        await Assert.ThrowsAsync<AppException>(() => _svc.TimelineAsync(Reviewer(), Kumasi, null, null, null, null, null, default));
        await Assert.ThrowsAsync<AppException>(() => _svc.TimelineAsync(Reviewer(), Tarkwa, null, null, "diamonds", null, null, default));
        var now = DateTimeOffset.UtcNow;
        await Assert.ThrowsAsync<AppException>(() => _svc.TimelineAsync(Reviewer(), Tarkwa, now, now.AddDays(-1), null, null, null, default));
        await _svc.TimelineAsync(Reviewer(), Tarkwa, null, null, "cash", 50, 9999, default);
        Assert.Equal(300, _store.LastLimit);
    }

    [Fact]
    public async Task The_export_needs_reports_a_branch_the_caller_works_in_and_a_sensible_range()
    {
        await Assert.ThrowsAsync<AppException>(() => _svc.ExportTransactionsAsync(Teller(), Tarkwa, null, null, default));
        await Assert.ThrowsAsync<AppException>(() => _svc.ExportTransactionsAsync(Reviewer(), Kumasi, null, null, default));
        var now = DateTimeOffset.UtcNow;
        await Assert.ThrowsAsync<AppException>(() => _svc.ExportTransactionsAsync(Reviewer(), Tarkwa, now, now.AddDays(-1), default));
        Assert.Equal("{}", await _svc.ExportTransactionsAsync(Reviewer(), Tarkwa, now.AddDays(-1), now, default));
    }

    [Fact]
    public async Task The_position_needs_reports()
    {
        await Assert.ThrowsAsync<AppException>(() => _svc.PositionAsync(Teller(), default));
        Assert.Equal("[]", await _svc.PositionAsync(Reviewer(), default));
    }

    private sealed class Ctx(IEnumerable<string> permissions, IEnumerable<Guid> branches) : ICurrentContext
    {
        private readonly HashSet<string> _permissions = permissions.ToHashSet();
        public Guid TenantId => Guid.Parse("33333333-3333-4333-8333-333333333333");
        public Guid UserId => Guid.Parse("aaaaaaaa-0000-4000-8000-000000000001");
        public IReadOnlySet<Guid> BranchIds { get; } = branches.ToHashSet();
        public bool Has(string permission) => _permissions.Contains(permission);
    }

    private sealed class FakeStore : IReviewStore
    {
        public string? LastStatus, LastPayload;
        public int LastLimit;
        public Task<string> ListCasesAsync(ICurrentContext me, string? status, Guid? branchId, int limit, CancellationToken ct) { LastStatus = status; return Task.FromResult("[]"); }
        public Task<string> GetCaseAsync(ICurrentContext me, Guid id, CancellationToken ct) => Task.FromResult("{}");
        public Task<string> ActOnCaseAsync(ICurrentContext me, Guid id, string payloadJson, CancellationToken ct) { LastPayload = payloadJson; return Task.FromResult("{}"); }
        public Task<string> TimelineAsync(ICurrentContext me, Guid branchId, DateTimeOffset? from, DateTimeOffset? to, string? asset, long? before, int limit, CancellationToken ct) { LastLimit = limit; return Task.FromResult("{}"); }
        public Task<string> PositionAsync(ICurrentContext me, CancellationToken ct) => Task.FromResult("[]");
        public Task<string> ExportTransactionsAsync(ICurrentContext me, Guid branchId, DateTimeOffset? from, DateTimeOffset? to, CancellationToken ct) => Task.FromResult("{}");
    }
}
