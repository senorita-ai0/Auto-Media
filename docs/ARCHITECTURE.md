
# Auto-Media — Target Architecture

## Responsibility split

Auto-Media UI:
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

Auto-Media API:
- authentication
- CRUD
- database
- jobs
- queue orchestration
- credential references
- media management
- publishing
- n8n callbacks

PostgreSQL:
- canonical persistent state

n8n:
- RSS/API collection
- complex transformations
- AI generation
- external generation APIs
- specialized automation

## System

~~~text
React Dashboard
      |
Auto-Media API
  |         |
PostgreSQL  Media Storage
      |
     n8n
      |
Publishing Queue
  |    |    |    |
 FB   IG   YT  TikTok ...
~~~

## Reusable execution

Every generation job should carry:
- workspace_id
- profile_id
- content_type_id
- automation_id
- job_id

n8n should load configuration by IDs instead of containing page-specific values.

## Future Tech example

Schedule
-> create job
-> n8n
-> load Future Tech profile
-> load Tech News Image content type
-> fetch recent sources
-> select story
-> generate post
-> generate image prompt
-> generate image
-> brand image
-> validate
-> callback
-> review or publish
-> Facebook/Instagram jobs
-> record results

## Local Video example

Schedule
-> scan configured folder
-> select unused video
-> AI caption
-> validate
-> create destination jobs
-> publish
-> record results
-> mark media used

## Docker

Recommended services:
- automedia-web
- automedia-api
- postgres
- n8n

Optional later:
- redis/BullMQ
- object storage
- reverse proxy
- workers

Local media can be mounted into the publisher container. URL-based platforms require a compliant public media delivery mechanism.

## Design rule

Do not build page-specific code. Build reusable services plus configuration.
