const GOOGLE_DRIVE_PROVIDER_ID = 'google_drive';

export const GOOGLE_DRIVE_LIMITED_USE_POLICY =
  'Timeline’s use of information received from Google APIs adheres to the Google API Services User Data Policy, including the Limited Use requirements.';

export const GOOGLE_DRIVE_LIMITED_USE = {
  title: 'Connect Google Drive',
  summary:
    'Timeline will ask Google for read-only access to files this account can see, then capture only the folders and files you select for this team.',
  access:
    'The Drive connection requests openid, email, and https://www.googleapis.com/auth/drive.readonly. Sign-in with Google is a separate request for openid, email, and profile, and never Drive scopes.',
  use: 'Selected Docs, Sheets, Slides, PDFs, and Word files become cited timeline events after a quiet editing window. Timeline reads file metadata, comments, and sharing signals only to detect those selected-source changes.',
  storage:
    'OAuth tokens are encrypted at rest. Timeline keeps hashes and the latest extracted text to detect later edits. It does not store a Drive document archive or copy full files into the document drive.',
  sharing:
    'You choose which folders or files this team may use. A team admin activates those sources. Captured events follow Timeline visibility rules. Timeline does not edit Drive files or change Drive sharing.',
  deletion:
    'Removing your personal Drive account deletes Timeline’s encrypted Drive tokens and, when no remaining Drive connection or Google sign-in still needs the grant, requests Google revocation. Sources using that account are disabled; snapshots and captured history are not deleted. An admin disconnect of the workspace Drive source deletes change snapshots and latest extracted text for uncovered files, cancels in-flight extraction, and stops Drive change watches when deprovision succeeds. Cited timeline events already captured stay in the workspace. To request deletion of captured data, use Help → Support. Requests are handled manually after identity and workspace authority checks. You can also remove Timeline in Google Account permissions.',
  processors:
    'A small billed model may read changed passages to judge whether they belong on the work record. PDF, Word, and Slides text is extracted by Timeline’s document-extract service, then deleted.',
  training: 'Timeline does not use Google user data to train general-purpose models.',
  policy: GOOGLE_DRIVE_LIMITED_USE_POLICY,
} as const;

export function isGoogleDriveProviderId(providerId: string): boolean {
  return providerId === GOOGLE_DRIVE_PROVIDER_ID;
}
