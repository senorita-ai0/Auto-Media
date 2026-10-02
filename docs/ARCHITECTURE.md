# Auto-Media — Target Architecture

## Product model

Auto-Media is the complete social-media management and content automation platform.

n8n is an **optional automation extension**, not a required dependency.

The normal built-in engine handles common content generation and publishing. n8n is available for advanced/custom workflows.

## Responsibility split

### Auto-Media UI
- profiles
- accounts
- content types
- automations
- schedules
- content library
- review
- publishing queue
- workflows
- logs

### Auto-Media API
- authentication
- CRUD
- database
- jobs
- queue orchestration
- credential references
- media management
- AI provider calls
- publishing
- optional n8n bridge

### PostgreSQL
Canonical persistent state.

### Built-in engine
Handles normal:
- AI text generation
- AI structured output
- AI image generation
- local media selection
- media processing
- scheduling
- publishing

### n8n
Optional:
- custom multi-step workflows
- unusual integrations
- external automation
- user-imported n8n workflows
- tasks that are easier to author visually in n8n

## System

~~~text
                     Auto-Media
                         |
              +----------+----------+
              |                     |
        Built-in Engine        Optional n8n
              |                     |
              +----------+----------+
                         |
                   Content / Jobs
                         |
                  Publishing Queue
                  /      |                        FB      IG      YT/TikTok...
~~~

## Docker deployment

All services can live on the same machine under one Docker Compose project.

Recommended containers:
- automedia-web
- automedia-api
- postgres

Optional:
- n8n
- redis/BullMQ
- object storage
- reverse proxy

Docker internal networking allows services to communicate by service name.

The app must remain functional when n8n is disabled or not installed, except for automations explicitly configured to use n8n.

## Reusable execution

Every automation is configuration:
- profile
- content type
- source
- generation mode
- schedule
- approval
- destinations

A content generation job should carry:
- workspace_id
- profile_id
- content_type_id
- automation_id
- job_id

## Future Tech example without n8n

Schedule
-> fetch recent sources
-> select story
-> compose Future Tech master prompt
-> generate original post
-> generate image prompt
-> generate image
-> brand image
-> validate
-> review/approve
-> publish to Facebook + Instagram

## Future Tech example with n8n

The same profile can have a second custom automation:
Schedule
-> n8n custom workflow
-> callback
-> Auto-Media content item
-> publish

## Local Video example

Schedule
-> scan configured folder
-> select unused video
-> AI caption
-> validate
-> publishing jobs
-> publish
-> record results
-> mark media used

## Design rule

Do not build page-specific code.

Build reusable content types, engines, adapters and configuration.


### Durable generation execution

Scheduled automations enqueue durable `generation_jobs` in PostgreSQL. A background generation worker claims due jobs atomically, records `automation_runs`, retries transient generation failures with bounded backoff, and hands approved results to the publishing queue. This keeps AI execution independent of the browser and separate from schedule calculation.

## Shared AI providers

AI credentials are workspace-scoped encrypted resources. A profile contributes identity and its master prompt; an automation selects a content type, schedule, destinations, and optionally an `aiProviderId`. Native generation resolves that provider at execution time. When no provider is selected, the first enabled workspace provider is used; legacy `AI_*` environment variables remain a fallback.

n8n workflows use Auto-Media's token-bound AI proxy for supported templates. The n8n runtime receives a per-execution callback token, not the long-lived AI or n8n shared secret.


## Quick Setup

The Setup page creates complete starter configurations atomically:
- Future Tech: profile + Tech News Image + scheduled RSS automation.
- Viral Videos: profile + Local Video + scheduled local-folder automation.

After creation, destinations and other settings remain editable in their normal Studio screens.


## Media Library

Workspace media can be uploaded through Studio to local storage or S3/MinIO. Uploaded images/videos are represented as `media_assets` and can be filtered by profile. Local Video automations may select from the Media Library or from a mounted Docker folder; both paths produce the same `content_items` and publishing jobs.

## Publishing analytics

Studio analytics are derived from Auto-Media's own publishing job history and grouped per destination platform, profile, and content type. They report total/published/pending/failed jobs and recent publishing activity. External reach, likes, comments, followers, impressions, and other platform-native engagement metrics require separate platform analytics APIs and are intentionally not inferred from publishing history.


## Engagement snapshots

Auto-Media periodically fetches provider-native account metrics where the connected OAuth grant exposes them. Snapshots are stored per account/day so temporary provider failures do not erase prior history. Analytics UI separates these external metrics from internal publishing-job metrics.

Not every platform exposes the same metrics or permissions. An account can therefore show partial metrics or require reconnecting with expanded OAuth scopes.