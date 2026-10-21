/**
 * The type a new ticket starts with (#7379): none. First-line support decides
 * whether it is a bug, an enhancement or a question, so the form no longer
 * picks "Task" for them.
 *
 * When a project's types load, a type already chosen is kept if that project
 * has it, and cleared otherwise, so the form never submits a type the project
 * lacks.
 */
export function keptTicketType(
  current: string,
  available: ReadonlyArray<{ name: string }>
): string {
  return current && available.some((type) => type.name === current) ? current : '';
}
