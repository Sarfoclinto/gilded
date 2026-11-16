using System.Text.RegularExpressions;
using GoldValuation.Application.Attachments;

namespace GoldValuation.Infrastructure.Attachments;

/// <summary>
/// Pictures as plain files under one folder (the photos volume on the server): tenant/year/id.jpg and tenant/year/id.t.jpg.
/// A file is written to a temporary name and renamed, so a half-written picture is never served. Keys are checked against a strict
/// pattern, so nothing outside the folder can ever be read or written.
/// </summary>
public sealed partial class FileBlobStore(string root) : IBlobStore
{
    // company pictures: tenant/year/id.jpg; personal pictures: tenant/p/owner/id.jpg
    [GeneratedRegex(@"^[0-9a-f]{32}/(\d{4}|p/[0-9a-f]{32})/[0-9a-f]{32}(\.t)?\.jpg$")]
    private static partial Regex KeyPattern();

    private string PathOf(string key)
    {
        if (!KeyPattern().IsMatch(key)) throw new ArgumentException("Not a valid picture key.", nameof(key));
        return Path.Combine(root, key.Replace('/', Path.DirectorySeparatorChar));
    }

    public async Task WriteAsync(string key, ReadOnlyMemory<byte> bytes, CancellationToken ct)
    {
        var path = PathOf(key);
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        var temp = path + "." + Guid.NewGuid().ToString("N") + ".tmp";
        try
        {
            await File.WriteAllBytesAsync(temp, bytes.ToArray(), ct);
            File.Move(temp, path, overwrite: true);
        }
        finally
        {
            if (File.Exists(temp)) File.Delete(temp);
        }
    }

    public Stream? Open(string key)
    {
        var path = PathOf(key);
        return File.Exists(path) ? new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read, 81920, useAsync: true) : null;
    }

    public void Delete(string key)
    {
        var path = PathOf(key);
        if (File.Exists(path)) File.Delete(path);
    }
}