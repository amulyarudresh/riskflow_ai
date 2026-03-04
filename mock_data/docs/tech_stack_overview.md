# RiskFlow AI - Technology Stack Overview

Our platform is engineered for scale, reliability, and security in the Fintech sector.

## Frontend
- **Framework:** Next.js (React) utilizing the App Router.
- **Styling:** TailwindCSS for utility-first responsive design.

## Backend & Database
- **Primary Database:** Managed Supabase (PostgreSQL).
- **Authentication:** Supabase Auth integrated with custom user roles.
- **Vector Storage:** Supabase `pgvector` extension for efficient embedding similarity search and retrieval.

## AI & Machine Learning
- **Primary LLM:** Gemini API (Gemini 1.5 Pro) for complex reasoning, multimodal tasks, and large context windows.
- **Alternative LLM:** OpenAI GPT-4o for provider redundancy.
- **Embeddings:** Gemini `gemini-embedding-001` configured for 1536-dimensional document vectors.
