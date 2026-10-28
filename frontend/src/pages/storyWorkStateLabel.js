// Display wording only: retain existing editorial state IDs and writer guards.
export function storyWorkStateLabel(state) {
  if (state.id === 'bloqueada') return 'Bloqueado';
  if (state.id === 'en_diseño') return 'En proceso';
  return state.label;
}
