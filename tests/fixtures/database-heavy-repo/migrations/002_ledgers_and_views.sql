CREATE TABLE ledger_entries (
    entry_id UUID PRIMARY KEY,
    wallet_id UUID NOT NULL REFERENCES customer_wallets(wallet_id),
    delta_cents BIGINT NOT NULL,
    recorded_at TIMESTAMP NOT NULL
);

CREATE VIEW active_customer_balances AS
SELECT c.customer_id, c.email, w.wallet_id, w.balance_cents
FROM customers c
JOIN customer_wallets w ON w.customer_id = c.customer_id
WHERE c.status = 'active';

CREATE PROCEDURE reconcile_wallet_balance(target_wallet UUID)
LANGUAGE SQL
AS $$
UPDATE customer_wallets
SET balance_cents = COALESCE((
    SELECT SUM(delta_cents) FROM ledger_entries WHERE wallet_id = target_wallet
), 0)
WHERE wallet_id = target_wallet;
$$;
