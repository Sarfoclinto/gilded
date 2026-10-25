namespace GoldValuation.Domain.Accounting;

/// <summary>Notes by denomination, e.g. {100: 1688, 20: 1}. Zero entries are never kept.</summary>
public static class NoteLines
{
    public static IReadOnlyDictionary<int, int> Add(IReadOnlyDictionary<int, int> a, IReadOnlyDictionary<int, int> b) => Combine(a, b, 1);

    public static IReadOnlyDictionary<int, int> Subtract(IReadOnlyDictionary<int, int> a, IReadOnlyDictionary<int, int> b) => Combine(a, b, -1);

    public static decimal Value(IReadOnlyDictionary<int, int> lines) => lines.Sum(kv => (decimal)kv.Key * kv.Value);

    public static int Count(IReadOnlyDictionary<int, int> lines) => lines.Values.Sum();

    private static Dictionary<int, int> Combine(IReadOnlyDictionary<int, int> a, IReadOnlyDictionary<int, int> b, int sign)
    {
        var result = new Dictionary<int, int>(a);
        foreach (var (denom, count) in b) result[denom] = result.GetValueOrDefault(denom) + sign * count;
        foreach (var key in result.Where(kv => kv.Value == 0).Select(kv => kv.Key).ToList()) result.Remove(key);
        return result;
    }
}
