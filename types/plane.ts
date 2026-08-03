export type Priority = 'urgent' | 'high' | 'medium' | 'low' | 'none';

export type StateGroup = 'backlog' | 'unstarted' | 'started' | 'completed' | 'cancelled';

export type RelationType = 'blocking' | 'blocked_by' | 'duplicate_of' | 'duplicate' | 'relates_to';

export type PaginationEnvelope<T> = {
  next_cursor: string;
  prev_cursor: string;
  next_page_results: boolean;
  prev_page_results: boolean;
  count: number;
  total_pages: number;
  total_results: number;
  extra_stats: Record<string, unknown>;
  results: T[];
};

// Read shape — exactly what Plane's API returns for a work item.
export type WorkItem = {
  id: string;
  name: string;
  sequence_id: number;
  description_html: string;
  description_stripped: string;
  priority: Priority;
  state_id: string;
  type_id: string | null;
  parent_id: string | null;
  project_id: string;
  workspace_id: string;
  assignee_ids: string[];
  label_ids: string[];
  start_date: string | null;
  target_date: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  created_by_id: string;
};

// Write shape — the body accepted by POST/PATCH work-items endpoints.
// Field names intentionally differ from WorkItem (see normalize.ts).
export type WorkItemWriteBody = {
  name?: string;
  description_html?: string;
  priority?: Priority;
  state?: string;
  assignees?: string[];
  labels?: string[];
  type_id?: string;
  parent?: string | null;
  start_date?: string;
  target_date?: string;
  estimate_point?: string;
  external_id?: string;
  external_source?: string;
};

export type Project = {
  id: string;
  name: string;
  identifier: string;
  description: string;
  network: 0 | 2;
  workspace: string;
  workspace_slug: string;
  created_at: string;
  updated_at: string;
};

export type Cycle = {
  id: string;
  name: string;
  description: string;
  start_date: string | null;
  end_date: string | null;
  project_id: string;
  workspace_id: string;
  created_at: string;
  updated_at: string;
};

export type Module = {
  id: string;
  name: string;
  description: string;
  start_date: string | null;
  target_date: string | null;
  project_id: string;
  workspace_id: string;
  created_at: string;
  updated_at: string;
};

export type State = {
  id: string;
  name: string;
  color: string;
  group: StateGroup;
  sequence: number;
  default: boolean;
  description: string;
  project_id: string;
  workspace_id: string;
};

export type Label = {
  id: string;
  name: string;
  color: string;
  parent: string | null;
  project_id: string;
  workspace_id: string;
};

export type Comment = {
  id: string;
  issue_id: string;
  actor_id: string;
  comment_html: string;
  comment_stripped: string;
  access: 'INTERNAL' | 'EXTERNAL';
  created_at: string;
  updated_at: string;
};

export type Relation = {
  id: string;
  related_work_item_id: string;
  relation_type: RelationType;
};

export type Member = {
  id: string;
  member_id: string;
  role: number;
  workspace_id: string;
  project_id?: string;
};
