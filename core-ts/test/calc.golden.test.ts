import { describe, expect, it } from 'vitest';
import vectors from '../../vectors/calc-golden.json';
import { calculate, EXCEL_V1, type CalcConfig } from '../src';

const config: CalcConfig = { formulaVersion: 'ExcelV1', ...vectors.config };

describe('ExcelV1 golden vectors (18 sheet rows)', () => {
  it('config in the vectors matches the engine defaults', () => {
    expect(config).toEqual(EXCEL_V1);
  });

  for (const row of vectors.rows) {
    it(`${row.name}: ${row.top} / ${row.down} @ ${row.price}`, () => {
      const r = calculate({ top: row.top, down: row.down, price: row.price }, config);
      expect(r.errors).toEqual([]);
      expect({
        density: r.density,
        karat: r.karat,
        purity: r.purity,
        netWeight: r.netWeight,
        pounds: r.pounds,
        amount: r.amount,
      }).toEqual({
        density: row.density,
        karat: row.karat,
        purity: row.purity,
        netWeight: row.netWeight,
        pounds: row.pounds,
        amount: row.amount,
      });
    });
  }

  it('totals match the sheet', () => {
    const amounts = vectors.rows.reduce((s, r) => s + Number(r.amount), 0);
    const tops = vectors.rows.reduce((s, r) => s + Math.round(Number(r.top) * 100), 0) / 100;
    expect(String(amounts)).toBe(vectors.sheetTotals.goodsPurchase);
    expect(tops.toFixed(2)).toBe(vectors.sheetTotals.stockGrossGrams);
  });
});

describe('calculate: validation and edge cases', () => {
  it('reports missing inputs without errors', () => {
    const r = calculate({ top: '10' });
    expect(r.errors).toEqual([]);
    expect(r.missingInputs).toEqual(['down', 'price']);
    expect(r.pounds).toBe('1.29');
    expect(r.amount).toBeNull();
  });

  it('rejects zero or negative weights', () => {
    expect(calculate({ top: '10', down: '0', price: '1' }).errors[0]?.code).toBe('MUST_BE_POSITIVE');
    expect(calculate({ top: '-1', down: '1', price: '1' }).errors[0]?.code).toBe('MUST_BE_POSITIVE');
  });

  it('rejects non numeric text', () => {
    expect(calculate({ top: '1e3', down: '1', price: '1' }).errors[0]?.code).toBe('NOT_A_NUMBER');
    expect(calculate({ top: 'abc', down: '1', price: '1' }).errors[0]?.code).toBe('NOT_A_NUMBER');
  });

  it('warns when density is above pure gold', () => {
    const r = calculate({ top: '20', down: '1', price: '11650' });
    expect(r.warnings.map((w) => w.code)).toContain('DENSITY_ABOVE_PURE_GOLD');
  });

  it('returns a config error for a bad configuration', () => {
    const r = calculate({ top: '10', down: '1', price: '1' }, { ...EXCEL_V1, poundGrams: '0' });
    expect(r.errors[0]?.code).toBe('CONFIG_INVALID');
    expect(r.amount).toBeNull();
  });

  it('a different correction rate changes the karat', () => {
    const a = calculate({ top: '7.77', down: '0.41', price: '11650' });
    const b = calculate({ top: '7.77', down: '0.41', price: '11650' }, { ...EXCEL_V1, correctionRate: '0' });
    expect(Number(b.karat)).toBeGreaterThan(Number(a.karat));
  });
});
