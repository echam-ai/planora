import { useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useSession } from "./useApi";

export function useAuthGuard() {
  const navigate = useNavigate();
  const { data: session, isLoading } = useSession();

  useEffect(() => {
    if (!isLoading && !session) {
      navigate({ to: "/login" });
    }
  }, [isLoading, session, navigate]);

  return { session, isLoading };
}
