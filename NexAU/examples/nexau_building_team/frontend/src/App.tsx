import React, { Suspense } from "react";
import { useTeamStream } from "./hooks/useTeamStream";
import { TeamDashboard } from "./TeamDashboard";

const IS_MOCK_MODE =
  new URLSearchParams(window.location.search).get("mock") === "true";

// ponytail: lazy chunk isolation for mock layer (1,916 lines / ~80 KB stripped from production bundle, R9)
const MockDashboard = React.lazy(() => import("./mock/MockDashboard"));

export function App() {
  const stream = useTeamStream();

  if (IS_MOCK_MODE) {
    return (
      <Suspense
        fallback={
          <div className="flex h-screen items-center justify-center bg-slate-50 font-mono text-xs text-slate-500">
            Loading Mock Mode Replay...
          </div>
        }
      >
        <MockDashboard />
      </Suspense>
    );
  }

  return <TeamDashboard stream={stream} />;
}

export default App;
