import { useEffect, useRef, useState } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { format, parseISO } from "date-fns";
import { CalendarIcon, Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useSettings } from "@/features/settings/hooks";
import { categoryOptions, priorityOptions } from "@/features/tasks/labels";
import { uid } from "@/lib/id";
import { MarkdownPreview } from "@/lib/markdown";
import {
  dirtyDraftPatch,
  emptyDraft,
  draftToValues,
  valuesToDraft,
} from "@/features/tasks/formMapping";
import { taskFormSchema, type TaskFormValues } from "@/shared/domain/task";
import type { TaskCategory, TaskDraft, TaskPriority, TaskStatus } from "@/types";

export type { TaskFormValues } from "@/shared/domain/task";

type Props = {
  defaultDraft?: TaskDraft;
  submitLabel: string;
  submitting?: boolean;
  /** `draft` carries every field (creation); `patch` only the fields the user edited. */
  onSubmit: (draft: TaskDraft, patch: Partial<TaskDraft>) => void;
  onCancel: () => void;
  status?: TaskStatus;
  onStatusChange?: (status: TaskStatus) => void;
  extraActions?: React.ReactNode;
};

/**
 * The deadline field converts wall-clock entry with the Settings timezone,
 * never the browser's — so nothing renders until that timezone is known, and
 * a failed load never falls back to the browser zone or a hard-coded "UTC".
 * `useSettings()` is the `ApiClient` seam; it is never read from the mock
 * module directly, so the later HTTP swap (#35) changes nothing here.
 */
export function TaskForm(props: Props) {
  const { data: settings, isError, refetch } = useSettings();
  if (isError) {
    return (
      <div className="space-y-5">
        <p role="alert" className="text-sm text-destructive">
          Couldn't load your timezone. Deadlines can't be entered until it loads.
        </p>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={props.onCancel}>
            Cancel
          </Button>
          <Button type="button" onClick={() => refetch()}>
            Try again
          </Button>
        </div>
      </div>
    );
  }
  if (!settings) {
    return (
      <div className="space-y-5" aria-busy="true">
        <p className="text-sm text-muted-foreground">Loading your timezone…</p>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={props.onCancel}>
            Cancel
          </Button>
        </div>
      </div>
    );
  }
  return <TaskFormFields {...props} timezone={settings.timezone} />;
}

