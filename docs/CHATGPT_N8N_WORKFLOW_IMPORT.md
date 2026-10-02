
# Auto-Media — ChatGPT + n8n Workflow Authoring

## Purpose

Advanced users can ask ChatGPT to create n8n JSON and import it into Auto-Media.

This accelerates custom automation but does not replace built-in reusable content types.

## Import flow

Automation -> Import n8n Workflow -> paste/upload JSON -> validate -> review requirements -> map credentials -> test -> save version -> activate.

## Validation report

Show:
- workflow name
- node count
- trigger
- AI nodes
- HTTP nodes
- credential requirements
- unsupported nodes
- embedded secrets
- environment variables
- expected inputs
- expected outputs

## Runtime contract

Imported workflows should accept:

~~~json
{
  "jobId": "...",
  "profileId": "...",
  "contentTypeId": "...",
  "automationId": "..."
}
~~~

and return a normalized result.

## Secret scanning

Detect likely API keys, bearer tokens, OAuth tokens, private keys and passwords. Replace secrets with n8n credential references.

## Versioning

Allow import, export, duplicate, test, activate and deactivate while preserving previous versions.

## Built-in versus custom

Use built-in content types for common use cases. Use imported n8n workflows for advanced custom requirements. Both use the same profiles, jobs, media library, destinations and logs.
