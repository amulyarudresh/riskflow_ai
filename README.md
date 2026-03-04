# RiskFlow AI - Structured Questionnaire Answering Tool

A production-minded assignment implementation for automating vendor/compliance questionnaire responses using grounded retrieval and LLM generation.

## Live Demo
- App URL: `<add-your-deployed-url>`
- Repository: `<add-your-repo-url>`

## Company Context

**Industry:** Fintech Compliance

**Fictional Company:** **RiskFlow AI** helps fintech teams respond to vendor risk and compliance questionnaires using approved internal policy documents. The platform reduces repetitive manual work, improves consistency, and keeps answers traceable to source evidence.

## What I Built

RiskFlow AI implements an end-to-end workflow:

1. User signs up / logs in.
2. User uploads internal reference docs.
3. User uploads a questionnaire file.
4. System parses questionnaire into individual questions.
5. User clicks **Generate Answers**.
6. For each question, backend retrieves top relevant chunks from pgvector and asks Gemini to answer using only retrieved context.
7. User reviews answers, citations, and evidence snippets.
8. User edits answers where needed.
9. User can partially regenerate selected questions.
10. User can inspect run history/snapshots for previous generations.
11. User exports output in preserved structure (CSV/JSON).

## Assignment Mapping

### Phase 1 - Core Workflow (Must Have)
- Authentication: implemented with Supabase Auth (email/password).
- Questionnaire upload + parsing: implemented (`CSV`, `JSON`).
- Reference document upload + indexing: implemented.
- Generate answers: implemented with retrieval + Gemini.
- Grounding rule: returns exact `Not found in references.` when unsupported.
- Citation(s): stored and displayed per answer.
- Structured web view: question, answer, citation shown in review UI.

### Phase 2 - Review & Export (Must Have)
- Review and edit before export: implemented.
- Downloadable output: implemented.
- Structure preservation:
  - `CSV` input -> exported `CSV` keeps original rows/columns and appends `Answer` + `Citation`.
  - `JSON` input -> exported `JSON` preserves structure and annotates question objects with `answer` + `citation`.
- Original question order: preserved using `question_order`.

### Nice-to-Have Implemented
- Evidence Snippets
- Coverage Summary
- Confidence Score (stored in DB and computed from retrieval similarity)
- Partial Regeneration (selected questions only)
- Version History (run-level and item-level snapshots)

## Tech Stack

- **Frontend:** Next.js 16, React 19, Tailwind CSS 4
- **Backend:** Next.js Route Handlers
- **Auth + DB:** Supabase (Postgres + RLS)
- **Vector Search:** pgvector (HNSW index + SQL RPC)
- **LLM + Embeddings:** Gemini API
- **File Parsing:** PapaParse (CSV)

## Architecture (High-Level)

1. **Ingestion**
   - `upload-document`: stores source docs and chunked embeddings.
   - `upload-questionnaire`: parses questions and stores ordered items.

2. **Generation**
   - For each question:
     - Embed question.
     - Retrieve top-3 chunks via `match_document_chunks`.
     - Generate grounded answer with strict system prompt.
     - Persist answer, citations, evidence snippets, confidence, answerability flag.

3. **Review + Export**
   - Review API returns ordered items + coverage summary.
   - User can edit answers and save.
   - Export API reconstructs output in source structure.

4. **Selective Regeneration + Run History**
   - UI supports selecting specific questions and regenerating only those items.
   - Each generation is persisted as a run (`full` or `partial`) with per-item snapshots.
   - Run history endpoints power comparison between historical outputs and current answers.

## Local Setup

## 1) Prerequisites
- Node.js 20+
- npm 10+
- Supabase project
- Gemini API key

## 2) Install
```bash
npm install
```

## 3) Environment Variables
Create `.env.local`:

```bash
NEXT_PUBLIC_SUPABASE_URL=your_supabase_project_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
GEMINI_API_KEY=your_gemini_api_key

# Optional overrides
GEMINI_TEXT_MODEL=gemini-2.5-flash
GEMINI_EMBEDDING_MODEL=gemini-embedding-001
```

## 4) Database Setup
Run `supabase/schema.sql` in Supabase SQL Editor.
This migration includes `question_order`, source-structure metadata, and run-history tables (`questionnaire_runs`, `questionnaire_item_runs`) required for partial regeneration and historical run viewing.

Important: after schema updates, run:
```sql
notify pgrst, 'reload schema';
```

## 5) Start App
```bash
npm run dev
```

Open `http://localhost:3000`.

## Demo Data Included

- Questionnaire: `mock_data/vendor_questionnaire.json` (10 questions)
- Reference docs: `mock_data/docs/` (4 documents)

## Key Product Decisions

- Designed review as a first-class phase, not a post-processing step.
- Prioritized traceability (citations + evidence snippets) over pure generation speed.
- Kept export behavior deterministic to maintain operational reliability for compliance teams.

## Assumptions Made

1. **Input format scope (intentional):**
   - For assignment velocity and reliability, questionnaire ingestion supports `CSV` and `JSON`.
   - Complex `PDF/XLSX` parsing was intentionally deferred.

2. **Single-tenant-by-auth-user model:**
   - Data ownership is scoped by `auth.uid()` and RLS.

3. **Citation model:**
   - Citations are derived from retrieved source document titles and stored as arrays.

4. **Reference data quality:**
   - Assumes uploaded docs contain enough policy detail for retrieval-based answering.

## Trade-offs

1. **Simple vector similarity vs hybrid search**
   - Implemented dense vector retrieval (pgvector cosine) for speed of delivery.
   - Did not add BM25/keyword hybrid ranking, which could improve edge-case precision.

2. **Top-3 retrieval depth**
   - Fixed depth keeps costs and latency predictable.
   - Dynamic depth/reranking could improve harder questions.

3. **Structure-preserving export limited to CSV/JSON**
   - Strong for supported formats.
   - Not yet generalized to PDF-native roundtripping.

4. **Synchronous generation loop**
   - Easier correctness and debugging.
   - Throughput could improve with background jobs and batched processing.

## Future Improvements

1. Add **user-specific document silos/workspaces** with stronger org-level boundaries and sharing controls.
2. Add **PDF/XLSX ingestion + OCR** pipeline for real-world questionnaire formats.
3. Add **hybrid retrieval** (keyword + dense vectors + reranker).
4. Add **async job queue** with progress tracking and retries.
5. Add **automated eval harness** for grounding quality and citation correctness.
6. Add **role-based review workflows** (analyst draft, approver sign-off).
7. Add **run diff visualizations** (word-level answer diffs between runs).
8. Add **approval states per run** (draft/reviewed/approved) with audit timestamps.

## Security Notes

- Row Level Security policies enforce per-user data access.
- Auth session middleware protects app routes.
- Do not commit `.env.local`.
- Rotate keys immediately if they are ever exposed.

## Known Limitations

- No direct PDF/XLSX questionnaire parsing yet.
- Export fidelity is guaranteed for CSV/JSON only.
- Accuracy depends on quality and completeness of uploaded references.

## Project Scripts

```bash
npm run dev     # start local development server
npm run build   # production build
npm run start   # run production server
npm run lint    # run eslint
```

## Suggested Demo Flow for Reviewers

1. Sign up and log in.
2. Upload 2-4 reference docs from `mock_data/docs/`.
3. Upload `mock_data/vendor_questionnaire.json`.
4. Click **Generate Answers**.
5. Open **Review and Export**.
6. Inspect coverage summary, citations, and evidence snippets.
7. Edit one answer, save, and export.

---

Built as a practical, grounded AI workflow with explicit focus on reliability, traceability, and real GTM/compliance usability.
