import { refreshDemoCatalog } from './catalog.js';
import { refreshDemoWorkspace } from './workspace.js';

export { assertExpandedDemoCorpus, type ExpandedDemoCorpusSnapshot } from './assert.js';
export {
  CORPUS_DOCUMENTS,
  CORPUS_EVENTS,
  CORPUS_FACTS,
  CORPUS_MEETINGS,
  CORPUS_OBJECTS,
  CORPUS_VOLUME_FLOORS,
  DEMO_VOICE_AUDIO,
  corpusEventId,
  corpusObjectId,
  refreshDemoCatalog,
} from './catalog.js';
export { CORPUS_PEOPLE } from './people.js';
export {
  CORPUS_CALENDAR_EVENTS,
  CORPUS_DIGEST_WINDOWS,
  CORPUS_EVENT_NEEDLES,
  CORPUS_NOTES,
  CORPUS_PROPOSALS,
  CORPUS_SLACK,
  CORPUS_WEBHOOK,
  DEALFLOW_ITEMS,
  refreshDemoWorkspace,
} from './workspace.js';

export function refreshDemoCorpus(): void {
  refreshDemoCatalog();
  refreshDemoWorkspace();
}
