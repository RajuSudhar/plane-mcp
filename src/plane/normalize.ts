import type { WorkItemWriteInput, WorkItemWriteBody } from '@types';

/**
 * Maps the MCP tool's read-shape-named arguments (state_id, assignee_ids,
 * due_date — matching how the model sees a retrieved work item) onto the
 * write-shape body Plane's POST/PATCH endpoints actually expect (state,
 * assignees, target_date). See ../../../docs/plane-api-reference.md section 7.1.
 */
export function toWorkItemWriteBody(input: WorkItemWriteInput): WorkItemWriteBody {
  const body: WorkItemWriteBody = {};
  if (input.name !== undefined) body.name = input.name;
  if (input.descriptionHtml !== undefined) body.description_html = input.descriptionHtml;
  if (input.priority !== undefined) body.priority = input.priority;
  if (input.stateId !== undefined) body.state = input.stateId;
  if (input.assigneeIds !== undefined) body.assignees = input.assigneeIds;
  if (input.labelIds !== undefined) body.labels = input.labelIds;
  if (input.typeId !== undefined) body.type_id = input.typeId;
  if (input.parentId !== undefined) body.parent = input.parentId;
  if (input.startDate !== undefined) body.start_date = input.startDate;
  if (input.dueDate !== undefined) body.target_date = input.dueDate;
  if (input.estimatePoint !== undefined) body.estimate_point = input.estimatePoint;
  if (input.externalId !== undefined) body.external_id = input.externalId;
  if (input.externalSource !== undefined) body.external_source = input.externalSource;
  return body;
}
