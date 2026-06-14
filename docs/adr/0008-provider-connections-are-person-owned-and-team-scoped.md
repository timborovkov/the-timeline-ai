# Provider connections are person-owned and team-scoped

Native provider credentials belong to the team member who grants them, while a
Timeline team owns only the integration scope it is allowed to sync through
that provider connection. We chose this over workspace-owned OAuth tokens
because a personal GitHub, Drive, or Linear login can expose resources that are
irrelevant or private to the Timeline team; team admins should manage shared
sync intent without gaining broad visibility into another member's provider
account.

An integration scope may include specific resources or living provider-native
groups, such as a GitHub organization whose future accessible repositories
should also sync. A Timeline team should have only one active source path for
the same external source, and replacing that path changes which provider
connection powers the scope without transferring the original owner's
credentials. When a connection owner leaves, tokens expire, or scoped resources
become unreachable, the product surfaces connection attention to the people who
can act instead of treating the problem as a generic integration error.
Team integration views answer what the team is syncing; personal connection
views answer what the member has granted across teams.
