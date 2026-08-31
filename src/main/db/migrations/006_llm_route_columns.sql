-- N-04: Multi-LLM Routing.
--
-- Messages now record which provider/model produced each assistant reply so the
-- routing decision is logged and visible (Acceptance Criteria: "Routing
-- decision is logged/visible"). Values are NULL when routing isn't used or the
-- reply didn't come from the LLM. These columns are intentionally excluded from
-- the Supabase column allow-list, so they stay purely local metadata.

ALTER TABLE messages ADD COLUMN provider TEXT;
ALTER TABLE messages ADD COLUMN model TEXT;