/** DOM id of a task card's details block, unique per task within one page. */
export function taskCardDetailsId(taskId: string) {
  return `task-card-details-${taskId}`;
}
