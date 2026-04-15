export type SuggestionEntity = {
  id: string;
  transaction_id?: string | null;
  suggestion: Record<string, unknown>;
  source: string;
  source_id?: string | null;
  confidence?: number | null;
  group_id?: string | null;
  status: 'pending' | 'accepted' | 'dismissed';
  created_at: string;
};
