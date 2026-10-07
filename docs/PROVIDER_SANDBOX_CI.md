# Provider Sandbox CI

Auto-Media has two provider-sandbox modes.

## Health-only

The normal CI build runs npm run test:provider-sandbox with AUTOMEDIA_E2E_PUBLISH=false. It uses accounts explicitly listed in AUTOMEDIA_E2E_ACCOUNT_IDS, or all database accounts whose metadata_json.integrationTest is true.

With strict mode disabled, the suite safely skips when the E2E database is unavailable or no sandbox accounts are configured.

## Real publish gate

The optional provider-sandbox-publish GitHub Actions job runs only when repository variable AUTOMEDIA_E2E_ENABLED is true.

It sets AUTOMEDIA_E2E_PUBLISH=true and AUTOMEDIA_E2E_STRICT=true.

Strict mode is fail-closed. It requires an E2E database, requires at least one configured sandbox account, refuses a platform filter that would skip configured accounts, health-checks every selected account, and publish-tests every supported selected account.

Required GitHub secrets:

- E2E_DATABASE_URL
- E2E_CREDENTIALS_MASTER_KEY
- E2E_PUBLIC_BASE_URL
- E2E_ACCOUNT_IDS (optional when the E2E database marks all sandbox accounts with metadata_json.integrationTest=true)

The sandbox database should contain only disposable provider accounts. Real publish mode creates isolated test profiles/automations and publishes a clearly marked integration-test fixture; external test posts are not automatically deleted by Auto-Media.