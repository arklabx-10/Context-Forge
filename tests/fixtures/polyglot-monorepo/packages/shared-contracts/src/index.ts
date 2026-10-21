export interface PricingQuote {
  readonly sku: string;
  readonly unitPriceCents: number;
  readonly discountBasisPoints: number;
}
