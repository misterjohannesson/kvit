import { describe, expect, it } from 'vitest';
import { presetRange } from '../../src/lib/periods';

describe('Kontoudtog presets', () => {
  it('computes month, quarter and year windows from a given day', () => {
    expect(presetRange('this_month', '2026-09-09')).toEqual({ from: '2026-09-01', to: '2026-09-30' });
    expect(presetRange('last_month', '2026-09-09')).toEqual({ from: '2026-08-01', to: '2026-08-31' });
    expect(presetRange('this_quarter', '2026-09-09')).toEqual({ from: '2026-07-01', to: '2026-09-30' });
    expect(presetRange('last_quarter', '2026-09-09')).toEqual({ from: '2026-04-01', to: '2026-06-30' });
    expect(presetRange('this_year', '2026-09-09')).toEqual({ from: '2026-01-01', to: '2026-12-31' });
  });

  it('crosses year boundaries', () => {
    expect(presetRange('last_month', '2027-01-15')).toEqual({ from: '2026-12-01', to: '2026-12-31' });
    expect(presetRange('last_quarter', '2027-02-01')).toEqual({ from: '2026-10-01', to: '2026-12-31' });
    expect(presetRange('this_month', '2028-02-10')).toEqual({ from: '2028-02-01', to: '2028-02-29' });
  });
});
