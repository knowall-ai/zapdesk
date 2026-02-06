import { useEffect, useRef, RefObject } from 'react';

/**
 * Hook that detects clicks outside of the referenced element
 * and calls the provided callback when a click outside is detected.
 *
 * @param callback - Function to call when a click outside is detected
 * @param enabled - Whether the hook is active (default: true)
 * @returns A ref to attach to the element you want to detect clicks outside of
 */
export function useClickOutside<T extends HTMLElement = HTMLElement>(
  callback: () => void,
  enabled: boolean = true
): RefObject<T | null> {
  const ref = useRef<T>(null);
  const callbackRef = useRef(callback);

  // Keep callback ref in sync without triggering effect re-runs
  useEffect(() => {
    callbackRef.current = callback;
  });

  useEffect(() => {
    if (!enabled) return;

    function handleClickOutside(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        callbackRef.current();
      }
    }

    // Use mousedown for immediate response
    document.addEventListener('mousedown', handleClickOutside);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [enabled]);

  return ref;
}
