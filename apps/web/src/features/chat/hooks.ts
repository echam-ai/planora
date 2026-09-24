import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/services/api";
import { qk } from "@/shared/queryKeys";

export const useConversation = () =>
  useQuery({ queryKey: qk.conversation, queryFn: () => api.getCurrentConversation() });

export function useChatMutations() {
  const qc = useQueryClient();
  const sync = (conv: unknown) => {
    qc.setQueryData(qk.conversation, conv);
    qc.invalidateQueries({ queryKey: qk.tasks });
  };
  return {
    send: useMutation({ mutationFn: (text: string) => api.sendChatMessage(text), onSuccess: sync }),
    reset: useMutation({ mutationFn: () => api.startNewConversation(), onSuccess: sync }),
    confirm: useMutation({
      mutationFn: (actionId: string) => api.confirmChatAction(actionId),
      onSuccess: sync,
    }),
    reject: useMutation({
      mutationFn: (actionId: string) => api.rejectChatAction(actionId),
      onSuccess: sync,
    }),
  };
}
