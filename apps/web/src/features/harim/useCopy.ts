import { useEffect, useState } from 'react';

/** Copies text to the clipboard and reports 'copied' or 'failed' for two seconds. */
export function useCopy(): [state: 'idle' | 'copied' | 'failed', copy: (text: string) => void] {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  useEffect(() => {
    if (state === 'idle') return;
    const timer = window.setTimeout(() => {
      setState('idle');
    }, 2000);
    return () => {
      window.clearTimeout(timer);
    };
  }, [state]);
  const copy = (text: string) => {
    navigator.clipboard.writeText(text).then(
      () => {
        setState('copied');
      },
      () => {
        setState('failed');
      },
    );
  };
  return [state, copy];
}
