using System.Text;
using System.Threading.RateLimiting;
using GoldValuation.Application.Abstractions;
using GoldValuation.Application.Auth;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.IdentityModel.Tokens;

namespace GoldValuation.Api.Auth;

public static class AuthSetup
{
    public static IServiceCollection AddAuth(this IServiceCollection services, IConfiguration config)
    {
        var settings = config.GetSection("Auth").Get<AuthSettings>() ?? new AuthSettings();
        if (settings.SigningKey.Length < 32)
            throw new InvalidOperationException(
                "Auth:SigningKey must be at least 32 characters. For development: dotnet user-secrets set \"Auth:SigningKey\" \"<a long random text>\" --project src/GoldValuation.Api");

        services.AddSingleton(settings);
        services.AddSingleton<IAccessTokenIssuer, JwtAccessTokenIssuer>();
        services.AddScoped<AuthService>();
        services.AddHttpContextAccessor();
        services.AddScoped<ICurrentContext, HttpCurrentContext>();

        services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme).AddJwtBearer(o =>
        {
            o.MapInboundClaims = false;   // keep our short claim names (sub, tid, perm, branch)
            o.TokenValidationParameters = new TokenValidationParameters
            {
                ValidateIssuer = true, ValidIssuer = settings.Issuer,
                ValidateAudience = true, ValidAudience = settings.Audience,
                ValidateIssuerSigningKey = true,
                IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(settings.SigningKey)),
                ValidateLifetime = true,
                ClockSkew = TimeSpan.FromSeconds(30),
                NameClaimType = "sub",
                RoleClaimType = "role",
            };
            o.Events = new JwtBearerEvents
            {
                // Browsers cannot set headers on a WebSocket, so the live-updates connection sends the token in the query string.
                OnMessageReceived = ctx =>
                {
                    var token = ctx.Request.Query["access_token"];
                    if (!string.IsNullOrEmpty(token) && ctx.HttpContext.Request.Path.StartsWithSegments("/hubs")) ctx.Token = token;
                    return Task.CompletedTask;
                },
                OnChallenge = ctx =>
                {
                    ctx.HandleResponse();
                    return ErrorEnvelopeMiddleware.Write(ctx.HttpContext, 401, "UNAUTHENTICATED", "Please sign in.", null);
                },
            };
        });

        // Safe by default: every endpoint needs a signed-in user unless it says AllowAnonymous.
        services.AddAuthorization(o => o.FallbackPolicy = new AuthorizationPolicyBuilder().RequireAuthenticatedUser().Build());

        services.AddRateLimiter(o =>
        {
            o.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
            o.OnRejected = (ctx, _) =>
            {
                ctx.HttpContext.Response.Headers.RetryAfter = "60";
                return new ValueTask(ErrorEnvelopeMiddleware.Write(
                    ctx.HttpContext, 429, "RATE_LIMITED", "Too many attempts. Wait a minute and try again.", null));
            };
            o.AddPolicy("login", http => PerAddress(http, 10));
            o.AddPolicy("refresh", http => PerAddress(http, 60));
        });

        var origins = config.GetSection("Cors:Origins").Get<string[]>() ?? [];
        services.AddCors(o => o.AddDefaultPolicy(p =>
        {
            if (origins.Length == 0) return;   // no browser origin allowed until one is configured
            p.WithOrigins(origins)
                .WithMethods("GET", "POST", "PUT", "PATCH", "DELETE")
                .WithHeaders("Content-Type", "Authorization", "Idempotency-Key", "X-Client-Time", "X-Client-Version", "X-Requested-With", "X-SignalR-User-Agent")
                .AllowCredentials();
        }));

        return services;
    }

    private static RateLimitPartition<string> PerAddress(HttpContext http, int perMinute) =>
        RateLimitPartition.GetFixedWindowLimiter(
            http.Connection.RemoteIpAddress?.ToString() ?? "unknown",
            _ => new FixedWindowRateLimiterOptions { PermitLimit = perMinute, Window = TimeSpan.FromMinutes(1), QueueLimit = 0 });
}