using System.Security.Cryptography;
using System.Text;

namespace GoldValuation.Application.Auth;

/// <summary>
/// The refresh token is "&lt;company id&gt;.&lt;random secret&gt;". The company id lets the server open the right company
/// before it knows who the caller is (every table is locked to one company); the secret is what proves the login.
/// Only a SHA-256 hash of the whole value is stored, so a database leak does not leak sessions.
/// </summary>
public static class RefreshTokens
{
    public static string Create(Guid tenantId)
    {
        var secret = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32)).TrimEnd('=').Replace('+', '-').Replace('/', '_');
        return $"{tenantId:N}.{secret}";
    }

    public static byte[] Hash(string value) => SHA256.HashData(Encoding.UTF8.GetBytes(value));

    public static bool TryGetTenant(string? value, out Guid tenantId)
    {
        tenantId = Guid.Empty;
        if (string.IsNullOrEmpty(value) || value.Length > 128) return false;
        var dot = value.IndexOf('.');
        return dot == 32 && value.Length > 40 && Guid.TryParseExact(value.AsSpan(0, 32), "N", out tenantId);
    }
}
