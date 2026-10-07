
# Auto-Media — Publishing System

## Publisher abstraction

Each platform implements:
- validate
- prepare
- publish
- getResult

Publishers should be modular and independently testable.

## Destination independence

A single content item can have independent results:

~~~text
Facebook  published
Instagram published
TikTok    failed
YouTube   published
~~~

Overall content status can therefore be partially_published.

## Platform adaptation

Adapt caption, title, hashtags, thumbnail, aspect ratio, media format, privacy or category when required.

Keep the canonical content item separate from platform-specific variants.

## Local media

Platforms that accept direct upload may use local files.

Platforms requiring a reachable URL need a media delivery layer. Never assume a local filesystem path is public.

## Idempotency

Every publishing job gets an idempotency key. Before retrying, check stored external IDs/results to avoid duplicates.

## Retry policy

Retry transient failures with backoff. Do not automatically retry permanent authentication, validation, unsupported-media or policy failures.

## Existing publishers

Preserve working publisher implementations from the current project while migrating their configuration from the old sheet/user model to social_accounts, content_items and publishing_jobs.

Google Sheets remains optional.


## OAuth-connected accounts

Studio can establish server-side OAuth connections for YouTube/Google, LinkedIn, TikTok and Facebook/Instagram. Authorization state is stored in PostgreSQL and provider tokens are stored through the encrypted credential vault. Provider-specific scopes and app credentials remain server-side.

TikTok access tokens are short-lived; the publisher refreshes them using the stored refresh token before expiry and persists the replacement token pair. TikTok's current developer documentation states that access tokens are typically valid for 24 hours and refresh tokens for 365 days.

## Media delivery

The Studio publisher can now resolve primary media from:
1. an Auto-Media local file path,
2. a managed `MEDIA_ROOT` storage key, or
3. a public URL returned by a native/n8n workflow.

This lets n8n workflows return externally hosted media while still using the same platform adapters. URL-fetching platforms still need a publicly reachable HTTPS URL.

### Mastodon

Mastodon connections are instance-specific. Studio discovers the selected server's OAuth metadata, registers an Auto-Media OAuth application on that instance when needed, then stores the returned application credentials and user token in the encrypted workspace vault. Publishing uploads media through `POST /api/v2/media`, waits for processing, then creates the status with `POST /api/v1/statuses`.

## Account health checks

Studio can test a connected destination from the Accounts page. Successful checks keep the destination in `connected` state; provider authentication or connectivity failures change it to `error`. Disconnected accounts retain publishing history but no longer receive new publishing jobs.

Queued jobs re-check destination connectivity at publish time, so disconnecting an account prevents previously queued work from reaching that account while preserving its historical jobs.

## Bluesky

Bluesky uses the official atproto OAuth client with PKCE/DPoP/PAR handling and a server-side session store. The connected account stores its DID and encrypted OAuth session. Auto-Media publishes text, image and MP4 video posts there. Video publishing uses Bluesky's current video processing service flow: an upload job is started, the job is polled until a blob is ready, and the resulting blob is attached to the post. The adapter enforces MP4 media and the current 300 MB video limit. citeturn772491search0turn591459search0

## Telegram and Discord

Telegram destinations use Bot API credentials and a chat ID; the current Bot API documents `sendVideo` for video messages. Discord destinations use a channel webhook URL; Discord documents webhooks as channel-scoped message senders. citeturn618357search4turn618357search3

## Provider sandbox testing

Set `metadata_json.integrationTest=true` on dedicated sandbox accounts, or pass their IDs through `AUTOMEDIA_E2E_ACCOUNT_IDS`. The safe suite performs account health checks only. Real publishing is disabled by default.

For a dedicated CI sandbox environment, configure:
- `E2E_DATABASE_URL`
- `E2E_CREDENTIALS_MASTER_KEY`
- `E2E_PUBLIC_BASE_URL`
- `E2E_ACCOUNT_IDS`

Then set repository variable `AUTOMEDIA_E2E_ENABLED=true` and optionally `AUTOMEDIA_E2E_PLATFORMS`. The gated CI job runs `npm run test:provider-sandbox` with `AUTOMEDIA_E2E_PUBLISH=true`. Use only disposable/test accounts because this mode performs real provider publishing.