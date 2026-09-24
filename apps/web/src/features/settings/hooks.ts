import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/services/api";
import { qk } from "@/shared/queryKeys";
import type { AppSettings } from "@/types";

export const useSettings = () =>
  useQuery({ queryKey: qk.settings, queryFn: () => api.getSettings() });

export function useSettingsMutations() {
  const qc = useQueryClient();
  return {
    save: useMutation({
      mutationFn: (patch: Partial<AppSettings>) => api.updateSettings(patch),
      onSuccess: (s) => qc.setQueryData(qk.settings, s),
    }),
    changePassword: useMutation({
      mutationFn: ({ current, next }: { current: string; next: string }) =>
        api.changePassword(current, next),
    }),
  };
}
