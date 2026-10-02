import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/services/api";
import { ApiError } from "@/types";
import { qk } from "@/shared/queryKeys";

export const useConversation = () =>
  useQuery({ queryKey: qk.conversation, queryFn: () => api.getCurrentConversation() });

export function useChatMutations() {
  const qc = useQueryClient();
  const sync = (conv: unknown) => qc.setQueryData(qk.conversation, conv);
  // Only a confirmed action can write tasks; send, reset and reject touch the conversation alone.
  const syncAndRefreshTasks = (conv: unknown) => {
    sync(conv);
    qc.invalidateQueries({ queryKey: qk.tasks });
  };
  // A 404 or 409 means the card is out of date (cancelled elsewhere, already applied, or
  // removed by a reset), so re-read the conversation instead of offering a dead Confirm.
  const resyncIfStale = (e: Error) => {
    if (e instanceof ApiError && (e.status === 404 || e.status === 409))
      qc.invalidateQueries({ queryKey: qk.conversation });
  };
  return {
    send: useMutation({ mutationFn: (text: string) => api.sendChatMessage(text), onSuccess: sync }),
    reset: useMutation({ mutationFn: () => api.startNewConversation(), onSuccess: sync }),
    confirm: useMutation({
      mutationFn: (actionId: string) => api.confirmChatAction(actionId),
      onSuccess: syncAndRefreshTasks,
      onError: resyncIfStale,
    }),
    reject: useMutation({
      mutationFn: (actionId: string) => api.rejectChatAction(actionId),
      onSuccess: sync,
      onError: resyncIfStale,
    }),
  };
}
