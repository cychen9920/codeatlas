const state = {
  sessionId: null
};

const el = {
  status: document.querySelector("#status"),
  source: document.querySelector("#source"),
  indexBtn: document.querySelector("#indexBtn"),
  askBtn: document.querySelector("#askBtn"),
  question: document.querySelector("#question"),
  answer: document.querySelector("#answer"),
  citations: document.querySelector("#citations")
};

el.indexBtn.addEventListener("click", indexRepo);
el.askBtn.addEventListener("click", ask);

el.source.addEventListener("keydown", event => {
  if (event.key === "Enter") indexRepo();
});

el.question.addEventListener("keydown", event => {
  if (event.key === "Enter") ask();
});

async function indexRepo() {
  const source = el.source.value.trim();
  if (!source) {
    setStatus("Enter a GitHub URL or local folder.");
    return;
  }

  await busy("Indexing repository", async () => {
    const data = await api("/api/index", { source });
    applyIndex(data);
  });
}

function applyIndex(data) {
  state.sessionId = data.id;
  el.answer.textContent = `Indexed ${data.fileCount} files. Ask a question about the repo.`;
  el.citations.innerHTML = "Cited source snippets will appear here.";
  el.citations.classList.add("muted");
  const detail = data.embeddingError ? `: ${data.embeddingError}` : "";
  setStatus(`Repo indexed using ${data.retrievalMode} retrieval${detail}`);
}

async function ask() {
  if (!state.sessionId) {
    setStatus("Index a repo first.");
    return;
  }

  const question = el.question.value.trim();
  if (!question) {
    setStatus("Ask a question.");
    return;
  }

  await busy("Answering", async () => {
    const data = await api("/api/ask", { sessionId: state.sessionId, question });
    renderAnswer(data);
  });
}

function renderAnswer(data) {
  el.answer.textContent = data.answer;
  el.citations.classList.remove("muted");
  el.citations.innerHTML = data.citations.length
    ? data.citations.slice(0, 5).map(citation => `
      <article class="citation">
        <header>${escapeHtml(citation.path)}:${citation.startLine}-${citation.endLine}</header>
        <pre>${escapeHtml(citation.snippet)}</pre>
      </article>
    `).join("")
    : `<p class="muted">No sources found.</p>`;
  setStatus("Answered");
}

async function api(path, body) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Request failed");
  return data;
}

async function busy(label, fn) {
  const buttons = [el.indexBtn, el.askBtn];
  buttons.forEach(button => {
    button.disabled = true;
  });
  setStatus(`${label}...`);

  try {
    await fn();
  } catch (error) {
    setStatus(error.message);
  } finally {
    buttons.forEach(button => {
      button.disabled = false;
    });
  }
}

function setStatus(message) {
  el.status.textContent = message;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[char]));
}
