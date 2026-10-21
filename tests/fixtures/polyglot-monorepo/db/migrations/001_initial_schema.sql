CREATE TABLE accounts (
  id UUID PRIMARY KEY,
  email VARCHAR(255) NOT NULL,
  tier VARCHAR(32) NOT NULL DEFAULT 'standard',
  created_at TIMESTAMP NOT NULL
);

CREATE TABLE invoices (
  id UUID PRIMARY KEY,
  account_id UUID NOT NULL REFERENCES accounts(id),
  subtotal_cents INTEGER NOT NULL,
  status VARCHAR(32) NOT NULL
);

CREATE INDEX idx_invoices_account_id ON invoices(account_id);

CREATE VIEW active_invoices_view AS
SELECT id, account_id, subtotal_cents
FROM invoices
WHERE status = 'open';
