# Timeline — Admin & AI Provider Configuration Spec

## 1. Purpose
Allow app admin to configure AI providers and prompts via Drive-backed settings file.

## 2. Settings File (Drive)
Stored as `AdminSettings.json` in the app folder.

Planned example (future extension):
```json
{
  "provider": "stub | openai | gemini",
  "model": "gpt-4.1-mini",
  "temperature": 0.2,
  "max_tokens": 1500,
  "summaryPromptTemplate": "Summarise... {title} {text}",
  "highlightsPromptTemplate": "Extract highlights... {text}",
  "indexingPromptTemplate": "Generate tags/entities... {text}"
}
```

## 3. Provider Abstraction
Interface:
- `summarize({ title, text, metadata, settings })`

Providers:
- `stub`
- `openai` (Responses API)
- `gemini`

## 4. Admin UI Requirements
- Provider dropdown
- Model input
- Prompt editor textareas
- Temperature + max token controls
- Save to Drive

## 5. Security
- Admin allowlist
- No logging of prompt content
- Validate provider values
