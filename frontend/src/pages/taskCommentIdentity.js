const validId = value => Number.isSafeInteger(value) && value > 0 && value <= 2147483647;

// The displayed author is historical text, not identity evidence. Until the
// server supplies a durable actor ID, show initials instead of guessing a user.
export function taskCommentActorPerson(comment, users) {
  if (!validId(comment?.actor_usuario_id) || !Array.isArray(users)) return undefined;
  const matches = users.filter(user => user?.id === comment.actor_usuario_id);
  return matches.length === 1 && matches[0].activo !== false ? matches[0] : undefined;
}
