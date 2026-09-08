export const WHEEL_COPIES = 5

export const WHEEL_FLICK_MS = 90
export const WHEEL_MAX_FLING_ITEMS = 3

export function middleCopyOffset(optionCount: number) {
  return Math.floor(WHEEL_COPIES / 2) * optionCount
}

export function baseIndexFor(optionIndex: number, optionCount: number) {
  return middleCopyOffset(optionCount) + optionIndex
}

export function normalizeIndex(index: number, optionCount: number) {
  const offset = middleCopyOffset(optionCount)
  const wrapped = ((index - offset) % optionCount + optionCount) % optionCount
  return offset + wrapped
}

export function optionValueAt(index: number, optionCount: number) {
  return ((index % optionCount) + optionCount) % optionCount
}

export function valueForIndex<Value>(index: number, options: Value[]): Value {
  return options[optionValueAt(index, options.length)]
}

export function indexForValue(value: number, optionCount: number, values: number[]) {
  const optionIndex = values.indexOf(value)
  if (optionIndex < 0) return null
  return baseIndexFor(optionIndex, optionCount)
}

export function clampIndexToLoop(index: number, optionCount: number) {
  const low = optionCount
  const high = (WHEEL_COPIES - 1) * optionCount - 1
  return Math.min(high, Math.max(low, index))
}

export function targetIndexForDrag(drag: {
  startIndex: number
  dragDelta: number
  velocity: number
  itemHeight: number
  optionCount: number
}) {
  const fling = Math.max(
    -WHEEL_MAX_FLING_ITEMS * drag.itemHeight,
    Math.min(WHEEL_MAX_FLING_ITEMS * drag.itemHeight, drag.velocity * WHEEL_FLICK_MS),
  )
  const projected = drag.startIndex - (drag.dragDelta + fling) / drag.itemHeight
  return clampIndexToLoop(Math.round(projected), drag.optionCount)
}

export function targetIndexForTap(params: {
  pointerY: number
  position: number
  itemHeight: number
  optionCount: number
}) {
  const offset = (params.pointerY - params.position) / params.itemHeight - 0.5
  return clampIndexToLoop(Math.round(offset), params.optionCount)
}

export function positionForIndex(index: number, itemHeight: number, viewportHeight: number) {
  const centering = (viewportHeight - itemHeight) / 2
  return centering - index * itemHeight
}
