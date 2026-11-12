/* The inspector with nothing it can show: what a frame is and how to select. */
import { I } from "../../icons";

export const Empty = ({ several }: { several?: boolean }) => (
  <div className="ld-empty">
    <I.fit size={20} />
    {several ? (
      <>
        <b>Several frames selected</b>
        <p>Select one frame to size it, or something inside a frame to style it.</p>
      </>
    ) : (
      <>
        <b>Nothing selected</b>
        <p>Each frame is one HTML file of the design. Click a frame's name to select it, or anything in it to style that; double-click goes deeper, Esc comes back up.</p>
      </>
    )}
  </div>
);
