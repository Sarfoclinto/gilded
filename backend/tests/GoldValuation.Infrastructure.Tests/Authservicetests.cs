using GoldValuation.Application.Abstractions;
using GoldValuation.Application.Auth;
using Xunit;

namespace GoldValuation.Infrastructure.Tests;

public class AuthServiceTests
{
    private static readonly Guid Tenant = Guid.Parse("11111111-1111-4111-8111-111111111111");
    private static readonly Guid UserId = Guid.Parse("aaaaaaaa-0000-4000-8000-000000000001");
    private static readonly ClientInfo Client = new(null, "tests", "trace");

    private readonly FakeStore _store;
    private readonly FakeClock _clock = new();
    private readonly AuthSettings _settings = new() { DefaultCompany = "demo", MaxFailedLogins = 3, LockoutMinutes = 10 };
    private readonly AuthService _service;

    public AuthServiceTests()
    {
        _store = new FakeStore(_clock);
        _service = new AuthService(_store, new FakeHasher(), new FakeTokens(), _clock, _settings);
    }

    private Task<SessionResult> SignIn(string? user = "ama", string? pw = "right-password", string? company = null) =>
        _service.LoginAsync(new LoginCommand(user, pw, company), Client, default);

    [Fact]
    public async Task Signing_in_returns_a_session_and_starts_a_refresh_login()
    {
        var s = await SignIn();
        Assert.Equal("ama", s.User.Username);
        Assert.Equal("access-token", s.AccessToken.Token);
        Assert.True(RefreshTokens.TryGetTenant(s.RefreshTokenValue, out var tenant) && tenant == Tenant);
        Assert.Equal(s.RefreshExpiresAt, _clock.UtcNow.AddDays(14));
        Assert.Single(_store.Families);
        Assert.Contains("auth.login", _store.Audit);
        Assert.Equal(0, _store.FailedCount);
    }

    [Fact]
    public async Task The_username_is_trimmed_and_the_company_can_come_from_the_request()
    {
        var s = await SignIn(" ama ", company: "demo");
        Assert.Equal("ama", s.User.Username);
    }

    [Theory]
    [InlineData(null, "pw")]
    [InlineData("  ", "pw")]
    [InlineData("ama", null)]
    [InlineData("ama", "")]
    public async Task Missing_fields_are_a_validation_error_naming_the_field(string? user, string? pw)
    {
        var ex = await Assert.ThrowsAsync<AppException>(() => SignIn(user, pw));
        Assert.Equal(422, ex.Status);
        Assert.NotNull(ex.FieldErrors);
    }

    [Fact]
    public async Task Wrong_password_unknown_user_unknown_company_and_a_switched_off_account_all_look_the_same()
    {
        var messages = new List<string>();
        foreach (var attempt in new Func<Task>[]
        {
            () => SignIn(pw: "wrong"),
            () => SignIn(user: "nobody"),
            () => SignIn(company: "nonexistent"),
            () => { _store.Active = false; return SignIn(); },
        })
        {
            var ex = await Assert.ThrowsAsync<AppException>(attempt);
            Assert.Equal(401, ex.Status);
            Assert.Equal(AuthService.InvalidCredentials, ex.Code);
            messages.Add(ex.Message);
        }
        Assert.Single(messages.Distinct());
    }

    [Fact]
    public async Task Repeated_wrong_passwords_lock_the_account_and_a_correct_password_is_then_refused()
    {
        for (var i = 0; i < 3; i++) await Assert.ThrowsAsync<AppException>(() => SignIn(pw: "wrong"));
        Assert.True(_store.LockedUntil > _clock.UtcNow);

        await Assert.ThrowsAsync<AppException>(() => SignIn());          // correct, but locked
        _clock.Advance(TimeSpan.FromMinutes(11));
        var s = await SignIn();                                           // lock has passed
        Assert.Equal("ama", s.User.Username);
        Assert.Null(_store.LockedUntil);
        Assert.Equal(0, _store.FailedCount);
    }

    [Fact]
    public async Task An_old_password_hash_is_upgraded_at_sign_in()
    {
        _store.PasswordHash = "old:right-password";
        await SignIn();
        Assert.Equal("new:right-password", _store.PasswordHash);
    }

