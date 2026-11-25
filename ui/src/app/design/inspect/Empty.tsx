/* The inspector with nothing it can show: what a frame is and how to select, in the one empty state every surface has (Pane.tsx). */
import { I } from "../../icons";
import { PaneNote } from "../../Pane";

export const Empty = ({ several }: { several?: boolean }) =>
  several ? (
    <PaneNote icon={<I.fit size={20} />} title="Several frames selected">
      Select one frame to size it, or something inside a frame to style it.
    </PaneNote>
  ) : (
    <PaneNote icon={<I.fit size={20} />} title="Nothing selected">
      Each frame is one HTML file of the design. Click a frame's name to select it, or anything in it to style that; double-click goes deeper, Esc comes back up.
    </PaneNote>
  );
