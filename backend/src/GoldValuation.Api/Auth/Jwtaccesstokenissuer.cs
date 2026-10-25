using System.Text;
using GoldValuation.Application.Abstractions;
using GoldValuation.Application.Auth;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;

namespace GoldValuation.Api.Auth;

/// <summary>
/// Short-lived signed access token. Claims: sub (user), tid (company), name, role, perm (each permission), branch (each branch id).
/// Permissions travel inside the token so each request needs no lookup; they can be up to <c>AccessTokenMinutes</c> out of date,
/// which is why that stays short and why /me always reads the database.
/// </summary>
public sealed class JwtAccessTokenIssuer(AuthSettings settings, IClock clock) : IAccessTokenIssuer
{
    private readonly SigningCredentials _credentials = new(
        new SymmetricSecurityKey(Encoding.UTF8.GetBytes(settings.SigningKey)), SecurityAlgorithms.HmacSha256);

    public IssuedAccessToken Issue(Guid tenantId, SessionUser user)
    {
        var now = clock.UtcNow;
        var expires = now.AddMinutes(settings.AccessTokenMinutes);
        var descriptor = new SecurityTokenDescriptor
        {
            Issuer = settings.Issuer,
            Audience = settings.Audience,
            IssuedAt = now.UtcDateTime,
            NotBefore = now.UtcDateTime,
            Expires = expires.UtcDateTime,
            SigningCredentials = _credentials,
            Claims = new Dictionary<string, object>
            {
                ["sub"] = user.Id.ToString(),
                ["tid"] = tenantId.ToString(),
                ["name"] = user.DisplayName,
                ["role"] = user.Role,
                ["perm"] = user.Permissions.ToArray(),
                ["branch"] = user.BranchIds.Select(b => b.ToString()).ToArray(),
            },
        };
        return new IssuedAccessToken(new JsonWebTokenHandler().CreateToken(descriptor), expires);
    }
}
