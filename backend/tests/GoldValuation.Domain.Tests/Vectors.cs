using System.Text.Json;

namespace GoldValuation.Domain.Tests;

internal static class Vectors
{
    public static JsonElement Load(string file)
    {
        var path = Path.Combine(AppContext.BaseDirectory, "vectors", file);
        using var doc = JsonDocument.Parse(File.ReadAllText(path));
        return doc.RootElement.Clone();
    }
}
