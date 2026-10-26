using System.Text.Json.Nodes;
using GoldValuation.Application.Abstractions;
using GoldValuation.Application.Auth;
using GoldValuation.Application.Operations;
using GoldValuation.Application.Transfers;
using Xunit;

namespace GoldValuation.Infrastructure.Tests;

public class TransfersServiceTests
{
    private static readonly Guid Tarkwa = Guid.Parse("22222222-2222-4222-8222-222222222222");
    private static readonly Guid Kumasi = Guid.Parse("44444444-4444-4444-8444-444444444444");
    private readonly FakeStore _store = new();
    private readonly TransfersService _svc;

    public TransfersServiceTests() => _svc = new TransfersService(_store);

    private static Ctx Sender() => new([Permissions.TransfersRead, Permissions.TransfersCreate], [Tarkwa]);
    private static Ctx Receiver() => new([Permissions.TransfersRead, Permissions.TransfersReceive], [Kumasi]);
    private static Ctx Viewer() => new([Permissions.TransfersRead], [Tarkwa]);

    private static JsonObject Body(string json) => JsonNode.Parse(json)!.AsObject();

    [Fact]
    public async Task Creating_needs_the_sending_permission_and_a_sending_branch_the_caller_works_in()
    {
        var id = Guid.NewGuid();
        var json = $$"""{"id":"{{id}}","originBranchId":"{{Tarkwa}}","destinationBranchId":"{{Kumasi}}","kind":"goods"}""";
        await Assert.ThrowsAsync<AppException>(() => _svc.CreateAsync(Receiver(), Body(json), null, default));
        await _svc.CreateAsync(Sender(), Body(json), id.ToString(), default);

        var other = $$"""{"id":"{{Guid.NewGuid()}}","originBranchId":"{{Kumasi}}","destinationBranchId":"{{Tarkwa}}"}""";
        await Assert.ThrowsAsync<AppException>(() => _svc.CreateAsync(Sender(), Body(other), null, default));
    }

    [Fact]
    public async Task The_idempotency_key_must_equal_the_transfers_id()
    {
        var json = $$"""{"id":"{{Guid.NewGuid()}}","originBranchId":"{{Tarkwa}}","destinationBranchId":"{{Kumasi}}"}""";
        await Assert.ThrowsAsync<AppException>(() => _svc.CreateAsync(Sender(), Body(json), Guid.NewGuid().ToString(), default));
        await Assert.ThrowsAsync<AppException>(() => _svc.CreateAsync(Sender(), Body("""{"originBranchId":"x"}"""), null, default));
    }

    [Fact]
    public async Task Only_known_fields_reach_the_database()
    {
        var json = $$"""{"id":"{{Guid.NewGuid()}}","originBranchId":"{{Tarkwa}}","destinationBranchId":"{{Kumasi}}","status":"received","createdBy":"someone"}""";
        await _svc.CreateAsync(Sender(), Body(json), null, default);
        Assert.DoesNotContain("status", _store.LastPayload);
        Assert.DoesNotContain("createdBy", _store.LastPayload);
        Assert.Contains("originBranchId", _store.LastPayload);
    }

    [Fact]
    public async Task Sending_and_receiving_are_separate_permissions()
    {
        var id = Guid.NewGuid();
        await Assert.ThrowsAsync<AppException>(() => _svc.ReleaseAsync(Receiver(), id, Body("{}"), default));
        await Assert.ThrowsAsync<AppException>(() => _svc.ReceiveAsync(Sender(), id, Body("{}"), default));
        await _svc.ReleaseAsync(Sender(), id, Body("""{"note":"sealed"}"""), default);
        await _svc.ReceiveAsync(Receiver(), id, Body("""{"lines":[]}"""), default);
        await Assert.ThrowsAsync<AppException>(() => _svc.EditAsync(Viewer(), id, Body("{}"), default));
    }

    [Fact]
    public async Task Either_end_can_record_a_payment_but_a_viewer_cannot()
    {
        var id = Guid.NewGuid();
        var pay = $$$"""{"branchId":"{{{Tarkwa}}}","direction":"paid_to_collector","amount":50,"method":"cash","purpose":"Transport","lines":{"50":1}}""";
        await _svc.RecordPaymentAsync(Sender(), id, Body(pay), default);
        await _svc.RecordPaymentAsync(Receiver(), id, Body(pay), default);
        await Assert.ThrowsAsync<AppException>(() => _svc.RecordPaymentAsync(Viewer(), id, Body(pay), default));
        await Assert.ThrowsAsync<AppException>(() => _svc.RecordPaymentAsync(Sender(), id, Body($$"""{"branchId":"{{Tarkwa}}"}"""), default));
    }

