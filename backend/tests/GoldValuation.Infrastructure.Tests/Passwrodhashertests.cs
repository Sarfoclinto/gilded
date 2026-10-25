using GoldValuation.Infrastructure.Auth;
using Xunit;

namespace GoldValuation.Infrastructure.Tests;

public class PasswordHasherTests
{
    private readonly Pbkdf2PasswordHasher _hasher = new();

    [Fact]
    public void A_correct_password_verifies_and_a_wrong_one_does_not()
    {
        var stored = _hasher.Hash("correct horse battery staple");
        Assert.True(_hasher.Verify("correct horse battery staple", stored).Ok);
        Assert.False(_hasher.Verify("correct horse battery stapl", stored).Ok);
        Assert.False(_hasher.Verify("", stored).Ok);
    }

    [Fact]
    public void The_same_password_hashes_differently_each_time_because_of_the_salt()
    {
        Assert.NotEqual(_hasher.Hash("same"), _hasher.Hash("same"));
    }

    [Fact]
    public void A_current_hash_does_not_ask_for_a_rehash()
    {
        Assert.False(_hasher.Verify("pw", _hasher.Hash("pw")).NeedsRehash);
    }

    [Fact]
    public void A_hash_made_with_fewer_iterations_still_verifies_and_asks_to_be_upgraded()
    {
        var salt = new byte[16];
        var weak = System.Security.Cryptography.Rfc2898DeriveBytes.Pbkdf2("pw", salt, 1000, System.Security.Cryptography.HashAlgorithmName.SHA256, 32);
        var stored = $"pbkdf2-sha256$1000${Convert.ToBase64String(salt)}${Convert.ToBase64String(weak)}";
        var check = _hasher.Verify("pw", stored);
        Assert.True(check.Ok);
        Assert.True(check.NeedsRehash);
    }

    [Theory]
    [InlineData("")]
    [InlineData("plaintext")]
    [InlineData("pbkdf2-sha256$abc$x$y")]
    [InlineData("pbkdf2-sha256$1000$not base64$also not")]
    [InlineData("pbkdf2-sha256$1000$$")]
    public void Malformed_stored_values_are_rejected_without_throwing(string stored)
    {
        Assert.False(_hasher.Verify("pw", stored).Ok);
    }
}
