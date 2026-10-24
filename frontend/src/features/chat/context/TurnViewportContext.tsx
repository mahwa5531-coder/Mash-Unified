"use client";

import { createContext, useContext, ReactNode, useMemo } from 'react';

interface TurnViewportContextValue {
  isNearViewport: boolean;
}

const TurnViewportContext = createContext<TurnViewportContextValue>({
  isNearViewport: true, // Default to true if used outside provider
});

export function TurnViewportProvider({
  isNearViewport,
  children,
}: {
  isNearViewport: boolean;
  children: ReactNode;
}) {
  const value = useMemo(() => ({ isNearViewport }), [isNearViewport]);
  return (
    <TurnViewportContext.Provider value={value}>
      {children}
    </TurnViewportContext.Provider>
  );
}

export function useTurnViewport(): TurnViewportContextValue {
  return useContext(TurnViewportContext);
}
