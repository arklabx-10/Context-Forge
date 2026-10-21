export interface InvoiceSummary {
  readonly invoiceId: string;
  readonly amountCents: number;
}

export function formatCurrency(amountCents: number): string {
  return `$${(amountCents / 100).toFixed(2)}`;
}
