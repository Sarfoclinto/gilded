# Gold valuation: core

Pure calculation engine (ExcelV1) and note solver. No UI, no database.

- `core-ts/` TypeScript implementation (decimal.js, vitest). Run `npm install && npm test`.
- `vectors/` shared golden vectors. The C# port must pass the same files:
  - `calc-golden.json`: the 18 rows from the Excel sheet, plus sheet totals.
  - `solver-cases.json`: note-solver and rounding cases.

## Calculation (ExcelV1), every step truncates
density = floor2(Top/Down); baseKarat = floor2((density-10.51) x 52.838 / density);
karat = floor2(baseKarat x (1-0.007)); purity = floor4(karat/24); net = floor2(purity x Top);
pounds = floor2(Top/7.75); amount = floor0(price x karat x pounds / 23).

## Notes
Notes 200/100/50/20/10/5, bounded by drawer counts, exact (not greedy). Strategies: `fewest-notes`, `prefer-100s`.
Display: 100 notes = bundle, 10 bundles = pack.
