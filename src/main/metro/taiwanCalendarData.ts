/**
 * The official office calendar's exceptions to "Saturday and Sunday off": 行政院人事行政總處
 * 「中華民國政府行政機關辦公日曆表」, data.gov.tw dataset 14718 (A58000000A-000166), the CSV
 * resources "115年中華民國政府行政機關辦公日曆表" (dgpa.gov.tw/FileConversion?filename=dgpa/files/
 * 202506/a52331bd-a189-466b-b0f0-cae3062bbf74.csv) and "116年中華民國政府行政機關辦公日曆表"
 * (dgpa.gov.tw/FileConversion?filename=dgpa/files/202607/f538b1ff-ba60-4c63-9477-10db8e6612d1.csv),
 * fetched 2026-10-22 (dataset modified 2026-07-15). A row is a weekday the CSV marks 是否放假 = 2
 * ('off') or a Saturday/Sunday it marks 0 ('work'); neither year has a make-up workday. The
 * release self-test re-reads the CSVs and fails when they differ or when
 * the next year is published but not bundled.
 */

export const CALENDAR_DATA_YEARS = [2026, 2027] as const;

export const CALENDAR_DATA: readonly (readonly [string, 'off' | 'work'])[] = [
  // 2026 (115年)
  ['2026-01-01', 'off'], // Founding Day
  ['2026-02-16', 'off'], // Lunar New Year's Eve
  ['2026-02-17', 'off'], // Lunar New Year
  ['2026-02-18', 'off'], // Lunar New Year
  ['2026-02-19', 'off'], // Lunar New Year
  ['2026-02-20', 'off'], // make-up day (Lunar New Year)
  ['2026-02-27', 'off'], // make-up day (Peace Memorial Day, Sat 02-28)
  ['2026-04-03', 'off'], // make-up day (Children's Day, Sat 04-04)
  ['2026-04-06', 'off'], // make-up day (Tomb Sweeping Day, Sun 04-05)
  ['2026-05-01', 'off'], // Labour Day
  ['2026-06-19', 'off'], // Dragon Boat Festival
  ['2026-09-25', 'off'], // Mid-Autumn Festival
  ['2026-09-28', 'off'], // Teachers' Day
  ['2026-10-09', 'off'], // make-up day (National Day, Sat 10-10)
  ['2026-10-26', 'off'], // make-up day (Retrocession Day, Sun 10-25)
  ['2026-12-25', 'off'], // Constitution Day
  // 2027 (116年)
  ['2027-01-01', 'off'], // Founding Day
  ['2027-02-04', 'off'], // the day before Lunar New Year's Eve
  ['2027-02-05', 'off'], // Lunar New Year's Eve
  ['2027-02-08', 'off'], // Lunar New Year
  ['2027-02-09', 'off'], // make-up day (Lunar New Year)
  ['2027-02-10', 'off'], // make-up day (Lunar New Year)
  ['2027-03-01', 'off'], // make-up day (Peace Memorial Day, Sun 02-28)
  ['2027-04-05', 'off'], // Tomb Sweeping Day
  ['2027-04-06', 'off'], // make-up day (Children's Day, Sun 04-04)
  ['2027-04-30', 'off'], // make-up day (Labour Day, Sat 05-01)
  ['2027-06-09', 'off'], // Dragon Boat Festival
  ['2027-09-15', 'off'], // Mid-Autumn Festival
  ['2027-09-28', 'off'], // Teachers' Day
  ['2027-10-11', 'off'], // make-up day (National Day, Sun 10-10)
  ['2027-10-25', 'off'], // Retrocession Day
  ['2027-12-24', 'off'], // make-up day (Constitution Day, Sat 12-25)
  ['2027-12-31', 'off'], // make-up day (Founding Day 2028, Sat 01-01)
];
