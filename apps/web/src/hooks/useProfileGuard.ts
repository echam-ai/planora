import { useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useSelectedProfile } from "@/services/api/profiles";
export function useProfileGuard() {
  const profile = useSelectedProfile();
  const navigate = useNavigate();
  useEffect(() => {
    if (profile === null) navigate({ to: "/", replace: true });
  }, [profile, navigate]);
  return profile;
}
