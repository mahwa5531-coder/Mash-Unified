-- 0010 PhonePe Standard Checkout: the hosted PAY_PAGE handle column.
--
-- PhonePe PG v1 returns a redirect URL (the hosted payment page); the
-- browser is sent there wholesale. It is PUBLIC BY DESIGN and is relayed
-- to clients as redirect_url by the checkout response. Other providers
-- keep ''.

ALTER TABLE payment_orders
    ADD COLUMN IF NOT EXISTS provider_checkout_url TEXT NOT NULL DEFAULT '';
