
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