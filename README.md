# CodeAtlas

CodeAtlas is a simple local AI codebase explainer. It indexes a GitHub repository or local folder, then answers questions about the codebase with cited source snippets.

## Features

* GitHub repo URL or local folder indexing
* Simple text chunking with line ranges
* Embedding retrieval when `OPENAI_API_KEY` is set
* Keyword retrieval when no API key is set
* Answers with cited source snippets
* Feature file finder for questions like "what files handle auth?"
* Optional OpenAI Responses API integration when `OPENAI_API_KEY` is set

## To Run

```bash
npm run dev
```

Then open [http://localhost:5173](http://localhost:5173).

Enter a GitHub repo URL or a local folder path, click **Index**, then ask a question or click **Summarize codebase**.

## OpenAI Embeddings And Answers

The app works without an API key using keyword retrieval to deterministically generte answer.

To use embedding-based retrieval and LLM-written answers:

```bash
OPENAI_API_KEY=your_key npm run dev
```

You can override the model:

```bash
OPENAI_MODEL=gpt-4.1-mini OPENAI_API_KEY=your_key npm run dev
```

You can also override the embedding model:

```bash
OPENAI_EMBEDDING_MODEL=text-embedding-3-small OPENAI_API_KEY=your_key npm run dev
```

By default, answering is fast: the app returns the most relevant source sections without waiting for a separate LLM answer-generation call.

To also generate a prose answer with OpenAI:

```bash
GENERATE_ANSWERS=true OPENAI_API_KEY=your_key npm run dev
```

## How It Works

1. Walks the repo while ignoring non-code directories.
2. Splits each source file into line-numbered chunks.
3. Embeds each chunk when `OPENAI_API_KEY` is set.
4. Embeds the user question and retrieves chunks by cosine similarity.
5. Routes file-location questions to a ranked related-files answer.
6. Returns cited source sections as evidence.
7. Builds a codebase summary from indexed file paths, folder counts, and representative source snippets.
8. Optionally sends snippets to OpenAI to write a prose answer when `GENERATE_ANSWERS=true`.
9. Falls back to keyword retrieval when embeddings are unavailable.
