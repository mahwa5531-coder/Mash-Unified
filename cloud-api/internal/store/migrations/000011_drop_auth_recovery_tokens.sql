-- 0011 drop obsolete auth_recovery_tokens table
-- Email/password authentication, verification, and recovery flows were removed
-- in favor of Google OAuth/OIDC only.

DROP TABLE IF EXISTS auth_recovery_tokens CASCADE;
