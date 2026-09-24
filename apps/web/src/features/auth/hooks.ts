import { useQuery } from "@tanstack/react-query";
import { api } from "@/services/api";
import { qk } from "@/shared/queryKeys";

export const useSession = () =>
  useQuery({ queryKey: qk.session, queryFn: () => api.getSession(), staleTime: 60_000 });
