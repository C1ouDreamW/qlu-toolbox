export const BACK_EXIT_WINDOW_MS = 2_000

export function isSecondBackPress(lastPressedAt: number, now: number) {
  return lastPressedAt > 0 && now - lastPressedAt <= BACK_EXIT_WINDOW_MS
}
