using System.Security.Cryptography;
using GoldValuation.Application.Sync;

namespace GoldValuation.Infrastructure.Sync;

/// <summary>ECDSA P-256 / SHA-256. Keys are SPKI (what WebCrypto exports), signatures are the raw r||s form WebCrypto produces.</summary>
public sealed class EcdsaCommandVerifier : ICommandVerifier
{
    public bool Verify(string publicKeySpkiBase64, byte[] data, byte[] signature)
    {
        try
        {
            using var ecdsa = ECDsa.Create();
            ecdsa.ImportSubjectPublicKeyInfo(Convert.FromBase64String(publicKeySpkiBase64), out _);
            return ecdsa.VerifyData(data, signature, HashAlgorithmName.SHA256, DSASignatureFormat.IeeeP1363FixedFieldConcatenation);
        }
        catch (Exception ex) when (ex is CryptographicException or FormatException or ArgumentException)
        {
            return false;
        }
    }
}