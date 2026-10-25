namespace GoldValuation.Domain.Notes;

public enum SolveStrategy { FewestNotes, Prefer100s }

public enum PayablePolicy { Down, Up, Nearest }

/// <summary>Packaging as the business counts it: 100 notes to a bundle, 10 bundles to a pack.</summary>
public sealed record CountDisplay(int Packs, int Bundles, int Loose, int Total);

public sealed record SolveResult(
    bool Ok,
    string? ErrorCode,
    string? Message,
    IReadOnlyDictionary<int, int> Lines,
    int TotalNotes,
    int Hundreds,
    int? NearestBelow,
    int? NearestAbove);

public sealed record PayableResult(int Amount, int Payable, int Difference);

/// <summary>
/// Note solver, ported from core-ts/src/solver.ts: an exact bounded-knapsack in units of 5, never a greedy guess
/// (60 from 50s and 20s is three 20s). <paramref name="limits"/> maps a denomination to the notes available:
/// a number is a maximum, null is unlimited, a missing key means that note is not available.
/// </summary>
public static class NoteSolver
{
    public static readonly int[] Denominations = [200, 100, 50, 20, 10, 5];
    public const int NotesPerBundle = 100;
    public const int BundlesPerPack = 10;
    private const long Big = 1_000_000_000;

    public static CountDisplay Describe(int notes)
    {
        var packs = notes / (NotesPerBundle * BundlesPerPack);
        var afterPacks = notes - packs * NotesPerBundle * BundlesPerPack;
        var bundles = afterPacks / NotesPerBundle;
        return new CountDisplay(packs, bundles, afterPacks - bundles * NotesPerBundle, notes);
    }

    public static PayableResult ToPayable(int amount, PayablePolicy policy = PayablePolicy.Down)
    {
        if (amount < 0) throw new ArgumentOutOfRangeException(nameof(amount), "amount must be zero or more");
        var rem = amount % 5;
        var payable = amount - rem;
        if (rem != 0 && (policy == PayablePolicy.Up || (policy == PayablePolicy.Nearest && rem >= 3))) payable += 5;
        return new PayableResult(amount, payable, payable - amount);
    }

    private sealed record Item(int Denom, int Notes, int Units, long Cost);

    private static SolveResult Fail(string code, string message, int? below = null, int? above = null) =>
        new(false, code, message, new Dictionary<int, int>(), 0, 0, below, above);

    public static SolveResult Solve(int amount, IReadOnlyDictionary<int, int?> limits, SolveStrategy strategy = SolveStrategy.FewestNotes)
    {
        if (amount < 0) return Fail("INVALID_AMOUNT", "Amount must be a whole number of cedis, zero or more.");
        if (amount % 5 != 0) return Fail("NOT_MULTIPLE_OF_5", "Amount must be a multiple of 5. Round it first.");
        foreach (var (denom, limit) in limits)
        {
            if (Array.IndexOf(Denominations, denom) < 0) return Fail("INVALID_DENOMINATION", $"{denom} is not a supported note.");
            if (limit is < 0) return Fail("INVALID_LIMIT", $"Limit for {denom} must be null or a whole number, zero or more.");
        }

        var units = amount / 5;
        var available = Denominations.Where(d => limits.TryGetValue(d, out var l) && l != 0).ToArray();
        var smallest = available.Length > 0 ? available.Min() / 5 : 0;
        var maxUnits = units + smallest;

        var items = BuildItems(limits, maxUnits, strategy);
        var width = maxUnits + 1;
        var dp = new long[width];
        Array.Fill(dp, long.MaxValue);
        dp[0] = 0;
        var took = new bool[items.Count * width];
        for (var i = 0; i < items.Count; i++)
        {
            var it = items[i];
            var baseIndex = i * width;
            for (var a = maxUnits; a >= it.Units; a--)
            {
                var prev = dp[a - it.Units];
                if (prev == long.MaxValue) continue;
                var cand = prev + it.Cost;
                if (cand < dp[a])
                {
                    dp[a] = cand;
                    took[baseIndex + a] = true;
                }
            }
        }

        if (dp[units] != long.MaxValue)
        {
            var counts = new Dictionary<int, int>();
            var a = units;
            for (var i = items.Count - 1; i >= 0; i--)
            {
                if (!took[i * width + a]) continue;
                var it = items[i];
                counts[it.Denom] = counts.GetValueOrDefault(it.Denom) + it.Notes;
                a -= it.Units;
            }
            var lines = new SortedDictionary<int, int>(Comparer<int>.Create((x, y) => y.CompareTo(x)));
            foreach (var d in Denominations)
            {
                if (counts.TryGetValue(d, out var n) && n > 0) lines[d] = n;
            }
            return new SolveResult(true, null, null, lines, lines.Values.Sum(), counts.GetValueOrDefault(100), null, null);
        }

        int? below = null;
        for (var a = units - 1; a >= 0; a--)
        {
            if (dp[a] != long.MaxValue) { below = a * 5; break; }
        }
        int? above = null;
        for (var a = units + 1; a <= maxUnits; a++)
        {
            if (dp[a] != long.MaxValue) { above = a * 5; break; }
        }
        return Fail("CANNOT_MAKE_AMOUNT", "The drawer cannot make this exact amount with the notes available.", below, above);
    }

    private static List<Item> BuildItems(IReadOnlyDictionary<int, int?> limits, int maxUnits, SolveStrategy strategy)
    {
        var items = new List<Item>();
        foreach (var d in Denominations)
        {
            if (!limits.TryGetValue(d, out var raw)) continue;
            var byAmount = (int)((long)maxUnits * 5 / d);
            var cap = raw is { } r ? Math.Min(r, byAmount) : byAmount;
            var unitsPerNote = d / 5;
            var perNoteCost = strategy == SolveStrategy.Prefer100s && d == 100 ? 1 - Big : 1;
            var remaining = cap;
            var chunk = 1;
            while (remaining > 0)
            {
                var n = Math.Min(chunk, remaining);
                items.Add(new Item(d, n, n * unitsPerNote, n * perNoteCost));
                remaining -= n;
                chunk *= 2;
            }
        }
        return items;
    }
}
