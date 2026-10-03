import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { captureApi } from "@/services/api";
import { ApiError } from "@/types";
import { qk } from "@/shared/queryKeys";
import { useCancellableRequest } from "@/shared/cancellation";

export function useConversation() {
  const api = captureApi();
  return useQuery({ queryKey: qk.conversation, queryFn: () => api.getCurrentConversation() });
}

export function useChatMutations() {
  const qc = useQueryClient();
  const api = captureApi();
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
  const request = useCancellableRequest();
  const send = useMutation({
    mutationFn: async (text: string) => {
      const controller = request.begin();
      const conversation = await api.sendChatMessage(text, controller.signal);
      // An adapter may resolve even though it was cancelled; never sync that result.
      controller.signal.throwIfAborted();
      return conversation;
    },
    onSuccess: sync,
  });
  // Stops the request and drops the mutation's state at once, so neither the result nor an
  // error can reach the panel. The same abort runs on unmount and on an account change.
  const cancelSend = () => {
    request.abort();
    send.reset();
  };
  return {
    send,
    cancelSend,
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
