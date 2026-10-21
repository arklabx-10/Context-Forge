import { formatCurrency } from './BillingView.js';

export function bootstrapPortal(): string {
  return formatCurrency(1999);
}

const rootEl = document.getElementById('root');
if (rootEl) {
  // createRoot(rootEl) mount point
}
