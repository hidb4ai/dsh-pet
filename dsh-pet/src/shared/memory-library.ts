/** Public view of desktop pet memory management; remote scope can only be resolved by host by pet. */
export interface RememberedFact {
  id: string;
  revision: number;
  stateVersion: number;
  kind: string;
  text: string;
}

/** The page cursor is from PowerContext and is not used to select other pets or services. */
export interface MemoryPage {
  items: RememberedFact[];
  nextCursor: string | null;
}

/** Source of memory version; excerpt is for display only and cannot be used as model instructions. */
export interface MemoryEvidence {
  revision: number;
  createdAt: string | null;
  sources: { id: string; type: string; excerpt?: string }[];
}

/** Both corrections and forgetting are bound to the version viewed by the user, and concurrency updates are refused to be overwritten. */
export interface MemoryChange {
  action: 'correct' | 'forget';
  id: string;
  revision: number;
  stateVersion: number;
  text?: string;
}
