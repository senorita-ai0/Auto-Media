# Auto-Media — External Engagement Analytics

## What is stored

Every published Studio publishing job can have one daily publishing_metric_snapshots row. The snapshot keeps platform metrics separate from publishing state, so a post can be published successfully even when analytics access is unavailable.

Common normalized fields: views, impressions, reach, likes, comments, shares, reactions, saves, clicks, engagement.

## Supported post-level adapters

### Facebook
Uses the published post/video ID with Graph API object fields and post insights. Available metrics depend on the object and account permissions.

### Instagram
Uses the published media ID plus the Instagram media insights endpoint. The implementation requests views, reach, likes, comments, saved, shares, and total_interactions, then falls back to base media like/comment counts when insights are unavailable for a media type.

### YouTube
Uses the published video ID with the YouTube Data API videos.list statistics response for basic public video counts. Additional YouTube Analytics reporting can be added separately.

### TikTok
Uses /v2/video/query/ with the published video ID and requests like_count, comment_count, share_count, and view_count. The current TikTok API documentation lists these fields and requires video.list for this endpoint.

### LinkedIn
Uses memberCreatorPostAnalytics with the published member post URN. The adapter requests lifetime IMPRESSION, MEMBERS_REACHED, RESHARE, REACTION, and COMMENT totals. LinkedIn documents r_member_postAnalytics for member post reporting.

### Pinterest
Uses Pin metadata with pin_metrics=true for the published Pin ID. Pinterest also exposes dedicated organic Pin analytics endpoints; availability depends on account/API access.

## Background sync

The engagement scheduler refreshes account metrics every six hours, finds published Studio jobs without a successful snapshot for the current day, fetches provider metrics, upserts the daily snapshot, and records provider errors without replacing earlier successful snapshots.

The Studio Engagement page also supports manual sync.

## Access behavior

Analytics permission failures are never converted into zero values. Auto-Media preserves the error message in the snapshot so the operator knows that analytics access or re-authorization is required.

Existing OAuth connections do not automatically gain newly added scopes; re-authorize the account when a provider requires an additional analytics permission.

## API

- GET /api/studio/engagement — latest account-level metrics
- POST /api/studio/engagement/sync — refresh account-level metrics
- GET /api/studio/engagement/posts — latest per-publishing-job metrics
- GET /api/studio/engagement/posts?contentId=<uuid> — latest metrics for one content item
- POST /api/studio/engagement/posts/sync — manually refresh published post metrics