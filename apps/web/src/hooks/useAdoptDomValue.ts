import { useEffect, useRef } from "react";

/**
 * A page loaded directly is server-rendered, so its inputs accept text before
 * hydration. React hydrates a controlled input without touching the DOM value,
 * but the first re-render after that writes the (still empty) state over it.
 * Attach the returned ref to the input: once, on mount, any text already in the
 * DOM is handed to `onValue` (the field's existing change handler / setter) so
 * state catches up and nothing is lost. The input stays enabled and controlled.
 */
export function useAdoptDomValue<T extends HTMLInputElement | HTMLTextAreaElement>(
  onValue: (value: string) => void,
) {
  const ref = useRef<T>(null);
  const latest = useRef(onValue);
  latest.current = onValue;

  useEffect(() => {
    const typed = ref.current?.value;
    if (typed) latest.current(typed);
  }, []);

  return ref;
}
