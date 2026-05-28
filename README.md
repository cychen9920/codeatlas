# CodeAtlas

CodeAtlas is a simple local AI codebase explainer. It indexes a GitHub repository or local folder, then answers questions about the codebase with cited source snippets.

## Features

- GitHub repo URL or local folder indexing
- Simple text chunking with line ranges
- Keyword retrieval across paths and code
- Answers with cited source snippets
- Simple one-page interface
- Optional OpenAI Responses API integration when `OPENAI_API_KEY` is set

## Run

```bash
npm run dev
```

Then open [http://localhost:5173](http://localhost:5173).

Enter a GitHub repo URL or a local folder path, click **Index**, then ask a question.

## Optional OpenAI Answers

The app works without an API key using local retrieval and a deterministic answer synthesizer. To get LLM-written explanations while keeping the same citations:

```bash
OPENAI_API_KEY=your_key npm run dev
```

You can override the model:

```bash
OPENAI_MODEL=gpt-4.1-mini OPENAI_API_KEY=your_key npm run dev
```

## How It Works

1. Walks the repo while ignoring generated and dependency directories.
2. Splits each source file into line-numbered chunks.
3. Retrieves chunks with keyword overlap against the question.
4. Sends those snippets to OpenAI when `OPENAI_API_KEY` is set.
5. Falls back to listing the most relevant source sections when no API key is set.

## Project Scope

This is intentionally small so the core repo Q&A flow is easy to understand and extend.
