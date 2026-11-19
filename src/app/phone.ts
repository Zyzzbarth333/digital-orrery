// src/app/phone.ts
//
// Where the phone layout applies (docs/frontend/phone.md): below 720 px
// wide, and on short touch screens (a phone on its side), which take the
// sheet on the right instead of along the bottom. The desktop layout is
// everything else, unchanged.

import { createContext, useCallback, useMemo, useSyncExternalStore } from 'react';

export const PHONE_QUERY = '(max-width: 720px), (max-height: 500px) and (pointer: coarse)';
// A short touch screen wide enough for a side sheet of 40 % (a landscape
// phone is 640 px or more); narrower, the sheet stays along the bottom.
export const SIDE_QUERY = '(max-height: 500px) and (pointer: coarse) and (min-width: 560px)';

// Whether a media query matches, kept current.
export function useMedia(query: string): boolean {
  const mql = useMemo(() => matchMedia(query), [query]);
  // Stable per query: a new function each render makes React resubscribe.
  const subscribe = useCallback((fn: () => void) => { mql.addEventListener('change', fn); return () => mql.removeEventListener('change', fn); }, [mql]);
  return useSyncExternalStore(subscribe, () => mql.matches);
}

// Inside the phone's sheet: the rail's lower sections fold away
// (panels.tsx RailGroup), and the band shows only the clock, RUN and FIND.
export const PhoneContext = createContext(false);
