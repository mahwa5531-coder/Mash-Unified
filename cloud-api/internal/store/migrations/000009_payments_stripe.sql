-- 0009 Stripe PaymentIntents: the browser handle column.
--
-- Stripe's PaymentIntent is both the provider order and the payment; the
-- client_secret it returns is PUBLIC BY DESIGN (needed by Stripe.js) and
-- is relayed to clients by the checkout response. Razorpay rows keep ''
-- (their flow needs no client secret — Checkout.js uses key_id + order).

ALTER TABLE payment_orders
    ADD COLUMN IF NOT EXISTS provider_client_secret TEXT NOT NULL DEFAULT '';
