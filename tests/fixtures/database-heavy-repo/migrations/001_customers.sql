CREATE TABLE customers (
    customer_id UUID PRIMARY KEY,
    email VARCHAR(255) NOT NULL UNIQUE,
    status VARCHAR(32) NOT NULL DEFAULT 'active',
    created_at TIMESTAMP NOT NULL
);

CREATE TABLE customer_wallets (
    wallet_id UUID PRIMARY KEY,
    customer_id UUID NOT NULL REFERENCES customers(customer_id),
    currency_code CHAR(3) NOT NULL,
    balance_cents BIGINT NOT NULL DEFAULT 0
);
