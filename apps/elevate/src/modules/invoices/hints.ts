// Plain-words descriptions shown beside invoice form fields (the (i) button, `FieldHint`).

export const INVOICE_HINTS = {
  invoiceRun: "The approved pay run whose hours the invoice bills. A test run makes a test invoice, numbered TEST- and stamped TEST.",
  invoiceClient: "The client to bill. The invoice lists only the people who worked for this client in the pay run's period.",
  rateClient: "The client this billing rate is for.",
  ratePerson: "The person this rate is for. It beats the client's standard rate for them only; everyone else stays on the standard rate.",
  rateStartsOn: "The first day this rate can be used. An invoice uses the newest rate that started on or before the day it is made, so earlier invoices keep their rate.",
  rateAmount: "What the client is billed per hour worked, in US dollars. Invoices are in dollars; payroll is in pesos.",
  reason: "Why the invoice is being voided, archived or replaced. Kept with the invoice's record.",
} as const;
