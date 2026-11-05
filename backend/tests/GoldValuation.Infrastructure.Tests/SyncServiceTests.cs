using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Nodes;
using GoldValuation.Application.Abstractions;
using GoldValuation.Application.Auth;
using GoldValuation.Application.Sync;
using GoldValuation.Infrastructure.Sync;
using Xunit;

namespace GoldValuation.Infrastructure.Tests;

public class SyncServiceTests
{
    private static readonly Guid Tenant = Guid.Parse("44444444-4444-4444-8444-444444444444");
    private static readonly Guid Teller = Guid.Parse("aaaaaaaa-0000-4000-8000-000000000002");
    private const string Device = "dev-12345678";

    private sealed class Ctx(params string[] permissions) : ICurrentContext
    {
        public Guid TenantId => Tenant;
        public Guid UserId => Guid.Parse("aaaaaaaa-0000-4000-8000-000000000001");
        public IReadOnlySet<Guid> BranchIds { get; } = new HashSet<Guid>();
        public bool Has(string permission) => permissions.Contains(permission);
    }

    private sealed class FakeStore : ISyncStore
    {
        public string? Key;
        public SyncAuthor? Author = new(true, new HashSet<string> { Permissions.TransactionsCreate, Permissions.DaysManage });
        public List<(Guid User, string Json)> Applied = [];
        public string? LastResolve;
        public Task<string> RegisterDeviceAsync(ICurrentContext me, string json, CancellationToken ct) { LastResolve = json; return Task.FromResult("{\"ok\":true}"); }
        public Task<string?> DeviceKeyAsync(Guid tenantId, Guid userId, string deviceId, CancellationToken ct) => Task.FromResult(deviceId == Device ? Key : null);
        public Task<SyncAuthor?> AuthorAsync(Guid tenantId, Guid userId, CancellationToken ct) => Task.FromResult(Author);
        public Task<string> ApplyAsync(Guid tenantId, Guid userId, string json, CancellationToken ct)
        {
            Applied.Add((userId, json));
            var id = JsonNode.Parse(json)!["id"]!.GetValue<string>();
            return Task.FromResult($"{{\"id\":\"{id}\",\"status\":\"applied\",\"flags\":[],\"replayed\":false}}");
        }
        public Task<string> ReviewAsync(ICurrentContext me, CancellationToken ct) => Task.FromResult("{\"items\":[]}");
        public Task<string> ResolveAsync(ICurrentContext me, string json, CancellationToken ct) { LastResolve = json; return Task.FromResult("{\"status\":\"applied\"}"); }
    }

    private static (SyncService Svc, FakeStore Store, ECDsa Key) Make()
    {
        var key = ECDsa.Create(ECCurve.NamedCurves.nistP256);
        var store = new FakeStore { Key = Convert.ToBase64String(key.ExportSubjectPublicKeyInfo()) };
        return (new SyncService(store, new EcdsaCommandVerifier()), store, key);
    }

    private static JsonObject Command(ECDsa key, string type = "transaction.create", string? payload = null, string? signedPayload = null, string? id = null, Guid? user = null, string device = Device)
    {
        id ??= Guid.NewGuid().ToString();
        var uid = (user ?? Teller).ToString();
        payload ??= "{\"branchId\":\"b1\"}";
        const string at = "2026-11-02T08:00:00.000Z";
        var sig = key.SignData(Encoding.UTF8.GetBytes(SyncService.SigningMessage(id, type, uid, device, at, signedPayload ?? payload)), HashAlgorithmName.SHA256, DSASignatureFormat.IeeeP1363FixedFieldConcatenation);
        return new JsonObject { ["id"] = id, ["type"] = type, ["userId"] = uid, ["deviceId"] = device, ["capturedAt"] = at, ["payloadJson"] = payload, ["signature"] = Convert.ToBase64String(sig) };
    }

    private static JsonObject Batch(params JsonObject[] commands) => new() { ["commands"] = new JsonArray(commands.Select(c => (JsonNode?)c).ToArray()) };
    private static JsonNode First(string json) => JsonNode.Parse(json)!["results"]![0]!;

