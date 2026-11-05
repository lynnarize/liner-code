// Global motion: runs once on the client before the first page initializes.
import { startStage } from './stage';
import { startSections } from './sections';

export function setupMotion() {
  startStage();
  startSections();
}
