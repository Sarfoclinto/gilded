using System.Security.Cryptography;
using GoldValuation.Application.Auth;

namespace GoldValuation.Infrastructure.Auth;

/// <summary>
/// PBKDF2-SHA256 with a random salt, stored as <c>pbkdf2-sha256$iterations$salt$hash</c>.
/// The iteration count travels with each hash, so it can be raised later: old hashes still verify and are upgraded at the next sign-in.
/// </summary>
public sealed class Pbkdf2PasswordHasher : IPasswordHasher
{
    private const string Prefix = "pbkdf2-sha256";
    private const int Iterations = 600_000;   // OWASP guidance for PBKDF2-HMAC-SHA256
    private const int SaltBytes = 16;
    private const int HashBytes = 32;

    private readonly string _dummy;

    public Pbkdf2PasswordHasher() => _dummy = Hash(Convert.ToBase64String(RandomNumberGenerator.GetBytes(16)));

    public string Hash(string password)
    {
        var salt = RandomNumberGenerator.GetBytes(SaltBytes);
        var hash = Rfc2898DeriveBytes.Pbkdf2(password, salt, Iterations, HashAlgorithmName.SHA256, HashBytes);
        return $"{Prefix}${Iterations}${Convert.ToBase64String(salt)}${Convert.ToBase64String(hash)}";
    }

    public PasswordCheck Verify(string password, string stored)
    {
        var parts = stored.Split('$');
        if (parts.Length != 4 || parts[0] != Prefix || !int.TryParse(parts[1], out var iterations) || iterations < 1)
            return new PasswordCheck(false, false);

        byte[] salt, expected;
        try
        {
            salt = Convert.FromBase64String(parts[2]);
            expected = Convert.FromBase64String(parts[3]);
        }
        catch (FormatException)
        {
            return new PasswordCheck(false, false);
        }

        if (salt.Length < 8 || expected.Length < 16) return new PasswordCheck(false, false);   // an empty hash must never match anything

        var actual = Rfc2898DeriveBytes.Pbkdf2(password, salt, iterations, HashAlgorithmName.SHA256, expected.Length);
        var ok = CryptographicOperations.FixedTimeEquals(actual, expected);
        return new PasswordCheck(ok, ok && iterations < Iterations);
    }

    public void SpendTime(string password) => Verify(password, _dummy);
}
