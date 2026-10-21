import Decimal from 'decimal.js';

/**
 * ExcelV1 calculation engine.
 *
 * Reproduces the owner's Excel sheet step by step. Every step truncates (ROUNDDOWN), in the same
 * order as the sheet, using exact decimal arithmetic instead of floating point.
 *
 * Where a step divides, the division is done once at the end of the expression
 * (for example (price x karat x pounds) / 23 rather than (price / 23) x karat x pounds). The result
 * is mathematically identical to the sheet, but it avoids truncating a repeating decimal early,
 * which could turn an exact whole number into one cedi less.
 */

const D = Decimal.clone({ precision: 60, rounding: Decimal.ROUND_DOWN });
type Dec = InstanceType<typeof D>;

export type NumericInput = string | number | null | undefined;

export interface CalcConfig {
  formulaVersion: 'ExcelV1';
  /** Proportional reduction applied to the density-based karat estimate (0.007 = 0.7%). */
  correctionRate: string;
  /** Grams in one gold pound. */
  poundGrams: string;
  /** Reference karat of the GoldBod pound price. */
  priceReferenceKarat: string;
  densityOffset: string;
  densityScale: string;
}

export const EXCEL_V1: CalcConfig = {
  formulaVersion: 'ExcelV1',
  correctionRate: '0.007',
  poundGrams: '7.75',
  priceReferenceKarat: '23',
  densityOffset: '10.51',
  densityScale: '52.838',
};

export type IssueField = 'top' | 'down' | 'price' | 'density' | 'karat' | 'config';

export interface CalcIssue {
  field: IssueField;
  code: string;
  message: string;
}

export interface CalcInput {
  /** Weight on the scale, in air. */
  top?: NumericInput;
  /** Weight in water. */
  down?: NumericInput;
  /** GHS per pound (GoldBod base plus margin). */
  price?: NumericInput;
}

export interface CalcResult {
  formulaVersion: string;
  density: string | null;
  baseKarat: string | null;
  karat: string | null;
  /** Fraction, for example "0.9733" for 97.33%. */
  purity: string | null;
  netWeight: string | null;
  pounds: string | null;
  /** Whole cedis. */
  amount: string | null;
  /** Inputs that are empty so far. Not an error: the screen is simply incomplete. */
  missingInputs: Array<'top' | 'down' | 'price'>;
  errors: CalcIssue[];
  warnings: CalcIssue[];
}

/** Pure gold is about 19.3 g/cm3; a density above this suggests a weighing mistake. */
const DENSITY_WARNING_ABOVE = '19.32';

const PLAIN_NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)$/;

const trunc = (x: Dec, dp: number): Dec => x.toDecimalPlaces(dp, D.ROUND_DOWN);

function parseInput(
  value: NumericInput,
  field: 'top' | 'down' | 'price',
  rule: 'positive' | 'nonNegative',
  errors: CalcIssue[],
): Dec | null {
  if (value === null || value === undefined) return null;

  let parsed: Dec;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      errors.push({ field, code: 'NOT_A_NUMBER', message: `${field} must be a number.` });
      return null;
    }
    parsed = new D(value);
  } else {
    const text = value.trim();
    if (text === '') return null;
    if (!PLAIN_NUMBER.test(text)) {
      errors.push({ field, code: 'NOT_A_NUMBER', message: `${field} must be a plain number.` });
      return null;
    }
    parsed = new D(text);
  }

  if (rule === 'positive' && !parsed.gt(0)) {
    errors.push({ field, code: 'MUST_BE_POSITIVE', message: `${field} must be greater than zero.` });
    return null;
  }
  if (rule === 'nonNegative' && parsed.lt(0)) {
    errors.push({ field, code: 'MUST_BE_NON_NEGATIVE', message: `${field} cannot be negative.` });
    return null;
  }
  return parsed;
}

