// Plain-words descriptions shown beside payroll form fields (the (i) button, `FieldHint`). One place, so the wording stays consistent.
// Say what the box is for and what to type, in a sentence or two.

export const PAYROLL_HINTS = {
  // Settings
  settingsStartsOn: "The first day these settings apply. A pay run uses the version that was in force on the run's first day. Older versions stay on record, so past runs never change.",
  settingsDivisor:
    "Turns a monthly rate into a daily rate: daily rate = monthly rate ÷ (2 × this number). The hourly rate is the daily rate ÷ the person's hours per day. The usual number is 11.",
  settingsWarn:
    "On a run, a person whose total payable compensation moved by more than this percent from their last run is flagged for a second look. It only warns; nothing is blocked.",
  settingsOt:
    "The company standard overtime (OT) rate, used for every pay line that doesn't set its own. 125 means 1.25 times the person's own hourly rate. Leave a box blank to use the built-in standard. A single person can have a different percent on their pay line (Rates tab).",
  settingsReason: "Why you are changing the settings. Kept in the change history, never in notices.",

  // Pay lines (Rates)
  lineStartsOn: "The first pay run this counts for. Pick the cutoff being prepared unless the change should wait for a later one. Pay runs that are already made are never changed.",
  linePerson: "Who is paid by this line. Someone who works for two clients has two lines.",
  lineClient: "The client this person works for on this line. It is printed on their statement. Optional.",
  lineAlias: "A short label, such as the role or account name, that tells two lines of the same person apart. Printed on their statement. Optional.",
  lineHours: "How many hours are in this person's normal workday (1 to 12). The hourly rate is the daily rate ÷ this number. It is used for overtime, late time and part days.",
  lineMonthly: "The person's full monthly rate in pesos. Each cutoff pays half of it.",
  lineMethod: "How this person is paid. Remitly lines appear on the Remitly payment list.",
  lineOt:
    "This person's own overtime (OT) percent of their hourly rate, for when it differs from the company standard. 125 means 1.25 times. Leave a box blank to use the standard from Settings.",
  lineOtRegular: "OT on a normal working day, as a percent of the hourly rate.",
  lineOtRestDay: "OT on a rest day, as a percent of the hourly rate (up to 8 hours).",
  lineOtRestDayOver8: "OT on a rest day beyond 8 hours, as a percent of the hourly rate.",
  lineReason: "Why the rate is changing. Kept in the change history, never in notices.",
  lineLastDay: "The last cutoff this person is paid for. They are paid for all of it; pay runs after it leave this rate out.",

  // New run
  runFirstDay: "The first day the pay run covers. A real run is exactly one cutoff: the 1st to the 15th, or the 16th to the end of the month.",
  runLastDay: "The last day the pay run covers.",
  runTest:
    "A practice run. It may repeat a period that already has a run, can cover any dates up to 31 days, is stamped TEST, never reaches anyone's statements, and shows masked bank details. Use it to rehearse a past cycle.",

  // Amounts on a run line
  itemType: "What kind of amount you are adding to this person's pay for the period, such as overtime, an allowance, a bonus or a loan payment.",
  itemName: "A name for this amount. It is printed on the statement, for example Health allowance.",
  itemValue: "The amount or time to add. Money is in pesos. Time is in hours and minutes. Days are in days.",
  itemCorrects: "Pick the earlier amount this one replaces, so the statement shows one corrected line.",
  itemReason: "Why you are entering or changing this amount. Kept in the change history, never in notices.",

  // Payments
  paymentReference: "The reference number from Remitly for this payment.",
  paymentPaidOn: "The day the money was sent.",
} as const;