    [Fact]
    public async Task Refreshing_gives_a_new_token_and_retires_the_old_one()
    {
        var first = await SignIn();
        var second = await _service.RefreshAsync(first.RefreshTokenValue, Client, default);
        Assert.NotEqual(first.RefreshTokenValue, second.RefreshTokenValue);
        var third = await _service.RefreshAsync(second.RefreshTokenValue, Client, default);   // the new one works, and chains on
        Assert.NotEqual(second.RefreshTokenValue, third.RefreshTokenValue);
    }

    [Fact]
    public async Task Using_a_retired_token_right_away_is_a_race_and_does_not_end_the_session()
    {
        var first = await SignIn();
        await _service.RefreshAsync(first.RefreshTokenValue, Client, default);
        var ex = await Assert.ThrowsAsync<AppException>(() => _service.RefreshAsync(first.RefreshTokenValue, Client, default));
        Assert.Equal(AuthService.RefreshInProgress, ex.Code);
        Assert.Equal(409, ex.Status);
    }

    [Fact]
    public async Task Replaying_a_long_retired_token_ends_the_session_and_is_audited()
    {
        var first = await SignIn();
        await _service.RefreshAsync(first.RefreshTokenValue, Client, default);
        _clock.Advance(TimeSpan.FromMinutes(5));
        var ex = await Assert.ThrowsAsync<AppException>(() => _service.RefreshAsync(first.RefreshTokenValue, Client, default));
        Assert.Equal(AuthService.SessionExpired, ex.Code);
        Assert.Contains("auth.refresh_reuse_detected", _store.Audit);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("garbage")]
    public async Task A_missing_or_malformed_cookie_is_an_ended_session(string? cookie)
    {
        var ex = await Assert.ThrowsAsync<AppException>(() => _service.RefreshAsync(cookie, Client, default));
        Assert.Equal(AuthService.SessionExpired, ex.Code);
    }

    [Fact]
    public async Task Signing_out_kills_the_refresh_token_and_tolerates_a_missing_cookie()
    {
        var s = await SignIn();
        await _service.LogoutAsync(s.RefreshTokenValue, Client, default);
        var ex = await Assert.ThrowsAsync<AppException>(() => _service.RefreshAsync(s.RefreshTokenValue, Client, default));
        Assert.Equal(AuthService.SessionExpired, ex.Code);
        await _service.LogoutAsync(null, Client, default);
    }

    [Fact]
    public void Refresh_tokens_carry_their_company_and_are_hashed_before_storage()
    {
        var value = RefreshTokens.Create(Tenant);
        Assert.True(RefreshTokens.TryGetTenant(value, out var t) && t == Tenant);
        Assert.Equal(32, RefreshTokens.Hash(value).Length);
        Assert.NotEqual(value, RefreshTokens.Create(Tenant));
    }

    // ---- fakes ----

    private sealed class FakeClock : IClock
    {
        public DateTimeOffset UtcNow { get; private set; } = new(2026, 10, 23, 9, 0, 0, TimeSpan.Zero);
        public void Advance(TimeSpan by) => UtcNow += by;
    }

    private sealed class FakeHasher : IPasswordHasher
    {
        public string Hash(string password) => "new:" + password;
        public PasswordCheck Verify(string password, string stored) =>
            stored.EndsWith(":" + password, StringComparison.Ordinal)
                ? new PasswordCheck(true, stored.StartsWith("old:", StringComparison.Ordinal))
                : new PasswordCheck(false, false);
        public void SpendTime(string password) { }
    }

    private sealed class FakeTokens : IAccessTokenIssuer
    {
        public IssuedAccessToken Issue(Guid tenantId, SessionUser user) => new("access-token", DateTimeOffset.UtcNow.AddMinutes(15));
    }

    private sealed class FakeStore(FakeClock clock) : IAuthStore
    {
        public string PasswordHash = "new:right-password";
        public bool Active = true;
        public int FailedCount;
        public DateTimeOffset? LockedUntil;
        public readonly List<string> Audit = [];
        public readonly List<Guid> Families = [];
        private readonly Dictionary<string, Token> _tokens = new();