export function validateConfig(config: CalcConfig): CalcIssue[] {
  const issues: CalcIssue[] = [];
  const need = (name: keyof CalcConfig, ok: (d: Dec) => boolean, message: string) => {
    const raw = config[name];
    let d: Dec | null = null;
    try {
      d = new D(String(raw));
    } catch {
      d = null;
    }
    if (d === null || !d.isFinite() || !ok(d)) {
      issues.push({ field: 'config', code: 'CONFIG_INVALID', message: `${String(name)}: ${message}` });
    }
  };
  need('correctionRate', (d) => d.gte(0) && d.lt(1), 'must be at least 0 and below 1.');
  need('poundGrams', (d) => d.gt(0), 'must be greater than zero.');
  need('priceReferenceKarat', (d) => d.gt(0) && d.lte(24), 'must be above 0 and at most 24.');
  need('densityOffset', (d) => d.gte(0), 'cannot be negative.');
  need('densityScale', (d) => d.gt(0), 'must be greater than zero.');
  return issues;
}

export function calculate(input: CalcInput, config: CalcConfig = EXCEL_V1): CalcResult {
  const result: CalcResult = {
    formulaVersion: config.formulaVersion,
    density: null,
    baseKarat: null,
    karat: null,
    purity: null,
    netWeight: null,
    pounds: null,
    amount: null,
    missingInputs: [],
    errors: [],
    warnings: [],
  };

  const configIssues = validateConfig(config);
  if (configIssues.length > 0) {
    result.errors.push(...configIssues);
    return result;
  }

  const top = parseInput(input.top, 'top', 'positive', result.errors);
  const down = parseInput(input.down, 'down', 'positive', result.errors);
  const price = parseInput(input.price, 'price', 'nonNegative', result.errors);

  const isEmpty = (v: NumericInput) => v === null || v === undefined || (typeof v === 'string' && v.trim() === '');
  if (isEmpty(input.top)) result.missingInputs.push('top');
  if (isEmpty(input.down)) result.missingInputs.push('down');
  if (isEmpty(input.price)) result.missingInputs.push('price');

  const q = new D(config.correctionRate);
  const poundGrams = new D(config.poundGrams);
  const refKarat = new D(config.priceReferenceKarat);
  const offset = new D(config.densityOffset);
  const scale = new D(config.densityScale);

  // Pounds needs only Top.
  let pounds: Dec | null = null;
  if (top) {
    pounds = trunc(top.div(poundGrams), 2);
    result.pounds = pounds.toFixed(2);
  }

  // Density needs Top and Down.
  let density: Dec | null = null;
  if (top && down) {
    density = trunc(top.div(down), 2);
    result.density = density.toFixed(2);
    if (density.gt(DENSITY_WARNING_ABOVE)) {
      result.warnings.push({
        field: 'density',
        code: 'DENSITY_ABOVE_PURE_GOLD',
        message: 'Density is above that of pure gold (about 19.3). Check both weights.',
      });
    }
    if (density.isZero()) {
      result.errors.push({ field: 'density', code: 'DENSITY_ZERO', message: 'Density rounds to zero. Check both weights.' });
      density = null;
    }
  }

  // Karat estimate.
  let karat: Dec | null = null;
  if (density) {
    const base = trunc(density.minus(offset).mul(scale).div(density), 2);
    result.baseKarat = base.toFixed(2);
    karat = trunc(base.mul(new D(1).minus(q)), 2);
    result.karat = karat.toFixed(2);
    if (karat.lte(0) || karat.gt(24)) {
      result.warnings.push({
        field: 'karat',
        code: 'KARAT_OUT_OF_RANGE',
        message: 'Estimated karat is outside 0 to 24. Check both weights.',
      });
    }
  }

  // Purity and net weight.
  if (karat && top) {
    const purity = trunc(karat.div(24), 4);
    result.purity = purity.toFixed(4);
    result.netWeight = trunc(purity.mul(top), 2).toFixed(2);
  }

  // Amount needs Price, Karat and Pounds.
  if (price && karat && pounds) {
    result.amount = trunc(price.mul(karat).mul(pounds).div(refKarat), 0).toFixed(0);
  } else if (price !== null && karat && pounds && price.isZero()) {
    result.amount = '0';
  }

  return result;
}
