import { useFieldArray, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MarkdownPreview } from "@/lib/markdown";
import { uid } from "@/data/seed";
import type { TaskCategory, TaskDraft, TaskPriority, TaskStatus } from "@/types";

const schema = z.object({
  title: z.string().trim().min(1, "Give the task a title."),
  content: z.string().trim().min(1, "Describe what needs to happen."),
  category: z.enum(["work", "personal", "study", "other"]),
  priority: z.enum(["low", "medium", "high"]),
  deadlineLocal: z.string().optional().or(z.literal("")),
  markdownNote: z.string(),
  urls: z.array(
    z.object({
      id: z.string(),
      label: z.string().optional(),
      url: z.string().trim().url("Enter a full URL starting with http:// or https://"),
    }),
  ),
});

export type TaskFormValues = z.infer<typeof schema>;

export function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function draftToValues(draft: TaskDraft): TaskFormValues {
  return {
    title: draft.title,
    content: draft.content,
    category: draft.category,
    priority: draft.priority,
    deadlineLocal: toLocalInput(draft.deadlineAt),
    markdownNote: draft.markdownNote,
    urls: draft.urls.map((u) => ({ id: u.id, url: u.url, label: u.label ?? "" })),
  };
}

export function valuesToDraft(values: TaskFormValues): TaskDraft {
  return {
    title: values.title.trim(),
    content: values.content.trim(),
    category: values.category as TaskCategory,
    priority: values.priority as TaskPriority,
    deadlineAt: values.deadlineLocal ? new Date(values.deadlineLocal).toISOString() : null,
    markdownNote: values.markdownNote,
    urls: values.urls.map((u) => ({ id: u.id, url: u.url.trim(), label: u.label?.trim() || undefined })),
  };
}

export const emptyDraft: TaskDraft = {
  title: "",
  content: "",
  category: "work",
  priority: "medium",
  deadlineAt: null,
  urls: [],
  markdownNote: "",
};

type Props = {
  defaultDraft?: TaskDraft;
  submitLabel: string;
  submitting?: boolean;
  onSubmit: (draft: TaskDraft, status?: TaskStatus) => void;
  onCancel: () => void;
  status?: TaskStatus;
  onStatusChange?: (status: TaskStatus) => void;
  extraActions?: React.ReactNode;
};

export function TaskForm({
  defaultDraft = emptyDraft,
  submitLabel,
  submitting,
  onSubmit,
  onCancel,
  status,
  onStatusChange,
  extraActions,
}: Props) {
  const form = useForm<TaskFormValues>({
    resolver: zodResolver(schema),
    defaultValues: draftToValues(defaultDraft),
    mode: "onSubmit",
  });
  const { fields, append, remove } = useFieldArray({ control: form.control, name: "urls" });
  const note = form.watch("markdownNote");
  const errors = form.formState.errors;

  return (
    <form
      className="space-y-5"
      onSubmit={form.handleSubmit((values) => onSubmit(valuesToDraft(values)))}
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
        <Textarea id="content" rows={4} {...form.register("content")} aria-invalid={!!errors.content} />
        {errors.content && <p className="text-sm text-destructive">{errors.content.message}</p>}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="category">Category</Label>
          <Select
            value={form.watch("category")}
            onValueChange={(v) => form.setValue("category", v as TaskCategory)}
          >
            <SelectTrigger id="category" className="min-h-11">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="work">Work</SelectItem>
              <SelectItem value="personal">Personal</SelectItem>
              <SelectItem value="study">Study</SelectItem>
              <SelectItem value="other">Other</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="priority">Priority</Label>
          <Select
            value={form.watch("priority")}
            onValueChange={(v) => form.setValue("priority", v as TaskPriority)}
          >
            <SelectTrigger id="priority" className="min-h-11">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="low">Low</SelectItem>
              <SelectItem value="medium">Medium</SelectItem>
              <SelectItem value="high">High</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="deadline">Deadline (optional)</Label>
          <Input id="deadline" type="datetime-local" className="min-h-11" {...form.register("deadlineLocal")} />
        </div>
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
