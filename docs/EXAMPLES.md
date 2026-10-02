# Auto-Media — Example Configurations

## Future Tech

### Profile
Name: Future Tech
Niche: Technology news
Language: English
Tone: Simple, modern, factual and engaging

Master prompt:
Create original technology content for the Future Tech page. Focus on current AI, Apple, Android, gadgets, software, gaming, startups and security news. Explain what happened in simple language for a general audience. Never copy source wording. Never invent facts. Keep the writing natural and useful, not clickbait-heavy. End posts with a concise question when appropriate.

Disclaimer:
Disclaimer: This content is for informational purposes only. Image is AI generated and just for reference.

### Content type
Tech News Image
Generation: AI text + AI image
Instructions:
- Select a recent technology story.
- Use the source headline, summary and available article excerpt as factual context.
- Write an original post.
- Generate a visual direction based on the actual story.
- Keep the image free from fake UI text, fake quotes and invented numbers.

### Automation
Schedule: Every 6 hours
Source: RSS feed URLs configured in the automation.
Approval: Review before publish
Destinations: Future Tech Facebook Page, Future Tech Instagram

## Viral Videos

### Profile
Name: Viral Videos
Niche: Short-form viral video
Language: English
Tone: Natural, energetic and concise

Master prompt:
Create short social captions for viral videos. Keep captions natural, easy to understand and appropriate for the selected platform. Do not invent details about what happens in the video. Avoid misleading claims. Use hashtags only when relevant.

### Content type
Local Video
Generation: Local media + AI caption

### Automation
Source folder: videos/viral
Selection: Oldest unused video
Schedule: 3 times per day
Approval: Auto publish or review
Destinations: Viral Videos Facebook Page, Viral Videos Instagram, Viral Videos TikTok

## Custom n8n automation
Use Custom Workflow when the automation is not covered by the built-in engine.
Auto-Media sends profileId, contentTypeId, automationId and jobId.
n8n returns normalized content and media references.

## Important rule
These examples are configurations, not separate workflows. Future Tech and Viral Videos use the same application services.