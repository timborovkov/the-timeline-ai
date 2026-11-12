# Team members stress preview

Run the web development server using [local setup](../setup/local.md), then open
`http://localhost:3000/dev/break-ui?data=worst`.
The route returns 404 outside `NODE_ENV=development` and has no database fixture
setup. It renders the existing `MembersCard` and member actions with synthetic
profiles. Preview form submissions are intercepted before reaching server actions;
role changes and confirmed removal/revocation never invoke server mutations.
Confirmation dialogs open normally and can be cancelled or confirmed safely.

The bottom control switches **Demo data**, **Worst case**, **Empty**, **One**, and
**1,284 rows**. Selection persists in the URL and follows browser history. The
viewer control exercises owner, admin, and member action visibility. The first
row is the current user. Desktop spacing reserves the expanded sidebar's 240px
and uses the app's 1,152px content cap; this is a component preview, not the full
Team settings page. The Surface selector switches Members, Pending invites, and
Removed members (`?surface=members|invites|removed`); its selection persists in the
URL. The viewer control applies to Members.

## Rendered values and boundaries

| Value | Source | Type / limit | Optional? |
| --- | --- | --- | --- |
| Member title | `displayMemberLabel(user)` from `userMap` | String; signup name accepts 1–80 characters; database `text` is unbounded | Name nullable; falls back to email, then “Unknown member” |
| Email context | `user.email` | String; signup validates email syntax without an explicit application maximum; database `text` is unbounded | Nullable in the UI type; database requires email |
| Role badge / selected role | `member.role` | UI type is string; database enum is owner/admin/member | Required |
| Role options | `MemberRoleForm` | Static Member/Admin/Owner labels | Only for owner managing another member |
| Remove button and tooltip | `RemoveMemberForm` | Static “Remove member” | Admin/owner permissions and current-user identity control presence |
| Action legend / role accessible name | Member title plus static prefix | Same limit as member title | Only when actions render |
| Removal dialog title / description | Member title plus static copy | Same limit as member title | Dialog opening, scrolling, close, and focus restoration are in scope; submission is blocked |
| Member list | `members` prop | Array; unbounded input; renders at most 50 rows per page | Empty array supported |
| Page range / total | Member array length and current page | Locale-formatted integer range; 50 rows per page | Shown only above 50 members |
| Pagination controls | Current page and array length | Static Previous/Next labels; disabled at boundaries | Shown only above 50 members |
| Profile lookup | `userMap.get(member.userId)` | Optional record keyed by user ID | Missing lookup supported |
| Member ID | `member.userId` | UUID in database; synthetic preview IDs | Required; hidden form value and control identifier, never a visible label |
| Heading / empty copy / refresh link | `MembersCard` | Static “Members”, empty explanation, `/app/team?section=members` link | Empty content shown at zero rows |

Sources: [member types](../../apps/web/src/components/team-member-types.ts),
[member row](../../apps/web/src/components/team-member-list-item.tsx),
[member actions](../../apps/web/src/components/team-member-actions.tsx),
[signup validation](../../apps/web/src/app/actions/auth.ts),
[user schema](../../packages/db/src/schema/users.ts), and
[team schema](../../packages/db/src/schema/teams.ts).

## Coverage

The [fixtures](../../apps/web/src/app/dev/break-ui/fixtures.ts) include long names
and emails, short names, diacritics, CJK, Arabic, emoji/ZWJ, whitespace, missing
names and profiles, duplicate names with distinct emails, literal markup,
newlines, all role values, empty and singleton lists, and 1,284 members.

Inspect Demo and Worst case at 320px, normal desktop, and 2,560px; also test
32px root text (200%), dark mode, RTL on the member surface, reduced motion, and
touch. Compare row widths, readable identity, action reachability, and collection
rendering cost. Change fixture data through the existing props; do not modify
production component styling to manufacture a failure.

Avatars, media, translated data-driven badges, and fetch/loading/error states are
not rendered by these components. Do not invent those fields or claim this preview tests them. The
empty-state refresh link leaves the preview for the authenticated Team page.

For pagination, check exactly 50 and 51 members, the final partial page, backwards
navigation, and removal of the last member on a page. Pagination bounds DOM work;
the existing server queries still load the full collections.


## Invitation and removed-member values

| Value | Source | Type / limit | Optional? |
| --- | --- | --- | --- |
| Invite email / dialog identity | `invite.email` | Email string; database text unbounded | Required |
| Inviter identity | `userMap.get(invitedByUserId)` | Same name/email rules as members; whitespace ignored | Missing profile supported |
| Invite role | `invite.role` | Owner/admin/member database enum; normal invites use admin/member | Required |
| Invite URL and copy value | Server-resolved site origin plus `invite.token` | Token text; fixture uses synthetic nonfunctional tokens | Required |
| Delivery status / error | `sendStatus`, `sendError` | Status and error strings; database text unbounded | Error nullable |
| Expiry, last sent, removal time | `expiresAt`, `lastSentAt`, `removedAt` | Date values; relative timestamp plus absolute tooltip | Last sent and removed time nullable |
| Removed identity / role | Removed membership and user map | Same profile and role boundaries as active members | Missing profile supported |
| Collections / ranges / page controls | `invites`, `removedMembers` | Unbounded input arrays; 50 rendered rows per list | Empty supported; removed section omitted when empty |

Fixtures cover failed/sent/pending delivery, absent timestamps, blank/missing
inviter names, long invite URLs, and the same collection cardinalities as members.
Verify removal and revoke dialogs at 320px with 32px root text and a short viewport:
scroll to the footer, close with Escape/Cancel, check focus restoration, and confirm
that the preview issues no server-action POST. Invite URLs retain the origin passed
from the server even after changing pages.


Also exercise denied/unavailable clipboard access at 200% text size: the visible
error must wrap below the actions without horizontal overflow. Repeat the huge
fixture in `en-US` and `de-DE` browser contexts and check for hydration errors and
localized pagination totals. Confirmation headings must not intersect the close
icon, and initial focus must remain visible at the top of a short viewport.


Exercise Previous/Next with the keyboard from the bottom of a long page. The new
page must scroll into view, focus its named list, and let Tab reach its first
action. Include the final partial page where Next becomes disabled, backwards
navigation, and narrow containers with 200% text. Automatic updates should not
steal focus from another control.


For shared controls, cover delayed clipboard responses arriving out of order and
value changes while copy feedback is visible or pending. Test input dialogs with
IME composition Enter (including key code 229), then a normal Enter to submit.
These asynchronous and composition cases are covered by the focused copy-button
and app-dialog tests rather than issuing real mutations from the preview.
