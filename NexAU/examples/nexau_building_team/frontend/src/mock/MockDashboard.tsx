import { useMockTeamStream } from "./useMockTeamStream";
import { MOCK_FILE_TREE, MOCK_FILE_CONTENTS } from "./mockFiles";
import { TeamDashboard } from "../TeamDashboard";

export default function MockDashboard() {
  const stream = useMockTeamStream();
  return (
    <TeamDashboard
      stream={stream as any}
      isMock={true}
      mockNodes={MOCK_FILE_TREE}
      mockFiles={MOCK_FILE_CONTENTS}
    />
  );
}
