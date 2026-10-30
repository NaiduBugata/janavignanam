import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./style.css";

const API = import.meta.env.VITE_API_BASE_URL || "http://localhost:8000/api";

function App() {
  const [documents, setDocuments] = useState([]);
  const [selectedDocumentId, setSelectedDocumentId] = useState("");
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const loadDocuments = async () => {
    const response = await fetch(`${API}/documents`);
    if (!response.ok) throw new Error("Could not load documents");
    const loaded = await response.json();
    setDocuments(loaded);
    setSelectedDocumentId((current) => current || loaded[0]?.document_id || "");
  };

  useEffect(() => { loadDocuments().catch((err) => setError(err.message)); }, []);

  const upload = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setBusy(true); setError("");
    try {
      const body = new FormData(); body.append("file", file);
      const response = await fetch(`${API}/documents/upload`, { method: "POST", body });
      if (!response.ok) throw new Error((await response.json()).detail || "Upload failed");
      const uploaded = await response.json();
      await loadDocuments();
      setSelectedDocumentId(uploaded.document_id);
    } catch (err) { setError(err.message); } finally { setBusy(false); event.target.value = ""; }
  };

  const ask = async (event) => {
    event.preventDefault();
    if (!question.trim()) { setError("Enter a question first."); return; }
    setBusy(true); setError("");
    try {
      const response = await fetch(`${API}/rag/query`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, document_id: selectedDocumentId || null }),
      });
      if (!response.ok) throw new Error((await response.json()).detail || "Query failed");
      setAnswer(await response.json()); setQuestion("");
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  return <main>
    <header><span className="eyebrow">LOCAL RAG ENGINE</span><h1>Ask your documents.</h1>
      <p>Upload a Word document, then get grounded answers with transparent sources.</p></header>
    <section className="panel upload"><div><h2>Knowledge base</h2><p>{documents.length} document(s) indexed</p></div>
      <label className="button">{busy ? "Processing..." : "Upload .docx"}<input type="file" accept=".docx" onChange={upload} disabled={busy}/></label>
      {documents.map((doc) => <div className="doc" key={doc.document_id}><span>{doc.document_name}</span><small>{doc.chunk_count} chunks</small></div>)}
    </section>
    <section className="panel chat"><h2>Conversation</h2>
      {answer && <article className="answer"><div className="answer-label">ANSWER</div><p>{answer.answer}</p>
        {answer.sources.length > 0 && <details><summary>Retrieved sources ({answer.sources.length})</summary>
          {answer.sources.map((source) => <div className="source" key={source.chunk_id}><b>{source.document_name} · chunk {source.chunk_index}</b><small>score {source.score.toFixed(3)}</small><p>{source.content}</p></div>)}
        </details>}
      </article>}
      <form onSubmit={ask}><textarea value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="What would you like to know?" disabled={busy}/><button disabled={busy}>{busy ? "Thinking..." : "Ask"}</button></form>
      {error && <div className="error">{error}</div>}
    </section>
  </main>;
}

createRoot(document.getElementById("root")).render(<App />);
