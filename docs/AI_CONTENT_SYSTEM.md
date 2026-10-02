
# Auto-Media — AI Content System

## Goal

Use shared AI infrastructure while allowing every profile to define its own content behavior.

## Prompt hierarchy

1. Global rules
2. Profile master/initial prompt
3. Content type prompt
4. Automation instructions
5. Source/context data
6. Platform adaptation rules

## Example

Profile: Future Tech

Master prompt:
Create original, easy-to-understand technology news content. Focus on useful facts and avoid copying source wording. Use a modern, engaging but factual tone.

Content type: Tech News Image

Content prompt:
Write a short social post about the selected story and create an image direction representing the story.

Automation:
Every 6 hours, configured technology sources, Facebook + Instagram.

The same content type can be reused by another profile with a different master prompt.

## Structured generation

Prefer validated structured output, for example:

~~~json
{
  "title": "...",
  "caption": "...",
  "hashtags": ["..."],
  "category": "AI",
  "image_prompt": "...",
  "source": {
    "title": "...",
    "url": "..."
  }
}
~~~

## AI provider abstraction

Expose:
- generateText
- generateStructured
- generateImage
- generateVideo

Provider/model selection must be configurable.

## Prompt UX

Every profile gets a prominent editable Initial / Master Prompt field. Users should not need to understand n8n.

## Versioning

Store prompt version and associate generated content with the exact version used.

## Regeneration

Allow regenerating caption, image prompt, image or the whole item. Keep generation history.

## Secrets

Never put API keys, tokens, passwords or private keys into prompts, source code, Git or exported workflow JSON.