    [Fact]
    public async Task A_cancel_needs_a_reason()
    {
        var id = Guid.NewGuid();
        await Assert.ThrowsAsync<AppException>(() => _svc.CancelAsync(Sender(), id, "no", default));
        await _svc.CancelAsync(Sender(), id, "Plans changed", default);
        Assert.Equal("Plans changed", _store.LastReason);
    }

    [Fact]
    public async Task A_transfer_is_visible_only_to_people_at_one_of_its_ends()
    {
        var id = Guid.NewGuid();
        _store.Transfer = $$"""{"id":"{{id}}","originBranchId":"{{Tarkwa}}","destinationBranchId":"{{Kumasi}}"}""";
        await _svc.GetAsync(Sender(), id, default);
        await _svc.GetAsync(Receiver(), id, default);
        var stranger = new Ctx([Permissions.TransfersRead], [Guid.NewGuid()]);
        var ex = await Assert.ThrowsAsync<AppException>(() => _svc.GetAsync(stranger, id, default));
        Assert.Equal(404, ex.Status);
    }

    [Fact]
    public async Task Lists_check_the_branch_and_the_direction()
    {
        await _svc.ListAsync(Sender(), Tarkwa, null, "outgoing", default);
        await Assert.ThrowsAsync<AppException>(() => _svc.ListAsync(Sender(), Kumasi, null, null, default));
        await Assert.ThrowsAsync<AppException>(() => _svc.ListAsync(Sender(), Tarkwa, null, "sideways", default));
        await Assert.ThrowsAsync<AppException>(() => _svc.ListAsync(Sender(), Tarkwa, "lost", null, default));
        await Assert.ThrowsAsync<AppException>(() => _svc.TransferableItemsAsync(Viewer(), Tarkwa, default));
        await Assert.ThrowsAsync<AppException>(() => _svc.StaffAsync(Viewer(), default));
        await _svc.StaffAsync(Sender(), default);
    }

    private sealed class Ctx(IEnumerable<string> permissions, IEnumerable<Guid> branches) : ICurrentContext
    {
        private readonly HashSet<string> _permissions = permissions.ToHashSet();
        public Guid TenantId => Guid.Parse("33333333-3333-4333-8333-333333333333");
        public Guid UserId => Guid.Parse("aaaaaaaa-0000-4000-8000-000000000001");
        public IReadOnlySet<Guid> BranchIds { get; } = branches.ToHashSet();
        public bool Has(string permission) => _permissions.Contains(permission);
    }

    private sealed class FakeStore : ITransfersStore
    {
        public string? LastPayload, LastReason, Transfer;
        public Task<string> ListAsync(ICurrentContext me, Guid branchId, string? status, string direction, CancellationToken ct) => Task.FromResult("[]");
        public Task<string> TransferableItemsAsync(ICurrentContext me, Guid branchId, CancellationToken ct) => Task.FromResult("[]");
        public Task<string> StaffAsync(ICurrentContext me, CancellationToken ct) => Task.FromResult("[]");
        public Task<string?> GetAsync(ICurrentContext me, Guid id, CancellationToken ct) => Task.FromResult(Transfer);
        public Task<DbResult> CreateAsync(ICurrentContext me, string payloadJson, CancellationToken ct) { LastPayload = payloadJson; return Task.FromResult(new DbResult(false, "{}")); }
        public Task<string> EditAsync(ICurrentContext me, Guid id, string payloadJson, CancellationToken ct) { LastPayload = payloadJson; return Task.FromResult("{}"); }
        public Task<string> ReleaseAsync(ICurrentContext me, Guid id, string payloadJson, CancellationToken ct) { LastPayload = payloadJson; return Task.FromResult("{}"); }
        public Task<string> RecordPaymentAsync(ICurrentContext me, Guid id, string payloadJson, CancellationToken ct) { LastPayload = payloadJson; return Task.FromResult("{}"); }
        public Task<string> ReceiveAsync(ICurrentContext me, Guid id, string payloadJson, CancellationToken ct) { LastPayload = payloadJson; return Task.FromResult("{}"); }
        public Task<string> CancelAsync(ICurrentContext me, Guid id, string reason, CancellationToken ct) { LastReason = reason; return Task.FromResult("{}"); }
        public Task<string> AddNoteAsync(ICurrentContext me, Guid id, string text, CancellationToken ct) => Task.FromResult("{}");
    }
}
