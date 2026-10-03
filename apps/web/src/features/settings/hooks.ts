import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { captureApi } from "@/services/api";
import { qk } from "@/shared/queryKeys";
import type { AppSettings } from "@/types";

export function useSettings() {
  const api = captureApi();
  return useQuery({ queryKey: qk.settings, queryFn: () => api.getSettings() });
}

export function useSettingsMutations() {
  const qc = useQueryClient();
  const api = captureApi();
  return {
    save: useMutation({
      mutationFn: (patch: Partial<AppSettings>) => api.updateSettings(patch),
      onSuccess: (s) => qc.setQueryData(qk.settings, s),
    }),
  };
}
