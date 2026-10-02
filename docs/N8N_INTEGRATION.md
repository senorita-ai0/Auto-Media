
# Auto-Media — n8n Integration

## Role

Auto-Media owns configuration and state. n8n executes automation and AI workflows.

## Job invocation

Auto-Media creates an automation job and calls an n8n webhook.

Example payload:

~~~json
{
  "jobId": "job_123",
  "profileId": "future-tech",
  "contentTypeId": "tech-news-image",
  "automationId": "automation_456",
  "callbackUrl": "https://automedia.example/api/n8n/callback"
}
~~~

n8n can fetch additional configuration from Auto-Media.

## Callback

n8n calls the authenticated callback endpoint with job status, generated content and media references.

## Security

Use a dedicated integration secret. Prefer HMAC signature plus timestamp/nonce and idempotency key.

Never send database credentials to n8n.

## Universal workflow

The reusable workflow must not contain page-specific IDs, tokens or prompts. It receives IDs and loads configuration dynamically.

## Existing Future Tech workflow migration

The current flow concept:
Read Posted -> Feed List -> Read RSS -> Pick Best Story -> Build Prompt -> Write Post -> Build Image Prompt -> Generate Image Prompt -> Format Post -> Generate Image -> Brand Image -> Publish -> Log

becomes the first reusable Tech News Image workflow.

Migration:
- Google Sheet duplicate history -> PostgreSQL
- Future Tech hard-coding -> profile configuration
- fixed destination -> automation destinations
- Sheet logging -> content and publishing records
- hard-coded AI secret -> n8n credential/environment secret
- page prompt -> stored profile/content-type prompt
- final result -> Auto-Media callback

## n8n JSON import

Validation:
1. JSON syntax
2. workflow structure
3. node compatibility
4. credential requirements
5. webhook contract
6. runtime variables
7. embedded secret detection
8. test execution

## Versioning

Keep imported workflow versions. Never silently replace an active version.

## Long jobs

Use job IDs and callbacks rather than long-running HTTP requests. Polling may be a fallback.
