// Shared UI types, constants and small presentational components used across workspace views.
import type { CertaintyLevel } from '../domain/index.js';

export type WorkspaceViewId =
  | 'dashboard'
  | 'onboarding'
  | 'explorer'
  | 'stack_profile'
  | 'architecture'
  | 'search'
  | 'analysis_status'
  | 'context_builder'
  | 'knowledge'
  | 'change_review'
  | 'settings';

export const NAV_ITEMS: readonly {
  readonly id: WorkspaceViewId;
  readonly label: string;
  readonly shortcut: string;
}[] = [
  { id: 'dashboard', label: '1. Projects & Overview', shortcut: 'Alt+1' },
  { id: 'onboarding', label: '2. Add / Import Repository', shortcut: 'Alt+2' },
  { id: 'explorer', label: '3. File & Module Explorer', shortcut: 'Alt+3' },
  { id: 'stack_profile', label: '4. Languages, Manifests & Build', shortcut: 'Alt+4' },
  { id: 'architecture', label: '5. Architecture & Dependencies', shortcut: 'Alt+5' },
  { id: 'search', label: '6. Search Indexed Project', shortcut: 'Alt+6' },
  { id: 'analysis_status', label: '7. Status, Warnings & Unknowns', shortcut: 'Alt+7' },
  { id: 'context_builder', label: '8. Context Pack Builder', shortcut: 'Alt+8' },
  { id: 'knowledge', label: '9. Knowledge & ADRs', shortcut: 'Alt+9' },
  { id: 'change_review', label: '10. Git Change Review', shortcut: 'Alt+0' },
  { id: 'settings', label: '11. Settings & Exclusions', shortcut: 'Alt+-' },
];

export const DEFAULT_FILE_WINDOW_LINES = 200;

export const SAMPLE_RISKY_DIFF = [
  'diff --git a/apps/web-portal/src/BillingView.tsx b/apps/web-portal/src/BillingView.tsx',
  'index 1111111..2222222 100644',
  '--- a/apps/web-portal/src/BillingView.tsx',
  '+++ b/apps/web-portal/src/BillingView.tsx',
  '@@ -5,3 +5,4 @@ export interface InvoiceSummary {',
  '-export function formatCurrency(amountCents: number): string {',
  '+export function formatCurrency(amountCents: number, currencySymbol = "$"): string {',
  '+  // Modified currency signature without updating dependent main.tsx or unit tests',
  '   return `${currencySymbol}${(amountCents / 100).toFixed(2)}`;',
  'diff --git a/db/migrations/001_initial_schema.sql b/db/migrations/001_initial_schema.sql',
  'index 3333333..4444444 100644',
  '--- a/db/migrations/001_initial_schema.sql',
  '+++ b/db/migrations/001_initial_schema.sql',
  '@@ -18,2 +18,5 @@ SELECT id, account_id, subtotal_cents',
  ' FROM invoices',
  " WHERE status = 'open';",
  '+ALTER TABLE accounts ADD COLUMN tax_id VARCHAR(64) NOT NULL;',
  '+DROP TABLE invoices;',
  '+DELETE FROM accounts;',
].join('\n');

export function CertaintyBadge({ level }: { readonly level: CertaintyLevel }) {
  return <span className={`badge badge-${level}`}>{level.replace('_', ' ')}</span>;
}