function TaskFormFields({
  defaultDraft = emptyDraft,
  submitLabel,
  submitting,
  onSubmit,
  onCancel,
  status,
  onStatusChange,
  extraActions,
  timezone,
}: Props & { timezone: string }) {
  const form = useForm<TaskFormValues>({
    resolver: zodResolver(taskFormSchema),
    defaultValues: draftToValues(defaultDraft, timezone),
    mode: "onSubmit",
  });
  const { fields, append, remove } = useFieldArray({ control: form.control, name: "urls" });
  const note = form.watch("markdownNote");
  const deadlineDate = form.watch("deadlineDate");
  const deadlineTime = form.watch("deadlineTime");
  const [dateOpen, setDateOpen] = useState(false);
  const dateTriggerRef = useRef<HTMLButtonElement>(null);
  // Reading formState in render subscribes to it, so these stay current.
  const { errors, dirtyFields } = form.formState;
  const hasDeadline = !!deadlineDate || !!deadlineTime;
  const deadlineDescribedBy = ["deadline-timezone", errors.deadlineTime ? "deadline-error" : null]
    .filter(Boolean)
    .join(" ");
  const clearDeadline = () => {
    form.setValue("deadlineDate", "", { shouldDirty: true, shouldValidate: true });
    form.setValue("deadlineTime", "", { shouldDirty: true, shouldValidate: true });
    // Clearing unmounts the button the user just activated; without this the
    // dialog container is left holding focus and Tab order restarts.
    dateTriggerRef.current?.focus();
  };

  // The task can change underneath an open form (board drag, confirmed chat
  // write, a Settings timezone change). Track it: fields the user edited keep
  // their values, every other field takes the new task/timezone value, and
  // only edited fields reach Save's patch.
  const appliedDefaults = useRef(JSON.stringify(draftToValues(defaultDraft, timezone)));
  useEffect(() => {
    const incoming = draftToValues(defaultDraft, timezone);
    const serialised = JSON.stringify(incoming);
    if (serialised === appliedDefaults.current) return;
    appliedDefaults.current = serialised;
    form.reset(incoming, { keepDirtyValues: true });
  }, [defaultDraft, timezone, form]);

  return (
    <form
      className="space-y-5"
      onSubmit={form.handleSubmit((values) =>
        onSubmit(valuesToDraft(values, timezone), dirtyDraftPatch(values, dirtyFields, timezone)),
      )}
      noValidate
    >
      <div className="space-y-2">
        <Label htmlFor="title">Title</Label>
        <Input
          id="title"
          {...form.register("title")}
          aria-invalid={!!errors.title}
          aria-describedby={errors.title ? "title-error" : undefined}
        />
        {errors.title && (
          <p id="title-error" className="text-sm text-destructive">
            {errors.title.message}
          </p>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="content">Content</Label>
        <Textarea
          id="content"
          rows={4}
          {...form.register("content")}
          aria-invalid={!!errors.content}
        />
        {errors.content && <p className="text-sm text-destructive">{errors.content.message}</p>}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="category">Category</Label>
          <Select
            value={form.watch("category")}
            onValueChange={(v) =>
              form.setValue("category", v as TaskCategory, { shouldDirty: true })
            }
          >
            <SelectTrigger id="category" className="min-h-11">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {categoryOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="priority">Priority</Label>
          <Select
            value={form.watch("priority")}
            onValueChange={(v) =>
              form.setValue("priority", v as TaskPriority, { shouldDirty: true })
            }
          >
            <SelectTrigger id="priority" className="min-h-11">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {priorityOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <fieldset className="m-0 min-w-0 space-y-2 border-0 p-0 sm:col-span-2">
          <legend className="text-sm font-medium leading-none">Deadline (optional)</legend>
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex flex-col gap-1">
              <Label
                id="deadline-date-label"
                htmlFor="deadline-date"
                className="text-xs font-normal text-muted-foreground"
              >
                Date
              </Label>
              <Popover open={dateOpen} onOpenChange={setDateOpen}>
                <PopoverTrigger asChild>
                  <Button
                    id="deadline-date"
                    ref={dateTriggerRef}
                    type="button"
                    variant="outline"
                    className="min-h-11 w-[9.5rem] justify-start gap-2 font-normal"
                    aria-labelledby="deadline-date-label deadline-date-value"
                    aria-invalid={!!errors.deadlineTime}
                    aria-describedby={deadlineDescribedBy}
                  >
                    <CalendarIcon className="h-4 w-4 shrink-0 opacity-60" aria-hidden />
                    <span id="deadline-date-value">
                      {deadlineDate ? format(parseISO(deadlineDate), "d MMM yyyy") : "Pick a date"}
                    </span>
                  </Button>
                </PopoverTrigger>
                <PopoverContent
                  className="w-auto p-0"
                  align="start"
                  onOpenAutoFocus={(e) => {
                    // Radix would otherwise focus the popover's first tabbable
                    // element (a month-nav button); focus the calendar's
                    // roving-tabindex day instead, so arrow keys work at once.
                    e.preventDefault();
                    (e.currentTarget as HTMLElement)
                      .querySelector<HTMLButtonElement>(
                        '[data-slot="calendar"] button[tabindex="0"]',
                      )
                      ?.focus();
                  }}
                >
                  <Calendar
                    mode="single"
                    autoFocus
                    selected={deadlineDate ? parseISO(deadlineDate) : undefined}
                    onSelect={(day) => {
                      form.setValue("deadlineDate", day ? format(day, "yyyy-MM-dd") : "", {
                        shouldDirty: true,
                        shouldValidate: true,
                      });
                      // Move focus back to the trigger before the popover
                      // unmounts the calendar, so keyboard focus never lands
                      // on <body> and Tab keeps flowing to the time field.
                      dateTriggerRef.current?.focus();
                      setDateOpen(false);
                    }}
                  />
                </PopoverContent>
              </Popover>
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="deadline-time" className="text-xs font-normal text-muted-foreground">
                Time
              </Label>
              <Input
                id="deadline-time"
                type="time"
                className="min-h-11 w-28"
                aria-invalid={!!errors.deadlineTime}
                aria-describedby={deadlineDescribedBy}
                {...form.register("deadlineTime")}
              />
            </div>
            {hasDeadline && (
              <Button
                type="button"
                variant="ghost"
                className="min-h-11 gap-1 px-2 text-muted-foreground hover:text-destructive"
                onClick={clearDeadline}
              >
                <X className="h-4 w-4" aria-hidden /> Clear deadline
              </Button>
            )}
          </div>
          <p id="deadline-timezone" className="text-xs text-muted-foreground">
            Interpreted in {timezone}
          </p>
          {errors.deadlineTime && (
            <p id="deadline-error" className="text-sm text-destructive">
              {errors.deadlineTime.message}
            </p>
          )}
        </fieldset>
        {status && onStatusChange && (
          <div className="space-y-2">
            <Label htmlFor="status">Status</Label>
            <Select value={status} onValueChange={(v) => onStatusChange(v as TaskStatus)}>
              <SelectTrigger id="status" className="min-h-11">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todo">Todo</SelectItem>
                <SelectItem value="in_progress">In Progress</SelectItem>
                <SelectItem value="done">Done</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>Links</Label>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => append({ id: uid("url"), url: "", label: "" })}
          >
            <Plus className="h-4 w-4" /> Add link
          </Button>
        </div>
        {fields.length === 0 && <p className="text-sm text-muted-foreground">No links yet.</p>}
        {fields.map((field, index) => (
          <div key={field.id} className="grid gap-2 sm:grid-cols-[1fr_1.6fr_auto]">
            <Input placeholder="Label (optional)" {...form.register(`urls.${index}.label`)} />
            <div>
              <Input placeholder="https://…" {...form.register(`urls.${index}.url`)} />
              {errors.urls?.[index]?.url && (
                <p className="mt-1 text-sm text-destructive">{errors.urls[index]?.url?.message}</p>
              )}
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Remove link"
              onClick={() => remove(index)}
            >
              <Trash2 className="h-4 w-4 text-destructive" />
            </Button>
          </div>
        ))}
      </div>

      <div className="space-y-2">
        <Label>Markdown note</Label>
        <Tabs defaultValue="edit">
          <TabsList>
            <TabsTrigger value="edit">Edit</TabsTrigger>
            <TabsTrigger value="preview">Preview</TabsTrigger>
          </TabsList>
          <TabsContent value="edit">
            <Textarea rows={6} placeholder="# Notes" {...form.register("markdownNote")} />
          </TabsContent>
          <TabsContent value="preview">
            <div className="min-h-32 rounded-lg border border-border bg-card p-4">
              <MarkdownPreview source={note ?? ""} />
            </div>
          </TabsContent>
        </Tabs>
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
        {extraActions}
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={submitting}>
          {submitting ? "Saving…" : submitLabel}
        </Button>
      </div>
    </form>
  );
}
