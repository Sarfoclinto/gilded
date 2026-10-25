using GoldValuation.Application.Auth;

namespace GoldValuation.Api.Endpoints;

public sealed record LoginRequest(string? Username, string? Password, string? Company);

public static class AuthEndpoints
{
    public static RouteGroupBuilder MapAuth(this RouteGroupBuilder api)
    {
        var group = api.MapGroup("/auth").AllowAnonymous();
        group.MapPost("/login", Login).RequireRateLimiting("login");
        group.MapPost("/refresh", Refresh).RequireRateLimiting("refresh");
        group.MapPost("/logout", Logout);
        return api;
    }

    private static async Task<IResult> Login(LoginRequest? body, AuthService auth, AuthSettings settings, HttpContext http, CancellationToken ct)
    {
        var session = await auth.LoginAsync(new LoginCommand(body?.Username, body?.Password, body?.Company), Client(http), ct);
        return Respond(http, settings, session);
    }

    private static async Task<IResult> Refresh(AuthService auth, AuthSettings settings, HttpContext http, CancellationToken ct)
    {
        try
        {
            var session = await auth.RefreshAsync(http.Request.Cookies[settings.RefreshCookieName], Client(http), ct);
            return Respond(http, settings, session);
        }
        catch (GoldValuation.Application.Abstractions.AppException ex) when (ex.Code == AuthService.SessionExpired)
        {
            ClearCookie(http, settings);   // a dead cookie is worthless; remove it so the browser stops sending it
            throw;
        }
    }

    private static async Task<IResult> Logout(AuthService auth, AuthSettings settings, HttpContext http, CancellationToken ct)
    {
        await auth.LogoutAsync(http.Request.Cookies[settings.RefreshCookieName], Client(http), ct);
        ClearCookie(http, settings);
        http.Response.Headers.CacheControl = "no-store";
        return Results.NoContent();
    }

    private static IResult Respond(HttpContext http, AuthSettings settings, SessionResult s)
    {
        http.Response.Cookies.Append(settings.RefreshCookieName, s.RefreshTokenValue, BuildCookie(settings, s.RefreshExpiresAt));
        http.Response.Headers.CacheControl = "no-store";
        return Results.Ok(new { data = new { accessToken = s.AccessToken.Token, expiresAt = s.AccessToken.ExpiresAt, user = MeEndpoints.ToDto(s.User) } });
    }

    private static void ClearCookie(HttpContext http, AuthSettings settings) =>
        http.Response.Cookies.Delete(settings.RefreshCookieName, BuildCookie(settings, null));

    private static CookieOptions BuildCookie(AuthSettings settings, DateTimeOffset? expires) => new()
    {
        HttpOnly = true,
        Secure = settings.CookieSecure,
        SameSite = Enum.TryParse<SameSiteMode>(settings.CookieSameSite, ignoreCase: true, out var mode) ? mode : SameSiteMode.Lax,
        Path = "/api/v1/auth",
        Expires = expires,
    };

    private static ClientInfo Client(HttpContext http)
    {
        var agent = http.Request.Headers.UserAgent.ToString();
        return new ClientInfo(http.Connection.RemoteIpAddress, agent.Length > 300 ? agent[..300] : agent, http.TraceIdentifier);
    }
}
