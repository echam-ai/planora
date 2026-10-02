import { Check, Search, SlidersHorizontal } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  emptyBoardFilters,
  type BoardDeadlineFilter,
  type BoardFiltersState,
} from "@/features/tasks/boardFilters";
import { deadlineLabels } from "@/features/tasks/deadline";
import { useAdoptDomValue } from "@/hooks/useAdoptDomValue";
import { categoryOptions, priorityOptions } from "@/features/tasks/labels";

type Props = {
  search: string;
  filters: BoardFiltersState;
  onSearchChange: (value: string) => void;
  onFiltersChange: (value: BoardFiltersState) => void;
};

const deadlineOptions = (
  ["none", "scheduled", "due_soon", "overdue"] satisfies BoardDeadlineFilter[]
).map((value) => ({ value, label: deadlineLabels[value] }));

function toggle<T>(values: T[], value: T): T[] {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
}

function FilterGroup<T extends string>({
  label,
  options,
  selected,
  onToggle,
}: {
  label: string;
  options: { value: T; label: string }[];
  selected: T[];
  onToggle: (value: T) => void;
}) {
  return (
    <fieldset className="flex flex-wrap items-center gap-1.5">
      <legend className="sr-only">{label}</legend>
      {options.map((option) => (
        <Button
          key={option.value}
          type="button"
          variant={selected.includes(option.value) ? "default" : "outline"}
          size="sm"
          aria-pressed={selected.includes(option.value)}
          onClick={() => onToggle(option.value)}
        >
          {selected.includes(option.value) && <Check className="size-3.5" aria-hidden />}
          {option.label}
        </Button>
      ))}
    </fieldset>
  );
}

export function BoardFilters({ search, filters, onSearchChange, onFiltersChange }: Props) {
  const searchRef = useAdoptDomValue<HTMLInputElement>(onSearchChange);
  return (
    <div className="mb-6 flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-card p-3 shadow-card">
      <div className="relative min-w-52 flex-1">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          ref={searchRef}
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="Search tasks"
          aria-label="Search tasks"
          className="pl-9"
        />
      </div>
      <SlidersHorizontal className="hidden h-4 w-4 text-muted-foreground sm:block" aria-hidden />
      <FilterGroup
        label="Category"
        options={categoryOptions}
        selected={filters.categories}
        onToggle={(value) =>
          onFiltersChange({ ...filters, categories: toggle(filters.categories, value) })
        }
      />
      <FilterGroup
        label="Priority"
        options={priorityOptions}
        selected={filters.priorities}
        onToggle={(value) =>
          onFiltersChange({ ...filters, priorities: toggle(filters.priorities, value) })
        }
      />
      <FilterGroup
        label="Deadline"
        options={deadlineOptions}
        selected={filters.deadlines}
        onToggle={(value) =>
          onFiltersChange({ ...filters, deadlines: toggle(filters.deadlines, value) })
        }
      />
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => {
          onSearchChange("");
          onFiltersChange(emptyBoardFilters);
        }}
      >
        Clear all filters
      </Button>
    </div>
  );
}