    [Fact]
    public async Task A_correctly_signed_command_is_applied_as_the_person_who_made_it()
    {
        var (svc, store, key) = Make();
        var res = First(await svc.SubmitAsync(new Ctx(), Batch(Command(key)), default));
        Assert.Equal("applied", res["status"]!.GetValue<string>());
        Assert.Equal(Teller, Assert.Single(store.Applied).User);
        var sent = JsonNode.Parse(store.Applied[0].Json)!;
        Assert.Equal("b1", sent["payload"]!["branchId"]!.GetValue<string>());
        Assert.Equal(Device, sent["deviceId"]!.GetValue<string>());
    }

    [Fact]
    public async Task A_changed_payload_breaks_the_signature_and_nothing_is_applied()
    {
        var (svc, store, key) = Make();
        var tampered = Command(key, payload: "{\"branchId\":\"b1\",\"amount\":99999}", signedPayload: "{\"branchId\":\"b1\"}");
        var res = First(await svc.SubmitAsync(new Ctx(), Batch(tampered), default));
        Assert.Equal("refused", res["status"]!.GetValue<string>());
        Assert.Equal("BAD_SIGNATURE", res["code"]!.GetValue<string>());
        Assert.Empty(store.Applied);
    }

    [Fact]
    public async Task Another_persons_key_cannot_sign_for_someone_else()
    {
        var (svc, store, _) = Make();
        using var attacker = ECDsa.Create(ECCurve.NamedCurves.nistP256);
        var res = First(await svc.SubmitAsync(new Ctx(), Batch(Command(attacker)), default));
        Assert.Equal("BAD_SIGNATURE", res["code"]!.GetValue<string>());
        Assert.Empty(store.Applied);
    }

    [Fact]
    public async Task An_unregistered_device_is_refused()
    {
        var (svc, store, key) = Make();
        var res = First(await svc.SubmitAsync(new Ctx(), Batch(Command(key, device: "other-device-1")), default));
        Assert.Equal("UNKNOWN_DEVICE", res["code"]!.GetValue<string>());
        Assert.Empty(store.Applied);
    }

    [Fact]
    public async Task An_inactive_person_or_one_without_permission_is_refused()
    {
        var (svc, store, key) = Make();
        store.Author = new SyncAuthor(false, new HashSet<string> { Permissions.TransactionsCreate });
        Assert.Equal("USER_INACTIVE", First(await svc.SubmitAsync(new Ctx(), Batch(Command(key)), default))["code"]!.GetValue<string>());
        store.Author = new SyncAuthor(true, new HashSet<string> { Permissions.DaysManage });
        Assert.Equal("FORBIDDEN", First(await svc.SubmitAsync(new Ctx(), Batch(Command(key)), default))["code"]!.GetValue<string>());
        Assert.Empty(store.Applied);
    }

    [Fact]
    public async Task A_note_exchange_without_a_purchase_needs_the_exchange_permission()
    {
        var (svc, store, key) = Make();
        store.Author = new SyncAuthor(true, new HashSet<string> { Permissions.DaysManage });
        Assert.Equal("FORBIDDEN", First(await svc.SubmitAsync(new Ctx(), Batch(Command(key, "drawer.exchange", "{\"dayId\":\"d\"}")), default))["code"]!.GetValue<string>());
        store.Author = new SyncAuthor(true, new HashSet<string> { Permissions.NotesExchange });
        Assert.Equal("applied", First(await svc.SubmitAsync(new Ctx(), Batch(Command(key, "drawer.exchange", "{\"dayId\":\"d\"}")), default))["status"]!.GetValue<string>());
    }

    [Fact]
    public async Task Unknown_types_and_incomplete_commands_are_refused_and_do_not_stop_the_rest()
    {
        var (svc, store, key) = Make();
        var json = await svc.SubmitAsync(new Ctx(), Batch(Command(key, "drop.table"), new JsonObject { ["id"] = "x" }, Command(key)), default);
        var results = JsonNode.Parse(json)!["results"]!.AsArray();
        Assert.Equal(3, results.Count);
        Assert.Equal("BAD_COMMAND", results[0]!["code"]!.GetValue<string>());
        Assert.Equal("BAD_COMMAND", results[1]!["code"]!.GetValue<string>());
        Assert.Equal("applied", results[2]!["status"]!.GetValue<string>());
        Assert.Single(store.Applied);
    }

