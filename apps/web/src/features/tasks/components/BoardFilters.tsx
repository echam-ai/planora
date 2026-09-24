import { Search, SlidersHorizontal } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { TaskCategory, TaskPriority } from "@/types";

export type BoardDeadlineFilter = "all" | "due_soon" | "overdue" | "none";

type Props = {
  search: string;
  category: TaskCategory | "all";
  priority: TaskPriority | "all";
  deadline: BoardDeadlineFilter;
  onSearchChange: (value: string) => void;
  onCategoryChange: (value: TaskCategory | "all") => void;
  onPriorityChange: (value: TaskPriority | "all") => void;
  onDeadlineChange: (value: BoardDeadlineFilter) => void;
};

export function BoardFilters({
  search,
  category,
  priority,
  deadline,
  onSearchChange,
  onCategoryChange,
  onPriorityChange,
  onDeadlineChange,
}: Props) {
  return (
    <div className="mb-6 flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-card p-3 shadow-card">
      <div className="relative min-w-52 flex-1">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="Search tasks"
          aria-label="Search tasks"
          className="pl-9"
        />
      </div>
      <SlidersHorizontal className="hidden h-4 w-4 text-muted-foreground sm:block" aria-hidden />
      <Select
        value={category}
        onValueChange={(value) => onCategoryChange(value as TaskCategory | "all")}
      >
        <SelectTrigger className="w-36" aria-label="Filter by category">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All categories</SelectItem>
          <SelectItem value="work">Work</SelectItem>
          <SelectItem value="personal">Personal</SelectItem>
          <SelectItem value="study">Study</SelectItem>
          <SelectItem value="other">Other</SelectItem>
        </SelectContent>
      </Select>
      <Select
        value={priority}
        onValueChange={(value) => onPriorityChange(value as TaskPriority | "all")}
      >
        <SelectTrigger className="w-36" aria-label="Filter by priority">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All priorities</SelectItem>
          <SelectItem value="high">High</SelectItem>
          <SelectItem value="medium">Medium</SelectItem>
          <SelectItem value="low">Low</SelectItem>
        </SelectContent>
      </Select>
      <Select
        value={deadline}
        onValueChange={(value) => onDeadlineChange(value as BoardDeadlineFilter)}
      >
        <SelectTrigger className="w-36" aria-label="Filter by deadline">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Any deadline</SelectItem>
          <SelectItem value="due_soon">Due within 24h</SelectItem>
          <SelectItem value="overdue">Overdue</SelectItem>
          <SelectItem value="none">No deadline</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
