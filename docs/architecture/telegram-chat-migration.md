# Telegram chat migration

Telegram can upgrade a group to a supergroup with a new chat ID. Inbound service messages and outbound migration errors update the binding and the same workspace’s digest destination.

- Require the sending workspace to own the old or new binding. A leftover digest destination after unlink is not authorization; unknown ownership or another workspace’s binding fails closed.
- Lock old and new binding rows so link/unlink serialize with the rewrite. A conflicting new binding or a disappeared old binding must not rewrite destinations or redirect the send.
- Recheck ownership after persistence before redirected delivery. If this workspace already delivered the digest to the new chat, treat it as delivered. If that delivery is pending or failed, its existing delivery record owns retries.

Implementation: `packages/shared/src/telegram/chat-migration.ts`, Telegram scope and outbound delivery modules. [Telegram setup](../setup/telegram.md) owns configuration and linking.