        private sealed class Token { public Guid Family; public DateTimeOffset? RevokedAt; public bool Replaced; }

        public Task<Guid?> FindTenantAsync(string company, CancellationToken ct) =>
            Task.FromResult<Guid?>(company.Equals("demo", StringComparison.OrdinalIgnoreCase) ? Tenant : null);

        public Task<LoginUser?> FindLoginUserAsync(Guid tenantId, string username, CancellationToken ct) =>
            Task.FromResult<LoginUser?>(username == "ama"
                ? new LoginUser(UserId, "ama", "Ama", PasswordHash, Active, LockedUntil, "teller")
                : null);

        public Task RecordLoginFailureAsync(Guid tenantId, Guid userId, int maxFailures, DateTimeOffset lockUntil, CancellationToken ct)
        {
            if (FailedCount + 1 >= maxFailures) { LockedUntil = lockUntil; FailedCount = 0; } else FailedCount++;
            return Task.CompletedTask;
        }

        public Task RecordLoginSuccessAsync(Guid tenantId, Guid userId, DateTimeOffset now, string? newPasswordHash, CancellationToken ct)
        {
            FailedCount = 0; LockedUntil = null;
            if (newPasswordHash is not null) PasswordHash = newPasswordHash;
            return Task.CompletedTask;
        }

        public Task<SessionUser?> LoadSessionUserAsync(Guid tenantId, Guid userId, CancellationToken ct) =>
            Task.FromResult<SessionUser?>(new SessionUser(userId, "ama", "Ama", "teller", ["days:read"], [Guid.NewGuid()]));

        public Task<IReadOnlyList<BranchInfo>> ListBranchesAsync(Guid tenantId, Guid userId, CancellationToken ct) =>
            Task.FromResult<IReadOnlyList<BranchInfo>>([]);

        public Task StartRefreshFamilyAsync(Guid tenantId, Guid userId, byte[] tokenHash, DateTimeOffset expiresAt, ClientInfo client, CancellationToken ct)
        {
            var family = Guid.NewGuid();
            Families.Add(family);
            _tokens[Convert.ToHexString(tokenHash)] = new Token { Family = family };
            return Task.CompletedTask;
        }

        public Task<RotationResult> RotateRefreshTokenAsync(Guid tenantId, byte[] oldHash, byte[] newHash, DateTimeOffset expiresAt, ClientInfo client, CancellationToken ct)
        {
            if (!_tokens.TryGetValue(Convert.ToHexString(oldHash), out var t)) return Task.FromResult(new RotationResult(RefreshOutcome.Unknown, null, null));
            if (t.RevokedAt is { } at)
            {
                if (!t.Replaced) return Task.FromResult(new RotationResult(RefreshOutcome.Revoked, UserId, t.Family));
                if (Now() - at <= TimeSpan.FromSeconds(10)) return Task.FromResult(new RotationResult(RefreshOutcome.Race, UserId, t.Family));
                foreach (var x in _tokens.Values.Where(x => x.Family == t.Family && x.RevokedAt is null)) x.RevokedAt = Now();
                return Task.FromResult(new RotationResult(RefreshOutcome.Reused, UserId, t.Family));
            }
            t.RevokedAt = Now(); t.Replaced = true;
            _tokens[Convert.ToHexString(newHash)] = new Token { Family = t.Family };
            return Task.FromResult(new RotationResult(RefreshOutcome.Ok, UserId, t.Family));
        }

        public Task RevokeRefreshFamilyAsync(Guid tenantId, byte[] tokenHash, CancellationToken ct)
        {
            if (_tokens.TryGetValue(Convert.ToHexString(tokenHash), out var t))
                foreach (var x in _tokens.Values.Where(x => x.Family == t.Family && x.RevokedAt is null)) x.RevokedAt = Now();
            return Task.CompletedTask;
        }

        public Task AuditAsync(Guid tenantId, Guid? actorUserId, string action, string entityType, string entityId, ClientInfo client, CancellationToken ct)
        {
            Audit.Add(action);
            return Task.CompletedTask;
        }

        private DateTimeOffset Now() => clock.UtcNow;
    }
}