    [Fact]
    public async Task Commands_are_applied_in_the_order_sent()
    {
        var (svc, store, key) = Make();
        var a = Command(key, "day.open"); var b = Command(key); var c = Command(key, "drawer.movement");
        await svc.SubmitAsync(new Ctx(), Batch(a, b, c), default);
        Assert.Equal([a["id"]!.GetValue<string>(), b["id"]!.GetValue<string>(), c["id"]!.GetValue<string>()],
                     store.Applied.Select(x => JsonNode.Parse(x.Json)!["id"]!.GetValue<string>()).ToArray());
    }

    [Fact]
    public async Task A_batch_is_limited()
    {
        var (svc, _, key) = Make();
        var many = Enumerable.Range(0, SyncService.MaxBatch + 1).Select(_ => Command(key)).ToArray();
        await Assert.ThrowsAsync<AppException>(() => svc.SubmitAsync(new Ctx(), Batch(many), default));
    }

    [Fact]
    public async Task Reviewing_needs_sync_review_and_dismissing_names_a_valid_action()
    {
        var (svc, store, _) = Make();
        await Assert.ThrowsAsync<AppException>(() => svc.ReviewAsync(new Ctx(Permissions.DaysManage), default));
        await svc.ReviewAsync(new Ctx(Permissions.SyncReview), default);
        await Assert.ThrowsAsync<AppException>(() => svc.ResolveAsync(new Ctx(Permissions.DaysManage), Guid.NewGuid(), new JsonObject { ["action"] = "retry" }, default));
        await Assert.ThrowsAsync<AppException>(() => svc.ResolveAsync(new Ctx(Permissions.SyncReview), Guid.NewGuid(), new JsonObject { ["action"] = "delete" }, default));
        await svc.ResolveAsync(new Ctx(Permissions.SyncReview), Guid.NewGuid(), new JsonObject { ["action"] = "dismiss", ["note"] = "Typed by mistake" }, default);
        Assert.Contains("Typed by mistake", store.LastResolve);
    }

    [Fact]
    public async Task Registering_a_device_checks_the_lengths()
    {
        var (svc, _, key) = Make();
        var spki = Convert.ToBase64String(key.ExportSubjectPublicKeyInfo());
        await svc.RegisterDeviceAsync(new Ctx(), new JsonObject { ["deviceId"] = Device, ["publicKey"] = spki }, default);
        await Assert.ThrowsAsync<AppException>(() => svc.RegisterDeviceAsync(new Ctx(), new JsonObject { ["deviceId"] = "x", ["publicKey"] = spki }, default));
        await Assert.ThrowsAsync<AppException>(() => svc.RegisterDeviceAsync(new Ctx(), new JsonObject { ["deviceId"] = Device, ["publicKey"] = "short" }, default));
    }

    [Fact]
    public void The_verifier_accepts_good_signatures_and_rejects_everything_else()
    {
        using var key = ECDsa.Create(ECCurve.NamedCurves.nistP256);
        var spki = Convert.ToBase64String(key.ExportSubjectPublicKeyInfo());
        var data = Encoding.UTF8.GetBytes("hello");
        var sig = key.SignData(data, HashAlgorithmName.SHA256, DSASignatureFormat.IeeeP1363FixedFieldConcatenation);
        var v = new EcdsaCommandVerifier();
        Assert.True(v.Verify(spki, data, sig));
        Assert.False(v.Verify(spki, Encoding.UTF8.GetBytes("hellp"), sig));
        Assert.False(v.Verify(spki, data, new byte[64]));
        Assert.False(v.Verify("not base64 !!", data, sig));
        Assert.False(v.Verify(Convert.ToBase64String(new byte[91]), data, sig));
    }
}