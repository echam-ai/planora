import { useId, useRef, useState } from "react";
import { Check, ChevronDown, Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
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
  open,
  onOpenChange,
}: {
  label: string;
  options: { value: T; label: string }[];
  selected: T[];
  onToggle: (value: T) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const descriptionId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const firstOptionRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const tabExit = useRef(false);
  const selectedLabels = options
    .filter((option) => selected.includes(option.value))
    .map((option) => option.label);

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button
          ref={triggerRef}
          type="button"
          variant={selected.length ? "secondary" : "outline"}
          className="gap-1 px-2"
          aria-label={selected.length ? `${label} ${selected.length}` : label}
          aria-describedby={descriptionId}
        >
          {label}
          {selected.length > 0 && (
            <span className="min-w-4 rounded-sm bg-primary/10 px-0.5 text-xs font-semibold text-primary">
              {selected.length}
            </span>
          )}
          <ChevronDown className="size-3" aria-hidden />
        </Button>
      </PopoverTrigger>
      <span id={descriptionId} className="sr-only">
        {selectedLabels.length ? `Selected: ${selectedLabels.join(", ")}` : "No selections"}
      </span>
      <PopoverContent
        aria-label={`${label} filters`}
        align="start"
        collisionPadding={8}
        className="w-56 max-w-[calc(100vw-1rem)] max-h-[min(20rem,var(--radix-popover-content-available-height))] overflow-y-auto p-2"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          firstOptionRef.current?.focus();
        }}
        onCloseAutoFocus={(event) => {
          if (tabExit.current) {
            event.preventDefault();
            tabExit.current = false;
          }
        }}
        onKeyDown={(event) => {
          const forwardExit =
            event.key === "Tab" && !event.shiftKey && event.target === closeRef.current;
          const backwardExit =
            event.key === "Tab" && event.shiftKey && event.target === firstOptionRef.current;
          if (!forwardExit && !backwardExit) return;
          event.preventDefault();
          tabExit.current = true;
          onOpenChange(false);
          if (backwardExit) {
            triggerRef.current?.focus();
            return;
          }
          // Radix loops its focus scope. Exit after Close to the next toolbar control.
          const controls = Array.from(
            document.querySelectorAll<HTMLElement>(
              'button, input, a[href], select, textarea, [tabindex="0"]',
            ),
          ).filter(
            (element) =>
              !element.closest('[role="dialog"]') &&
              !element.hasAttribute("disabled") &&
              element.getClientRects().length > 0,
          );
          const next = controls[controls.indexOf(triggerRef.current!) + 1];
          (next ?? triggerRef.current)?.focus();
        }}
      >
        <fieldset className="min-w-0">
          <legend className="px-2 py-1 text-sm font-medium">{label}</legend>
          <div className="mt-1 space-y-1">
            {options.map((option, index) => (
              <Button
                key={option.value}
                ref={index === 0 ? firstOptionRef : undefined}
                type="button"
                variant={selected.includes(option.value) ? "secondary" : "ghost"}
                className="w-full justify-start gap-2 px-2"
                aria-pressed={selected.includes(option.value)}
                onClick={() => onToggle(option.value)}
              >
                <span className="size-4 shrink-0">
                  {selected.includes(option.value) && <Check className="size-4" aria-hidden />}
                </span>
                {option.label}
              </Button>
            ))}
          </div>
        </fieldset>
        <Button
          ref={closeRef}
          type="button"
          variant="ghost"
          className="mt-2 w-full border-t border-border"
          aria-label={`Close ${label} filters`}
          onClick={() => onOpenChange(false)}
        >
          Close
        </Button>
      </PopoverContent>
    </Popover>
  );
}

export function BoardFilters({ search, filters, onSearchChange, onFiltersChange }: Props) {
  const searchRef = useAdoptDomValue<HTMLInputElement>(onSearchChange);
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const active = search.length > 0 || Object.values(filters).some((values) => values.length > 0);
  const groupProps = (label: string) => ({
    open: openGroup === label,
    onOpenChange: (open: boolean) => setOpenGroup(open ? label : null),
  });
  return (
    <section
      aria-label="Board filters"
      className="mb-5 grid grid-cols-[minmax(0,1fr)_auto] gap-2 sm:flex sm:flex-wrap sm:items-center"
    >
      <div
        role="search"
        aria-label="Task search"
        className="relative col-start-1 row-start-1 min-w-0 sm:w-72 sm:flex-none"
      >
        <Search
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          ref={searchRef}
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="Search tasks"
          aria-label="Search tasks"
          className="bg-background pl-9"
        />
      </div>
      <div className="col-span-2 row-start-2 flex min-w-0 flex-wrap gap-2 sm:contents">
        <FilterGroup
          label="Category"
          options={categoryOptions}
          selected={filters.categories}
          onToggle={(value) =>
            onFiltersChange({ ...filters, categories: toggle(filters.categories, value) })
          }
          {...groupProps("Category")}
        />
        <FilterGroup
          label="Priority"
          options={priorityOptions}
          selected={filters.priorities}
          onToggle={(value) =>
            onFiltersChange({ ...filters, priorities: toggle(filters.priorities, value) })
          }
          {...groupProps("Priority")}
        />
        <FilterGroup
          label="Deadline"
          options={deadlineOptions}
          selected={filters.deadlines}
          onToggle={(value) =>
            onFiltersChange({ ...filters, deadlines: toggle(filters.deadlines, value) })
          }
          {...groupProps("Deadline")}
        />
      </div>
      {active && (
        <Button
          type="button"
          variant="ghost"
          aria-label="Clear all filters"
          className="col-start-2 row-start-1 gap-1 px-2"
          onClick={() => {
            onSearchChange("");
            onFiltersChange(emptyBoardFilters);
            setOpenGroup(null);
          }}
        >
          <X className="size-4" aria-hidden />
          <span className="hidden sm:inline">Clear all filters</span>
        </Button>
      )}
    </section>
  );
}
