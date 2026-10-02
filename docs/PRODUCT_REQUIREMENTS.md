# Auto-Media — Product Requirements

## Vision

Auto-Media is a self-hosted multi-page social media content automation platform.

Core principle: **Page = configuration. Content Type = reusable logic. Automation = connection between them.**

A single installation must support many brands/pages with different content strategies.

## n8n dependency

**n8n is optional.**

Normal content generation and publishing must work with built-in Auto-Media services. n8n is only required for automations explicitly configured to run through n8n.

## Brand/Page Profile

A profile represents a content identity such as Future Tech or Viral Videos.

Fields:
- name, slug, description
- niche/topic
- language
- timezone
- tone
- audience
- master/initial prompt
- disclaimer
- hashtag rules
- visual identity
- logo/brand assets
- enabled content types
- destinations
- schedules

## AI profile behavior

Every profile may define a natural-language master prompt.

Example:
Future Tech master prompt = instructions that describe exactly what the page should publish, how it should sound, what topics to cover, what to avoid, and formatting preferences.

That prompt is reused across all compatible automations for the profile.

## Content Types

Reusable recipes such as:
- Tech News Image
- Tech News Text
- Local Video
- AI Video
- Quote Image
- Product Update
- News Reel
- Carousel
- Announcement
- Custom Workflow

## Automations

An automation connects:
Profile + Content Type + Source + Generation + Schedule + Approval + Destinations.

No separate workflow should be required for each page.

## AI providers

Support a shared provider abstraction so multiple pages can use the same AI provider/model while giving each page different prompts.

## Local videos

Support local folders, unused-media tracking, selection rules and AI caption generation.

## Image updates

Support AI-generated or template-generated recurring images with branding.

## Publishing

One content item can produce multiple destination-specific publishing jobs.

## n8n

If an automation is configured as Native, it uses Auto-Media directly.

If configured as n8n, Auto-Media dispatches to the selected n8n workflow.

The rest of the lifecycle remains the same.

## ChatGPT n8n workflow import

Advanced users can:
- describe a workflow to ChatGPT
- receive n8n JSON
- paste/upload it
- validate it
- map credentials
- test it
- save/version it
- activate it

## Security

Secrets never belong in source, prompts or workflow JSON.

## Success criterion

Create two pages with different prompts, content types, media sources and destinations and run them through the same Auto-Media installation. Neither should require a page-specific code path.
